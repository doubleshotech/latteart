import { compositeOperation, type BlendMode } from "@latteart/shared";
import type { Raster2D } from "./raster";

/**
 * Where a layer actually sits on the canvas.
 *
 * Konva rotates a node about its **top-left origin**, not its centre, so a
 * rotated layer's on-screen box is the axis-aligned hull of four rotated
 * corners — never `x, y, width, height`. Every offscreen compositor needs that
 * hull to frame its output (`lib/flatten` for export and AI Merge,
 * `lib/thumbnail` for switcher previews, `lib/ora` for the document canvas and
 * each layer's placement, and the topbar's "Fit" via `viewport.fitTo`), and all
 * four have to agree with the editor canvas and with each other. One
 * definition, one transform order.
 *
 * Measuring and drawing are both here, and that is the point: the transform
 * order — translate to the layer's origin, rotate about it, then draw the box —
 * has to be identical in both or a layer lands somewhere its measured hull
 * didn't predict. {@link corners} and {@link drawPlaced} are the two halves of
 * one rule, so changing it means changing this file.
 */

/** The geometry every layer-shaped value shares, structurally. Keeps this
 * usable by both the editor's `Layer` and the persisted `ProjectLayer`. */
export interface Placed {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Degrees, clockwise, about the top-left corner. */
  rotation: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The four corners of a layer's box after its rotation, in canvas coordinates. */
export function corners(l: Placed): { x: number; y: number }[] {
  const rad = (l.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [
    { x: 0, y: 0 },
    { x: l.width, y: 0 },
    { x: l.width, y: l.height },
    { x: 0, y: l.height },
  ].map((p) => ({ x: l.x + p.x * cos - p.y * sin, y: l.y + p.x * sin + p.y * cos }));
}

/** What a layer contributes to a composite beyond its geometry. Structural, so
 * both the editor's `Layer` and the persisted `ProjectLayer` satisfy it. */
export interface Composited extends Placed {
  opacity: number;
  /** Optional, matching the persisted shape: a project saved before blend modes
   * existed has none, and absent reads as "normal" — the same reading
   * {@link compositeOperation} gives it. */
  blendMode?: BlendMode | null;
}

/**
 * Draw one layer into `ctx` at its place in the composite, in the transform
 * order {@link corners} measures. `origin` is the composite's top-left in
 * canvas coordinates, so the layer lands relative to the frame being filled.
 *
 * Scaling is the caller's: apply `ctx.scale` once for the whole composite and
 * everything here stays in canvas units. Save/restore is handled, so a caller
 * can draw a stack in a plain loop.
 *
 * Opacity and blend mode ride along because every compositor needs them and
 * a caller that skipped one would silently disagree with the editor canvas.
 * The one caller that must *not* apply them — an OpenRaster layer, whose
 * opacity and blend mode stay live in `stack.xml` — passes `bare`.
 */
export function drawPlaced(
  ctx: Raster2D,
  layer: Composited,
  img: CanvasImageSource,
  origin: { x: number; y: number },
  opts: { bare?: boolean } = {},
): void {
  ctx.save();
  if (!opts.bare) {
    ctx.globalAlpha = layer.opacity;
    ctx.globalCompositeOperation = compositeOperation(layer.blendMode);
  }
  ctx.translate(layer.x - origin.x, layer.y - origin.y);
  ctx.rotate((layer.rotation * Math.PI) / 180);
  ctx.drawImage(img, 0, 0, layer.width, layer.height);
  ctx.restore();
}

/**
 * The axis-aligned box containing every given layer, or null when there are
 * none. Width and height are exact — callers round to whole pixels in whatever
 * direction their output demands.
 */
export function boundsOf(layers: Placed[]): Box | null {
  if (!layers.length) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const l of layers) {
    for (const p of corners(l)) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
