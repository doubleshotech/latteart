/**
 * Brush strokes, shared by the two mask painters: the inpaint Edit-area overlay
 * (`components/MaskEditor`) and the layer-mask editor (`components/LayerMaskEditor`).
 * Geometry only — what a stroke *means* is the caller's business.
 */

/** A brush stroke in the target image's native pixel coordinates. */
export interface Stroke {
  size: number;
  points: { x: number; y: number }[];
}

/** Paint one stroke with the context's current fill/stroke style. A single
 * point is a dot rather than a zero-length line, which no line cap would draw. */
export function renderStroke(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (stroke.points.length === 1) {
    const p = stroke.points[0]!;
    ctx.beginPath();
    ctx.arc(p.x, p.y, stroke.size / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.lineWidth = stroke.size;
  ctx.beginPath();
  ctx.moveTo(stroke.points[0]!.x, stroke.points[0]!.y);
  for (const p of stroke.points.slice(1)) ctx.lineTo(p.x, p.y);
  ctx.stroke();
}

/** Paint every stroke into `ctx` in `color` (round caps; single points = dots). */
export function renderStrokes(
  ctx: CanvasRenderingContext2D,
  strokes: Stroke[],
  color: string,
): void {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  for (const s of strokes) renderStroke(ctx, s);
}
