import type {
  PretrainedModelOptions,
  PreTrainedModel,
  Processor,
  RawImage as RawImageT,
} from "@huggingface/transformers";

// RMBG-1.4 — general foreground matting that actually runs in transformers.js.
// It's the only general model that does: BiRefNet (MIT) has no working
// transformers.js ONNX (onnx-community/BiRefNet_lite-ONNX throws in
// onnxruntime-web on every backend), and MODNet (Apache) is portrait-only.
// CAVEAT: RMBG-1.4's weights are non-commercial. latteart doesn't bundle them —
// the browser downloads them from HF at runtime — so MIT code stays clean and
// non-commercial use is fine; swap MODEL_ID before shipping latteart
// commercially (revisit BiRefNet once its ONNX runs in transformers.js).
const MODEL_ID = "briaai/RMBG-1.4";

/** Which backend runs the matte. WebGPU is far faster but wants fp16 weights
 * (88 MB) where WASM runs the q8 build (44 MB) — see `loadSession`. */
type SegmentDevice = "webgpu" | "wasm";

export type SegmentRequest =
  | { type: "segment"; id: number; dataUrl: string }
  | { type: "cancel"; id: number };

export type SegmentResponse =
  /** Model download progress, 0…100 across every file the load pulls. */
  | { type: "loadProgress"; pct: number }
  | { type: "ready" }
  | {
      type: "done";
      id: number;
      /** Decoded source pixels and the matte, transferred (not copied). */
      rgba: ArrayBuffer;
      matte: ArrayBuffer;
      width: number;
      height: number;
    }
  | { type: "error"; id: number; message: string };

/** `DedicatedWorkerGlobalScope` lives in lib.webworker, which this app's tsconfig
 * can't add without colliding with lib.dom — so type the two members we use. */
interface WorkerScope {
  postMessage(message: SegmentResponse, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (ev: MessageEvent<SegmentRequest>) => void): void;
}
const ctx = self as unknown as WorkerScope;

function post(message: SegmentResponse, transfer?: Transferable[]) {
  ctx.postMessage(message, transfer);
}

interface Session {
  model: PreTrainedModel;
  processor: Processor;
  RawImage: typeof RawImageT;
  device: SegmentDevice;
}

type ProgressInfo = Parameters<NonNullable<PretrainedModelOptions["progress_callback"]>>[0];

let sessionPromise: Promise<Session> | null = null;
/** Latched once WebGPU has failed, so the demotion to WASM is permanent for the
 * page rather than re-paid on every call. Resets on reload, so a machine that
 * failed once still gets to try WebGPU again next visit. */
let forceWasm = false;
/** The device the current (or last) load attempted. A load that throws has no
 * Session to read `device` off, so the attempt is recorded here instead. */
let attemptedDevice: SegmentDevice | null = null;

function demoteToWasm() {
  forceWasm = true;
  sessionPromise = null;
}

/**
 * WebGPU is only worth taking when the adapter has `shader-f16`: without it the
 * fp16 weights can't run, and the fp32 alternative is a 176 MB download for the
 * same matte the 44 MB q8/WASM build produces.
 */
async function pickDevice(): Promise<SegmentDevice> {
  interface AdapterLike {
    features: { has(name: string): boolean };
  }
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<AdapterLike | null> } })
    .gpu;
  if (!gpu) return "wasm";
  try {
    const adapter = await gpu.requestAdapter();
    return adapter?.features.has("shader-f16") ? "webgpu" : "wasm";
  } catch {
    return "wasm";
  }
}

/** Per-file byte counts, summed into one percentage. The weights dwarf the
 * configs, so the aggregate tracks the download the user is actually waiting on.
 * A cache hit fires a single 100% event per file, so a warm load shows no bar. */
const bytes = new Map<string, { loaded: number; total: number }>();

function onLoadProgress(info: ProgressInfo) {
  if (info.status !== "progress" || !info.total) return;
  bytes.set(info.file, { loaded: info.loaded, total: info.total });
  let loaded = 0;
  let total = 0;
  for (const file of bytes.values()) {
    loaded += file.loaded;
    total += file.total;
  }
  post({ type: "loadProgress", pct: Math.min(100, Math.round((loaded / total) * 100)) });
}

/** Load (once) the segmentation model + processor. transformers.js is imported
 * lazily so its weight stays out of the worker's first chunk. On failure the
 * cached promise is cleared so a transient error (offline, flaky HF fetch)
 * doesn't permanently disable the matte — the next call retries. */
function getSession(): Promise<Session> {
  sessionPromise ??= loadSession().catch((err: unknown) => {
    sessionPromise = null;
    throw err;
  });
  return sessionPromise;
}

