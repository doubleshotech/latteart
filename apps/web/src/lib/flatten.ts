import { compositeOperation } from "@latteart/shared";
import { boundsOf, type Box } from "./bounds";
import { loadMaskedLayer } from "./layerMask";
import type { Layer } from "../stores/documentStore";

export interface FlatResult {
  /** The composited image as a PNG data URL. */
  dataUrl: string;
  /** Bounding box of the merged layers, in canvas/world coordinates. */
  box: Box;
}

/**
 * Composite the visible layers (bottom→top = array order) into a single PNG.
 * Pure raster — draws each layer's src at its geometry (position, size, rotation,
 * opacity, blend mode, mask) onto an offscreen canvas, independent of the current
 * zoom/pan and without the canvas chrome (shadows, selection). Returns the data URL
 * plus the merged bounding box so callers can place the result exactly over the source.
 *
 * `maxSide` caps the longest output edge (keeps the AI-merge payload bounded);
 * `pixelRatio` supersamples for a crisp export.
 *
 * `box` pins the frame instead of measuring one, for a caller that already knows
 * which region it wants filled — `lib/ora` renders its merged image over the
 * whole document, which includes hidden layers this compositor would otherwise
 * crop away. With a box given, the output is exactly
 * `round(box.width × pixelRatio)` by `round(box.height × pixelRatio)` pixels, so
 * a caller can state a size up front and rely on getting it.
 */
export async function flattenLayers(
  layers: Layer[],
  opts: { pixelRatio?: number; maxSide?: number; box?: Box } = {},
): Promise<FlatResult | null> {
  const visible = layers.filter((l) => l.visible && l.src);
  if (!visible.length) return null;

  const measured = boundsOf(visible);
  if (!measured) return null;
  // Whole pixels before scaling: the reported box is what a caller places the
  // result at, and it has to describe the pixels that were actually produced.
  const box = opts.box ?? {
    x: measured.x,
    y: measured.y,
    width: Math.max(1, Math.ceil(measured.width)),
    height: Math.max(1, Math.ceil(measured.height)),
  };

  let scale = opts.pixelRatio ?? 2;
  if (opts.maxSide) {
    const longest = Math.max(box.width, box.height) * scale;
    if (longest > opts.maxSide) scale = opts.maxSide / Math.max(box.width, box.height);
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(box.width * scale));
  canvas.height = Math.max(1, Math.round(box.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(scale, scale);

  for (const l of visible) {
    // Masked through lib/layerMask, so an export and the on-screen canvas agree.
    // The mask has to resolve into the layer's own pixels *before* the layer
    // composites onto the stack — applying it afterwards would erase whatever
    // sits beneath it too.
    const img = await loadMaskedLayer(l.src!, l.mask);
    if (!img) throw new Error("layer image failed to load");
    ctx.save();
    ctx.globalAlpha = l.opacity;
    ctx.globalCompositeOperation = compositeOperation(l.blendMode);
    ctx.translate(l.x - box.x, l.y - box.y);
    ctx.rotate((l.rotation * Math.PI) / 180);
    ctx.drawImage(img, 0, 0, l.width, l.height);
    ctx.restore();
  }

  return { dataUrl: canvas.toDataURL("image/png"), box };
}
