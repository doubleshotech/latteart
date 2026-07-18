import type { PreTrainedModel, Processor, RawImage as RawImageT } from "@huggingface/transformers";

// RMBG-1.4 — general foreground matting that actually runs in transformers.js
// (q8/WASM, ~44 MB). It's the only general model that does: BiRefNet (MIT) has
// no working transformers.js ONNX (onnx-community/BiRefNet_lite-ONNX throws in
// onnxruntime-web on every backend), and MODNet (Apache) is portrait-only.
// CAVEAT: RMBG-1.4's weights are non-commercial. latteart doesn't bundle them —
// the browser downloads them from HF at runtime — so MIT code stays clean and
// non-commercial use is fine; swap MODEL_ID before shipping latteart
// commercially (revisit BiRefNet once its ONNX runs in transformers.js).
const MODEL_ID = "briaai/RMBG-1.4";

interface Session {
  model: PreTrainedModel;
  processor: Processor;
  RawImage: typeof RawImageT;
}

let sessionPromise: Promise<Session> | null = null;

/** Load (once) the segmentation model + processor. transformers.js is imported
 * lazily so its weight stays out of the main bundle until Cutout is first used.
 * On failure the cached promise is cleared so a transient error (offline, flaky
 * HF fetch) doesn't permanently disable the matte — the next call retries. */
function getSession(): Promise<Session> {
  sessionPromise ??= loadSession().catch((err: unknown) => {
    sessionPromise = null;
    throw err;
  });
  return sessionPromise;
}

async function loadSession(): Promise<Session> {
  const tf = await import("@huggingface/transformers");
  tf.env.allowLocalModels = false;
  const model = await tf.AutoModel.from_pretrained(MODEL_ID);
  const processor = await tf.AutoProcessor.from_pretrained(MODEL_ID);
  return { model, processor, RawImage: tf.RawImage };
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}

/** A single-channel foreground probability map at the source's native pixel
 * resolution: `data[i]` is 0 (background) … 255 (foreground). The raw material
 * both the transparent cut-out and the auto-mask (lib/autoMask) derive from. */
export interface Matte {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * Run RMBG-1.4 over a source image and return its foreground matte at native
 * resolution. The model downloads once (browser-cached), so the first call is
 * slow and later calls are fast. The WASM steps can't be interrupted mid-flight,
 * so `signal` is checked between them: a cancel throws AbortError before any
 * result is applied. Also returns the decoded RGBA source so callers can
 * composite without re-decoding.
 */
async function segment(
  dataUrl: string,
  signal?: AbortSignal,
): Promise<{ rgba: Uint8ClampedArray; matte: Matte }> {
  const { model, processor, RawImage } = await getSession();
  throwIfAborted(signal);

  const image = await RawImage.fromURL(dataUrl);
  const { pixel_values } = await processor(image);
  const result = await model({ input: pixel_values });
  throwIfAborted(signal);

  // Foreground probability [1, 1, H, W] in 0..1 → grayscale mask, resized back
  // to the source resolution. NB: the `input`/`output` tensor names are
  // RMBG-1.4's — a different MODEL_ID (e.g. BiRefNet uses `input_image`) needs
  // these updated too; `output` falls back to the first tensor defensively.
  const logits = result.output ?? Object.values(result)[0];
  const mask = await RawImage.fromTensor(logits[0].mul(255).to("uint8")).resize(
    image.width,
    image.height,
  );

  // Copy the matte out of the RawImage buffer so it stays valid for the caller.
  return {
    rgba: new Uint8ClampedArray(image.rgba().data),
    matte: { data: new Uint8ClampedArray(mask.data), width: image.width, height: image.height },
  };
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
