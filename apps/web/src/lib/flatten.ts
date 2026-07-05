import type { Layer } from "../stores/documentStore";

export interface FlatResult {
  /** The composited image as a PNG data URL. */
  dataUrl: string;
  /** Bounding box of the merged layers, in canvas/world coordinates. */
  box: { x: number; y: number; width: number; height: number };
}

/**
 * Composite the visible layers (bottom→top = array order) into a single PNG.
 * Pure raster — draws each layer's src at its geometry (position, size, rotation,
 * opacity) onto an offscreen canvas, independent of the current zoom/pan and
 * without the canvas chrome (shadows, selection). Returns the data URL plus the
 * merged bounding box so callers can place the result exactly over the source.
 *
 * `maxSide` caps the longest output edge (keeps the AI-merge payload bounded);
 * `pixelRatio` supersamples for a crisp export.
 */
export async function flattenLayers(
  layers: Layer[],
  opts: { pixelRatio?: number; maxSide?: number } = {},
): Promise<FlatResult | null> {
  const visible = layers.filter((l) => l.visible && l.src);
  if (!visible.length) return null;

  // Rotation-aware bounding box (Konva rotates a node about its top-left origin).
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const l of visible) {
    const r = (l.rotation * Math.PI) / 180;
    const cos = Math.cos(r);
    const sin = Math.sin(r);
    for (const [px, py] of [
      [0, 0],
      [l.width, 0],
      [l.width, l.height],
      [0, l.height],
    ]) {
      const x = l.x + px * cos - py * sin;
      const y = l.y + px * sin + py * cos;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  const width = Math.max(1, Math.ceil(maxX - minX));
  const height = Math.max(1, Math.ceil(maxY - minY));

  let scale = opts.pixelRatio ?? 2;
  if (opts.maxSide) {
    const longest = Math.max(width, height) * scale;
    if (longest > opts.maxSide) scale = opts.maxSide / Math.max(width, height);
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(scale, scale);

  const load = (src: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("layer image failed to load"));
      img.src = src;
    });

  for (const l of visible) {
    const img = await load(l.src!);
    ctx.save();
    ctx.globalAlpha = l.opacity;
    ctx.translate(l.x - minX, l.y - minY);
    ctx.rotate((l.rotation * Math.PI) / 180);
    ctx.drawImage(img, 0, 0, l.width, l.height);
    ctx.restore();
  }

  return {
    dataUrl: canvas.toDataURL("image/png"),
    box: { x: minX, y: minY, width, height },
  };
}
