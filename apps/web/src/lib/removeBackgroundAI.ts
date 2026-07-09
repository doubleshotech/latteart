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
 * lazily so its weight stays out of the main bundle until Cutout is first used. */
function getSession(): Promise<Session> {
  sessionPromise ??= (async () => {
    const tf = await import("@huggingface/transformers");
    tf.env.allowLocalModels = false;
    const model = await tf.AutoModel.from_pretrained(MODEL_ID);
    const processor = await tf.AutoProcessor.from_pretrained(MODEL_ID);
    return { model, processor, RawImage: tf.RawImage };
  })();
  return sessionPromise;
}

/**
 * Segment the foreground with an in-browser matting model and return the image
 * as a transparent PNG. Works on any background — the robust alternative to
 * flat-color keying. The model downloads once (browser-cached), so the first
 * call is slow and later calls are fast.
 */
export async function removeBackgroundAI(dataUrl: string): Promise<string> {
  const { model, processor, RawImage } = await getSession();

  const image = await RawImage.fromURL(dataUrl);
  const { pixel_values } = await processor(image);
  const { output } = await model({ input: pixel_values });

  // output: foreground probability [1, 1, H, W] in 0..1 → grayscale mask,
  // resized back to the source resolution.
  const mask = await RawImage.fromTensor(output[0].mul(255).to("uint8")).resize(
    image.width,
    image.height,
  );

  const rgba = image.rgba();
  const pixels = new Uint8ClampedArray(rgba.data);
  for (let i = 0; i < mask.data.length; i++) {
    pixels[i * 4 + 3] = mask.data[i]!;
  }

  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context for background removal");
  ctx.putImageData(new ImageData(pixels, image.width, image.height), 0, 0);
  return canvas.toDataURL("image/png");
}
