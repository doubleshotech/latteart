/**
 * Where a layer actually sits on the canvas.
 *
 * Konva rotates a node about its **top-left origin**, not its centre, so a
 * rotated layer's on-screen box is the axis-aligned hull of four rotated
 * corners — never `x, y, width, height`. Every offscreen compositor needs that
 * hull to frame its output (`lib/flatten` for export and AI Merge,
 * `lib/thumbnail` for switcher previews, `lib/ora` for the document canvas and
 * each layer's placement), and all three have to agree with the editor canvas
 * and with each other. One definition, one transform order.
 *
 * The transform order encoded here — translate to the layer's origin, rotate
 * about it, then draw the box — is the same order the drawing loops use. If one
 * changes, both do.
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
