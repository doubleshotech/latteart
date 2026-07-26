import type { ProjectLayer } from "@latteart/shared";

/**
 * Flatten the canvas to a small preview image for the project switcher's list.
 *
 * This is deliberately a *separate* compositor from the Konva canvas rather
 * than a `stage.toDataURL()`: the stage only exists while a project is open and
 * on screen, but a thumbnail has to be produced for whichever project is being
 * saved — including during the save that happens as we switch away from it.
 * Working from the saved layer data keeps thumbnailing independent of what's
 * currently mounted.
 *
 * Framing follows the layers, not the output size: the box is the union of
 * every visible layer, so a project whose work sits off-origin still previews
 * as the thing the user arranged rather than a mostly-empty crop.
 */

const MAX_W = 320;
const MAX_H = 200;

/** The four corners of a layer's box after its rotation about the top-left. */
function corners(l: ProjectLayer): { x: number; y: number }[] {
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

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null); // a broken layer shouldn't fail the save
    img.src = src;
  });
}

/**
 * Composite the given layers into a PNG data URL, or return null when there's
 * nothing to show (no visible layers with pixels). Callers treat null as "this
 * project has no thumbnail" rather than an error.
 */
export async function renderThumbnail(layers: ProjectLayer[]): Promise<string | null> {
  const visible = layers.filter((l) => l.visible && l.opacity > 0 && typeof l.src === "string");
  if (visible.length === 0) return null;

  const pts = visible.flatMap(corners);
  const minX = Math.min(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  const boxW = Math.max(...pts.map((p) => p.x)) - minX;
  const boxH = Math.max(...pts.map((p) => p.y)) - minY;
  if (!(boxW > 0) || !(boxH > 0)) return null;

  const scale = Math.min(MAX_W / boxW, MAX_H / boxH, 1);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(boxW * scale));
  canvas.height = Math.max(1, Math.round(boxH * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // Load first, draw second: drawing must stay in z-order, and awaiting inside
  // the draw loop would interleave the layers.
  const images = await Promise.all(visible.map((l) => loadImage(l.src!)));

  let drew = false;
  visible.forEach((l, i) => {
    const img = images[i];
    if (!img) return;
    ctx.save();
    ctx.globalAlpha = l.opacity;
    // Match the canvas's transform order: translate to the layer's origin,
    // rotate about it, then draw the box — the same basis `corners()` measured.
    ctx.translate((l.x - minX) * scale, (l.y - minY) * scale);
    ctx.rotate((l.rotation * Math.PI) / 180);
    ctx.drawImage(img, 0, 0, l.width * scale, l.height * scale);
    ctx.restore();
    drew = true;
  });
  if (!drew) return null;

  return canvas.toDataURL("image/png");
}
