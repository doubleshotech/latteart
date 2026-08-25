import type { Bytes } from "./zip";

/**
 * The canvas environment seam — one file that knows whether pixels live in a
 * DOM `HTMLCanvasElement` or a worker's `OffscreenCanvas`.
 *
 * The offscreen compositors (`lib/flatten`, `lib/ora`, the compositing core of
 * `lib/layerMask`) run in two places: on the main thread for AI Merge and
 * thumbnails, and inside `lib/export.worker` where `document` does not exist.
 * Everything environment-specific they need — making a canvas, getting its 2D
 * context, decoding an image, encoding a PNG — goes through here, so the
 * compositors themselves never mention `document` and never type-sniff a DOM
 * constructor (which isn't merely `false` in a worker, it's a ReferenceError).
 *
 * Main-thread-only code (Konva hooks, the mask editors, anything that wants a
 * synchronous `toDataURL`) keeps using the DOM directly; this seam is for code
 * that has to run on both sides.
 *
 * The environment is detected per call, never latched at import time, so a
 * test can stub `globalThis.OffscreenCanvas` and drive these modules in Node.
 */

export type Raster = HTMLCanvasElement | OffscreenCanvas;
export type Raster2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** A drawing surface, whichever kind this environment builds. Dimensions are
 * clamped to at least 1px — a zero-size canvas throws on some operations and
 * draws nothing on the rest. */
export function makeRaster(width: number, height: number): Raster {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    return canvas;
  }
  return new OffscreenCanvas(w, h);
}

/**
 * The 2D context of either canvas kind. The cast is deliberate and confined
 * here: calling the overloaded `getContext` on the union type is exactly where
 * tsgo and tsc have disagreed in this repo, so the one unsafe-looking line
 * lives in one place instead of in every compositor.
 */
export function context2d(
  raster: Raster,
  opts?: CanvasRenderingContext2DSettings,
): Raster2D | null {
  return (raster as HTMLCanvasElement).getContext("2d", opts) as Raster2D | null;
}

/** A decoded image: drawable pixels plus their size, and a way to give the
 * memory back. `close` matters in the export worker, which outlives the export
 * and would otherwise keep every layer's decoded bitmap resident. */
export interface DecodedImage {
  source: ImageBitmap;
  width: number;
  height: number;
  close(): void;
}

/**
 * Decode an image from a `data:` URL, in either environment.
 *
 * Resolves null rather than rejecting, matching `lib/loadImage`: callers here
 * composite pixels that are nice-to-have, and the useful response to "this
 * didn't decode" is to carry on without it.
 */
export async function decodeImage(src: string): Promise<DecodedImage | null> {
  try {
    const blob = await (await fetch(src)).blob();
    const bitmap = await createImageBitmap(blob);
    if (!bitmap.width || !bitmap.height) {
      bitmap.close();
      return null;
    }
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close(),
    };
  } catch {
    return null;
  }
}

/** A canvas as a PNG blob. This is the export's dominant cost — encoding is
 * synchronous once it starts, which is the whole reason the exporters run it
 * in a worker. */
export async function encodePngBlob(raster: Raster): Promise<Blob> {
  if ("convertToBlob" in raster) return raster.convertToBlob({ type: "image/png" });
  const blob = await new Promise<Blob | null>((resolve) => raster.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("could not encode a PNG");
  return blob;
}

/** A canvas as PNG bytes — the form `lib/zip` wants. */
export async function encodePng(raster: Raster): Promise<Bytes> {
  return new Uint8Array(await (await encodePngBlob(raster)).arrayBuffer());
}

/** A canvas as a PNG data URL. Synchronous underneath on the main thread;
 * a blob → FileReader round-trip in a worker, where `toDataURL` doesn't exist. */
export async function pngDataUrl(raster: Raster): Promise<string> {
  if ("toDataURL" in raster) return raster.toDataURL("image/png");
  const blob = await encodePngBlob(raster);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("could not encode a PNG"));
    reader.readAsDataURL(blob);
  });
}
