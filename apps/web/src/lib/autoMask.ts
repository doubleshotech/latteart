import type { Matte } from "./removeBackgroundAI";

/**
 * Turn an RMBG foreground matte into an inpaint mask. RMBG only tells subject
 * from background, so those are the two things Smart edit can auto-select:
 *  - "background" → regenerate everything behind the subject (subject locked)
 *  - "subject"    → regenerate the subject (background locked)
 */
export type MaskTarget = "subject" | "background";

/** Words that put the edit behind the subject → default the toggle to background.
 * A default only — the user confirms/flips it before anything is generated, so
 * the list leans generous toward common scene/place/setting words. */
const BACKGROUND_HINTS =
  /\b(background|backdrop|behind|scene|scenery|setting|surroundings|environment|landscape|cityscape|sky|horizon|clouds?|sunset|sunrise|dawn|dusk|forest|woods|jungle|beach|shore|ocean|sea|lake|river|waterfall|mountains?|desert|field|meadow|garden|park|street|road|city|room|indoors|outdoors|studio|wall|floor|snow|rain)\b/i;

export function guessTarget(instruction: string): MaskTarget {
  return BACKGROUND_HINTS.test(instruction) ? "background" : "subject";
}

/** Fill tint for the on-screen mask preview — matches MaskEditor's paint tint. */
const MASK_TINT: [number, number, number, number] = [238, 161, 69, 140];

/** Foreground probability → "should this pixel regenerate?" for the target.
 * RMBG matte is foreground-high; a background edit is the inverse. */
function regenerates(fg: number, target: MaskTarget): boolean {
  const m = target === "background" ? 255 - fg : fg;
  return m >= 128; // threshold the soft matte to a crisp region
}

function newCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context for auto-mask");
  return [canvas, ctx];
}

/**
 * Build the opaque white-on-black inpaint mask (white = regenerate) at the
 * matte's native resolution — the exact convention MaskEditor's hand-painted
 * mask produces, so it flows through /api/edit and every inpaint provider
 * unchanged.
 */
export function maskFromMatte(matte: Matte, target: MaskTarget): string {
  const { data, width, height } = matte;
  const [canvas, ctx] = newCanvas(width, height);
  const out = ctx.createImageData(width, height);
  for (let i = 0; i < data.length; i++) {
    const on = regenerates(data[i]!, target) ? 255 : 0;
    const o = i * 4;
    out.data[o] = on;
    out.data[o + 1] = on;
    out.data[o + 2] = on;
    out.data[o + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  return canvas.toDataURL("image/png");
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("preview source failed to load"));
    img.src = src;
  });
}

/**
 * Composite the source under a translucent tint over the region that will
 * regenerate — the confirm-before-you-spend-a-generation preview. Lets the user
 * catch a wrong subject or a mis-guessed target before committing.
 */
export async function previewFromMatte(
  sourceDataUrl: string,
  matte: Matte,
  target: MaskTarget,
): Promise<string> {
  const { data, width, height } = matte;
  const img = await loadImage(sourceDataUrl);
  const [canvas, ctx] = newCanvas(width, height);
  ctx.drawImage(img, 0, 0, width, height);

  // The tint rides on its own layer so drawImage alpha-blends it over the source.
  const [tint, tctx] = newCanvas(width, height);
  const overlay = tctx.createImageData(width, height);
  const [r, g, b, a] = MASK_TINT;
  for (let i = 0; i < data.length; i++) {
    if (!regenerates(data[i]!, target)) continue;
    const o = i * 4;
    overlay.data[o] = r;
    overlay.data[o + 1] = g;
    overlay.data[o + 2] = b;
    overlay.data[o + 3] = a;
  }
  tctx.putImageData(overlay, 0, 0);
  ctx.drawImage(tint, 0, 0);
  return canvas.toDataURL("image/png");
}
