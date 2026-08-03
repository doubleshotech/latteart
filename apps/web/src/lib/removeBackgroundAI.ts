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

/** How far the model's one-time load has got. RMBG is fetched from HF on first
 * use (44 MB on WASM, 88 MB on WebGPU) and browser-cached after, so this only
 * ever describes the first matte of a session. */
export type SegmentLoadPhase = "idle" | "downloading" | "preparing";

type LoadListener = (phase: SegmentLoadPhase, pct: number) => void;

let listener: LoadListener | null = null;
let loadPhase: SegmentLoadPhase = "idle";
/** True once the model is resident, so later jobs announce no load at all. */
let modelReady = false;

/**
 * Follow the model load. A plain callback rather than a store write, because
 * `lib/` is a leaf here — every other lib module that touches `stores/` imports
 * types only. stores/segmentStore subscribes and turns this into UI state.
 */
export function onSegmentLoad(fn: LoadListener) {
  listener = fn;
}

function setLoadPhase(phase: SegmentLoadPhase, pct = 0) {
  loadPhase = phase;
  listener?.(phase, pct);
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
    if (msg.type === "loadProgress") {
      // Only while something is actually waiting: a cancelled job leaves the
      // load running, and its progress must not re-arm an empty status line.
      // A warm cache reports every file at 100% at once, so a finished download
      // reads as "preparing" rather than flashing a full bar.
      if (pending.size > 0) setLoadPhase(msg.pct >= 100 ? "preparing" : "downloading", msg.pct);
      return;
    }
    if (msg.type === "ready") {
      modelReady = true;
      setLoadPhase("idle");
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
    setLoadPhase("idle");
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
  if (pending.size === 0 && loadPhase !== "idle") setLoadPhase("idle");
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
    // Something to say during the gap before download progress starts flowing.
    // Guarded on `idle` so a second consumer joining mid-download can't knock a
    // live percentage back to "Preparing model…".
    if (!modelReady && loadPhase === "idle") setLoadPhase("preparing");

    signal?.addEventListener(
      "abort",
      () => {
        if (!pending.delete(id)) return;
        // Only worth telling a worker that already has the job — never spin one
        // up just to cancel.
        worker?.postMessage({ type: "cancel", id } satisfies SegmentRequest);
        settleLoadState();
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );

    getWorker().postMessage({ type: "segment", id, dataUrl } satisfies SegmentRequest);
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
