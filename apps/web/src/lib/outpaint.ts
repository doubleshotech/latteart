import { expandMask, maskedImage } from "./layerMask";
import type { Layer } from "../stores/documentStore";

/** Which sides to grow the canvas from. Default: all four (a uniform expand). */
export interface Dirs {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

/**
 * Everything an outpaint run needs, built client-side from the source layer.
 * The single source of truth for the shape — both the drill-in (producer) and
 * the generation store (`RunActionOpts.outpaint`, consumer) reference this type,
 * so the compiler forces every field (notably `mask`) to be threaded through.
 */
export interface OutpaintAssets {
  /** The expanded canvas (original + transparent padding) as a data: URL. */
  image: string;
  /** White-on-black edge mask (white = the new region to fill), same dims as `image`. */
  mask: string;
  /**
   * Layer mask for the *result*, or null when the source was unmasked. Every
   * other action inherits its source's mask untouched; an expand can't, because
   * the result is a different size — this one is the source's mask re-placed on
   * the expanded canvas with the new border revealed.
   */
  resultMask: string | null;
  /** Generation pixel size of the expanded canvas. */
  genWidth: number;
  genHeight: number;
  /** Result-layer geometry in canvas/display coords (the expanded box). */
  placement: { x: number; y: number; width: number; height: number };
}

/**
 * Longest side of the expanded generation canvas. Provider-agnostic hygiene: the
 * mock accepts any size, but cloud providers reject very large inputs, so the
 * whole canvas scales down uniformly to fit. Deliberately NOT snapped to a cloud
 * provider's fixed sizes — that would distort the aspect for every other provider
 * (see openai.ts's edit() note on how gpt-image-1 handles a non-standard source).
 */
const MAX_SIDE = 1536;

/** Load an image element from a data: URL, resolving once its pixels are ready.
 * Rejects rather than resolving null (unlike the shared `lib/loadImage`): without
 * the source there is no expand to build, and the drill-in surfaces the error. */
function loadImageOrThrow(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("source image failed to load"));
    img.src = src;
  });
}

/** A blank canvas of the expanded size, with its 2D context. Every asset here is
 * one of these plus a couple of draws. */
function expandedCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");
  return [canvas, ctx];
}

/**
 * Build the outpaint payload: place the source on a larger canvas padded on the
 * active sides, plus a white-on-black mask marking that new padding as the region
 * to fill (black over the original = preserve). The result layer's display box
 * grows by the same fractions so the original stays put on-canvas.
 */
export async function buildOutpaintAssets(
  source: Layer,
  dirs: Dirs,
  f: number,
): Promise<OutpaintAssets> {
  const img = await loadImageOrThrow(source.src!);
  const nw = img.naturalWidth || Math.round(source.width);
  const nh = img.naturalHeight || Math.round(source.height);

  const padL = dirs.left ? nw * f : 0;
  const padR = dirs.right ? nw * f : 0;
  const padT = dirs.up ? nh * f : 0;
  const padB = dirs.down ? nh * f : 0;

  // Raw expanded size, then a uniform scale so the longest side fits MAX_SIDE.
  const rawW = nw + padL + padR;
  const rawH = nh + padT + padB;
  const s = Math.min(1, MAX_SIDE / Math.max(rawW, rawH));
  const ew = Math.round(rawW * s);
  const eh = Math.round(rawH * s);
  const ox = Math.round(padL * s);
  const oy = Math.round(padT * s);
  const dw = Math.round(nw * s);
  const dh = Math.round(nh * s);

  // The rect the original still occupies on the expanded canvas — shared by all
  // three assets below, which is what keeps them aligned with each other.
  const rect = { x: ox, y: oy, width: dw, height: dh };

  // Expanded image: transparent padding + the source drawn at its offset. The
  // source goes on *masked* (lib/layerMask), so the model extends the image the
  // canvas shows rather than pixels the user hid.
  const [imgCanvas, ictx] = expandedCanvas(ew, eh);
  ictx.drawImage(source.mask ? await maskedImage(img, source.mask) : img, ox, oy, dw, dh);

  // Fill mask (white = regenerate): white everywhere, black over the original.
  const [maskCanvas, mctx] = expandedCanvas(ew, eh);
  mctx.fillStyle = "#fff";
  mctx.fillRect(0, 0, ew, eh);
  mctx.fillStyle = "#000";
  mctx.fillRect(ox, oy, dw, dh);

  // Result layer mask: the source's mask re-placed on the bigger canvas with the
  // new border revealed, so an expand grows the frame without resurrecting the
  // hidden region. Built by lib/layerMask, which owns what a mask's pixels mean.
  const resultMask = source.mask
    ? await expandMask(source.mask, { width: ew, height: eh }, rect)
    : null;

  // Display box grows by the same fractions (source keeps its on-canvas spot).
  const dPadL = dirs.left ? source.width * f : 0;
  const dPadR = dirs.right ? source.width * f : 0;
  const dPadT = dirs.up ? source.height * f : 0;
  const dPadB = dirs.down ? source.height * f : 0;

  return {
    image: imgCanvas.toDataURL("image/png"),
    mask: maskCanvas.toDataURL("image/png"),
    resultMask,
    genWidth: ew,
    genHeight: eh,
    placement: {
      x: source.x - dPadL,
      y: source.y - dPadT,
      width: source.width + dPadL + dPadR,
      height: source.height + dPadT + dPadB,
    },
  };
}
