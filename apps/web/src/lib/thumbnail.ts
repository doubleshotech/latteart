import type { ProjectLayer } from "@latteart/shared";
import { boundsOf, drawPlaced } from "./bounds";
import { loadMaskedLayer } from "./layerMask";

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

/** A layer's drawable pixels, masked if it carries a mask. Null on a failed
 * load — a broken layer shouldn't fail the save. */
function loadLayer(l: ProjectLayer): Promise<CanvasImageSource | null> {
  return loadMaskedLayer(l.src!, l.mask).catch(() => null);
}

/**
 * Composite the given layers into a PNG data URL, or return null when there's
 * nothing to show (no visible layers with pixels). Callers treat null as "this
 * project has no thumbnail" rather than an error.
 */
export async function renderThumbnail(layers: ProjectLayer[]): Promise<string | null> {
  const visible = layers.filter((l) => l.visible && l.opacity > 0 && typeof l.src === "string");
  if (visible.length === 0) return null;

  const box = boundsOf(visible);
  if (!box || !(box.width > 0) || !(box.height > 0)) return null;

  const scale = Math.min(MAX_W / box.width, MAX_H / box.height, 1);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(box.width * scale));
  canvas.height = Math.max(1, Math.round(box.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  // Scale once for the whole composite; drawPlaced then works in canvas units.
  ctx.scale(scale, scale);

  // Load first, draw second: drawing must stay in z-order, and awaiting inside
  // the draw loop would interleave the layers.
  const images = await Promise.all(visible.map(loadLayer));

  let drew = false;
  visible.forEach((l, i) => {
    const img = images[i];
    if (!img) return;
    drawPlaced(ctx, l, img, box);
    drew = true;
  });
  if (!drew) return null;

  return canvas.toDataURL("image/png");
}