/**
 * A session for one job, demoting to WASM if a WebGPU one can't even be built.
 * Without this a failed WebGPU *load* (ORT init, adapter lost, OOM on the fp16
 * build) would leave `forceWasm` clear, so every later call re-picks WebGPU and
 * fails the same way — segmentation permanently dead on that machine, which is
 * worse than the always-WASM behaviour this replaced. A load that failed for
 * some other reason (offline, flaky HF fetch) also demotes, and the retry then
 * surfaces the real error; the cost is staying on WASM until the next reload.
 */
async function sessionForJob(): Promise<Session> {
  try {
    return await getSession();
  } catch (err) {
    if (forceWasm || attemptedDevice !== "webgpu") throw err;
    demoteToWasm();
    return await getSession();
  }
}

async function loadSession(): Promise<Session> {
  const tf = await import("@huggingface/transformers");
  tf.env.allowLocalModels = false;
  const device = forceWasm ? "wasm" : await pickDevice();
  attemptedDevice = device;
  // Fresh counters per attempt: a demotion downloads a *different* build, and a
  // surviving fp16 entry (88 MB, already complete) would start the q8 bar ~67%.
  bytes.clear();
  const model = await tf.AutoModel.from_pretrained(MODEL_ID, {
    device,
    // transformers.js defaults WebGPU to fp32 (176 MB) — pin fp16 (88 MB)
    // instead. WASM keeps its q8 default (44 MB). Each device downloads only
    // the build it will actually run.
    dtype: device === "webgpu" ? "fp16" : "q8",
    progress_callback: onLoadProgress,
  });
  const processor = await tf.AutoProcessor.from_pretrained(MODEL_ID);
  post({ type: "ready" });
  return { model, processor, RawImage: tf.RawImage, device };
}

/** Ids the main thread has given up on. A cancel that lands mid-inference can't
 * interrupt the backend, but it stops the next step and frees the queue. */
const cancelled = new Set<number>();

function throwIfCancelled(id: number) {
  if (cancelled.has(id)) throw new DOMException("Aborted", "AbortError");
}

/**
 * Run RMBG-1.4 over a source image and post back its foreground matte at native
 * resolution, plus the decoded RGBA source so the caller composites without
 * re-decoding. The model downloads once (browser-cached), so the first call is
 * slow and later calls are fast.
 */
async function segment(id: number, dataUrl: string) {
  throwIfCancelled(id);
  let session = await sessionForJob();
  throwIfCancelled(id);

  const image = await session.RawImage.fromURL(dataUrl);
  const { pixel_values } = await session.processor(image);
  throwIfCancelled(id);

  let result;
  try {
    result = await session.model({ input: pixel_values });
  } catch (err) {
    // WebGPU can load cleanly and still throw at inference — this stack has done
    // exactly that before (BiRefNet). Demote to WASM once and retry rather than
    // losing the matte; `forceWasm` keeps every later call on the good path.
    if (session.device !== "webgpu" || cancelled.has(id)) throw err;
    demoteToWasm();
    session = await getSession();
    throwIfCancelled(id);
    result = await session.model({ input: pixel_values });
  }
  throwIfCancelled(id);

  // Foreground probability [1, 1, H, W] in 0..1 → grayscale mask, resized back
  // to the source resolution. NB: the `input`/`output` tensor names are
  // RMBG-1.4's — a different MODEL_ID (e.g. BiRefNet uses `input_image`) needs
  // these updated too; `output` falls back to the first tensor defensively.
  const logits = result.output ?? Object.values(result)[0];
  const mask = await session.RawImage.fromTensor(logits[0].mul(255).to("uint8")).resize(
    image.width,
    image.height,
  );

  // Copied out of the RawImage buffers, then transferred — the worker keeps no
  // reference, so this costs one allocation instead of a structured clone.
  const rgba = new Uint8ClampedArray(image.rgba().data);
  const matte = new Uint8ClampedArray(mask.data);
  post(
    {
      type: "done",
      id,
      rgba: rgba.buffer as ArrayBuffer,
      matte: matte.buffer as ArrayBuffer,
      width: image.width,
      height: image.height,
    },
    [rgba.buffer as ArrayBuffer, matte.buffer as ArrayBuffer],
  );
}

/** Jobs run one at a time: one onnxruntime session isn't safe to re-enter, and
 * the worker no longer blocks the UI thread so serializing costs nothing. */
let queue: Promise<void> = Promise.resolve();

ctx.addEventListener("message", (ev: MessageEvent<SegmentRequest>) => {
  const msg = ev.data;
  if (msg.type === "cancel") {
    cancelled.add(msg.id);
    return;
  }
  queue = queue.then(async () => {
    try {
      await segment(msg.id, msg.dataUrl);
    } catch (err) {
      post({
        type: "error",
        id: msg.id,
        message: (err as Error).message || "segmentation failed",
      });
    } finally {
      cancelled.delete(msg.id);
    }
  });
});
