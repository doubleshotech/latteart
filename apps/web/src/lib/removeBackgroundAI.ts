import { useSegment } from "../stores/segmentStore";
import type { SegmentRequest, SegmentResponse } from "./segment.worker";

/**
 * Main-thread client for the segmentation worker. The model, the ~3 s of
 * inference and the whole transformers.js/onnxruntime bundle live in
 * `segment.worker.ts`; this file only ships requests over and turns the reply
 * back into a `Matte`. Keeping the work off the UI thread is the point — the
 * WASM backend is synchronous once it starts, so on the main thread it froze
 * the canvas, the toast and every animation for the duration.
 */

/** A single-channel foreground probability map at the source's native pixel
 * resolution: `data[i]` is 0 (background) … 255 (foreground). The raw material
 * both the transparent cut-out and the auto-mask (lib/autoMask) derive from. */
export interface Matte {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

interface SegmentResult {
  rgba: Uint8ClampedArray;
  matte: Matte;
}

interface Pending {
  resolve: (value: SegmentResult) => void;
  reject: (reason: unknown) => void;
}

const pending = new Map<number, Pending>();
let worker: Worker | null = null;
let nextId = 1;

function getWorker(): Worker {
  worker ??= createWorker();
  return worker;
}

function createWorker(): Worker {
  const w = new Worker(new URL("./segment.worker.ts", import.meta.url), { type: "module" });
  w.addEventListener("message", (ev: MessageEvent<SegmentResponse>) => {
    const msg = ev.data;
    if (msg.type === "loading") {
      useSegment.getState().setLoading(msg.pct);
      return;
    }
    if (msg.type === "ready") {
      useSegment.getState().setReady(msg.device);
      return;
    }
    // A job the caller already abandoned still gets a reply — drop it.
    const job = pending.get(msg.id);
    pending.delete(msg.id);
    settleLoadState();
    if (!job) return;
    if (msg.type === "error") {
      job.reject(new Error(msg.message));
      return;
    }
    job.resolve({
      rgba: new Uint8ClampedArray(msg.rgba),
      matte: {
        data: new Uint8ClampedArray(msg.matte),
        width: msg.width,
        height: msg.height,
      },
    });
  });
  // A worker that fails to start (bad import, blocked module script) never
  // answers, so fail everything waiting and drop it — the next call rebuilds,
  // matching how a failed model load used to retry.
  w.addEventListener("error", (ev: ErrorEvent) => {
    const err = new Error(ev.message || "segmentation worker failed");
    for (const job of pending.values()) job.reject(err);
    pending.clear();
    useSegment.getState().setIdle();
    // Guarded on identity: a late error from a worker we already replaced must
    // not terminate its successor.
    if (worker === w) worker = null;
    w.terminate();
  });
  return w;
}

/** Once nothing is in flight the loading line must clear, or a failed first
 * load leaves "Downloading model · 12%" on screen forever. */
function settleLoadState() {
  if (pending.size === 0 && useSegment.getState().phase !== "idle") {
    useSegment.getState().setIdle();
  }
}

function send(request: SegmentRequest) {
  getWorker().postMessage(request);
}

/** A cancel is only meaningful to a worker that already has the job — never
 * spin one up just to tell it to stop. */
function sendCancel(id: number) {
  worker?.postMessage({ type: "cancel", id } satisfies SegmentRequest);
}

/**
 * Run the model over a source image. Resolves with the foreground matte at
 * native resolution plus the decoded RGBA source, so callers composite without
 * re-decoding. `signal` rejects immediately — the worker is told to stop, but
 * the caller doesn't wait for it to notice, so a cancel is instant on screen.
 */
function segment(dataUrl: string, signal?: AbortSignal): Promise<SegmentResult> {
  if (signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));

  const id = nextId++;
  return new Promise<SegmentResult>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    // The model may already be resident; `setPreparing` is corrected by the
    // worker's first message either way, and gives the UI something to say
    // during the gap before download progress starts flowing.
    if (useSegment.getState().device === null) useSegment.getState().setPreparing();

    signal?.addEventListener(
      "abort",
      () => {
        if (!pending.delete(id)) return;
        sendCancel(id);
        settleLoadState();
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );

    send({ type: "segment", id, dataUrl });
  });
}

/**
 * Segment the foreground with an in-browser matting model and return the image
 * as a transparent PNG. Works on any background — the robust alternative to
 * flat-color keying. See `segment` for the model/cancel semantics.
 */
export async function removeBackgroundAI(dataUrl: string, signal?: AbortSignal): Promise<string> {
  const { rgba, matte } = await segment(dataUrl, signal);

  const pixels = new Uint8ClampedArray(rgba);
  for (let i = 0; i < matte.data.length; i++) {
    pixels[i * 4 + 3] = matte.data[i]!;
  }

  const canvas = document.createElement("canvas");
  canvas.width = matte.width;
  canvas.height = matte.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context for background removal");
  ctx.putImageData(new ImageData(pixels, matte.width, matte.height), 0, 0);
  return canvas.toDataURL("image/png");
}

/**
 * The foreground matte alone — the same segmentation the cut-out uses, but
 * returning the raw probability map instead of compositing it into alpha.
 * Feeds lib/autoMask, which turns it into a white-on-black inpaint mask.
 */
export async function foregroundMatte(dataUrl: string, signal?: AbortSignal): Promise<Matte> {
  const { matte } = await segment(dataUrl, signal);
  return matte;
}
