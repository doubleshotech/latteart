import { imageKey } from "./imageKey";
import { loadImage, naturalSize } from "./loadImage";

/**
 * Layer masks — the compositing half.
 *
 * A mask is a grayscale image where white reveals the layer and black hides it
 * (the Photoshop/GIMP convention). It is stored opaque white-on-black, the same
 * artifact an inpaint mask is: one white-on-black PNG, read as "regenerate here"
 * by {@link ../components/MaskEditor} and as "reveal here" by a layer mask. That
 * shared shape is why `lib/autoMask` can feed both.
 *
 * Canvas compositing masks by *alpha*, not luminance, so an opaque white-on-black
 * mask is a no-op as a `destination-in` source — every pixel is alpha 255. The
 * conversion to an alpha stencil is the one real computation here, and the one
 * thing worth caching: it's a full pixel walk, while applying a cached stencil is
 * two `drawImage` calls.
 *
 * Every renderer goes through {@link maskedImage} — the Konva canvas
 * (via `useMaskedImage`), `lib/flatten` (AI Merge + export) and `lib/thumbnail`
 * (switcher previews) — so a masked layer looks the same on screen, in an export
 * and in its project's preview.
 */

/**
 * Perceived brightness of a pixel, 0..255 — the single definition of "how much
 * does this mask pixel reveal", shared by the stencil below and the layer-mask
 * editor's on-screen scrim so the preview can't drift from the result.
 * Rec. 601 luma with integer weights summing to 256, so the shift is exact.
 */
export function luma(r: number, g: number, b: number): number {
  return (r * 77 + g * 150 + b * 29) >> 8;
}

/**
 * Bytes of stencil we're willing to hold. Capping *entries* would be meaningless
 * — one 4096² stencil is 64 MB on its own — so the budget is in pixels paid for,
 * evicted oldest-first. Sized to hold a working set of a few large masks.
 */
const STENCIL_BUDGET = 64 * 1024 * 1024;

interface Stencil {
  canvas: Promise<HTMLCanvasElement | null>;
  /** RGBA bytes, counted once the canvas resolves (0 until then). */
  bytes: number;
}

const stencils = new Map<string, Stencil>();
let cachedBytes = 0;

function evict(): void {
  for (const [key, entry] of stencils) {
    if (cachedBytes <= STENCIL_BUDGET) return;
    stencils.delete(key);
    cachedBytes -= entry.bytes;
  }
}

/**
 * Drop every cached stencil. Called when the open project changes: those masks
 * belong to a document that's no longer on screen, and the incoming one has its
 * own. Without this the cache only ever grows across a session of switching.
 */
export function clearMaskStencils(): void {
  stencils.clear();
  cachedBytes = 0;
}

/**
 * Build the alpha stencil for a mask: luminance becomes alpha, colour is zeroed.
 * The result is only ever used as a `destination-in` source, where nothing but
 * the alpha channel is read.
 *
 * A mask's own transparency is ignored — every mask this app produces is opaque,
 * and treating a transparent pixel as "hidden" (luminance 0) is the sane reading
 * of one that isn't.
 */
