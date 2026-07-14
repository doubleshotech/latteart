let cached: HTMLImageElement | null = null;

/**
 * A 2×2-cell checkerboard tile, built once and reused as a Konva
 * `fillPatternImage`. Konva forwards it straight to
 * `CanvasRenderingContext2D.createPattern`, which happily accepts a canvas —
 * the type just wants an <img>, so we present the canvas as one.
 */
export function checkerPattern(): HTMLImageElement {
  if (cached) return cached;
  const cell = 8;
  const size = cell * 2;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#e6e6e6"; // light square
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "#bcbcbc"; // dark square
    ctx.fillRect(0, 0, cell, cell);
    ctx.fillRect(cell, cell, cell, cell);
  }
  cached = c as unknown as HTMLImageElement;
  return cached;
}