async function buildStencil(mask: string): Promise<HTMLCanvasElement | null> {
  const img = await loadImage(mask);
  const size = naturalSize(img);
  if (!img || !size) return null;

  const canvas = document.createElement("canvas");
  canvas.width = size.w;
  canvas.height = size.h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);

  const image = ctx.getImageData(0, 0, size.w, size.h);
  const px = image.data;
  for (let i = 0; i < px.length; i += 4) {
    px[i + 3] = luma(px[i]!, px[i + 1]!, px[i + 2]!);
    px[i] = 0;
    px[i + 1] = 0;
    px[i + 2] = 0;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/** The cached alpha stencil for a mask, or null if it can't be decoded. A
 * failure is evicted rather than cached, so a transient decode error doesn't
 * permanently disable the mask. */
function stencilFor(mask: string): Promise<HTMLCanvasElement | null> {
  const key = imageKey(mask);
  const hit = stencils.get(key);
  if (hit) return hit.canvas;

  const entry: Stencil = { canvas: Promise.resolve(null), bytes: 0 };
  entry.canvas = buildStencil(mask).then(
    (canvas) => {
      if (!canvas) {
        stencils.delete(key);
        return null;
      }
      entry.bytes = canvas.width * canvas.height * 4;
      cachedBytes += entry.bytes;
      evict();
      return canvas;
    },
    () => {
      stencils.delete(key);
      return null;
    },
  );
  stencils.set(key, entry);
  return entry.canvas;
}

/**
 * The layer's pixels with its mask applied, as a drawable at the image's native
 * resolution. The mask is stretched to those dimensions, exactly as the layer's
 * own pixels are stretched to its box — so a mask painted at any resolution
 * lines up.
 *
 * An undecodable mask returns the image untouched: losing the mask shows too
 * much, losing the layer shows nothing, and the first is the better failure.
 *
 * The composite itself isn't cached (two `drawImage`s over a cached stencil);
 * callers that re-render often memoize the result instead.
 */
export async function maskedImage(img: HTMLImageElement, mask: string): Promise<CanvasImageSource> {
  const stencil = await stencilFor(mask);
  if (!stencil) return img;

  const w = img.naturalWidth || 1;
  const h = img.naturalHeight || 1;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return img;

  ctx.drawImage(img, 0, 0, w, h);
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(stencil, 0, 0, w, h);
  return canvas;
}

/** `maskedImage` for a possibly-unmasked layer: loads `src`, applies `mask` when
 * there is one. Null when the pixels can't be loaded, which callers treat as a
 * layer to skip. The shared entry point for the offscreen compositors. */
export async function loadMaskedLayer(
  src: string,
  mask: string | null | undefined,
): Promise<CanvasImageSource | null> {
  const img = await loadImage(src);
  if (!img) return null;
  return mask ? maskedImage(img, mask) : img;
}

/** Below this, a mask pixel is hiding something. Just under fully-white, so
 * anti-aliased edges and near-white matte values still count as coverage. */
const HIDDEN_BELOW = 250;

/**
 * Whether a mask actually hides anything — the test for "is this mask worth
 * persisting". A mask that reveals everything is indistinguishable from no mask
 * but costs a stored asset, a composite on every render, and the whole masked-
 * layer treatment in the UI, so it's stored as null instead.
 *
 * Scans a downsampled copy: cheap, and if anything *more* sensitive than a full
 * scan, since box-filtering a small hidden speck still drags its sample below
 * white. Same trick as `useHasAlpha`'s detection.
 */
export function masksAnything(mask: HTMLCanvasElement): boolean {
  const max = 64;
  const scale = Math.min(1, max / Math.max(mask.width, mask.height));
  const w = Math.max(1, Math.round(mask.width * scale));
  const h = Math.max(1, Math.round(mask.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return true; // can't tell — keep the mask rather than silently drop it
  ctx.drawImage(mask, 0, 0, w, h);

  const px = ctx.getImageData(0, 0, w, h).data;
  for (let i = 0; i < px.length; i += 4) {
    if (luma(px[i]!, px[i + 1]!, px[i + 2]!) < HIDDEN_BELOW) return true;
  }
  return false;
}

/** Invert a mask (white ⇄ black), turning "keep this" into "keep everything
 * else". Alpha is preserved; only luminance flips. */
export async function invertMask(mask: string): Promise<string> {
  const img = await loadImage(mask);
  const size = naturalSize(img);
  if (!img || !size) return mask;

  const canvas = document.createElement("canvas");
  canvas.width = size.w;
  canvas.height = size.h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return mask;
  ctx.drawImage(img, 0, 0);

  const image = ctx.getImageData(0, 0, size.w, size.h);
  const px = image.data;
  for (let i = 0; i < px.length; i += 4) {
    px[i] = 255 - px[i]!;
    px[i + 1] = 255 - px[i + 1]!;
    px[i + 2] = 255 - px[i + 2]!;
  }
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL("image/png");
}
