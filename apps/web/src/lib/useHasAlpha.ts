import { useEffect, useState } from "react";

// Detection is keyed by src so a re-render, a remount, or a Duplicate (which
// clones src) reuses the earlier scan instead of re-reading pixels. Keys are
// the layer's own data: URL string — already resident in the document store,
// so this holds a reference, not a copy.
const cache = new Map<string, boolean>();

/**
 * Whether an image carries real transparency — any pixel below fully opaque.
 * Opaque formats (JPEG) and flattened PNGs return false. Used to decide if a
 * layer earns a checkerboard backing.
 */
export function useHasAlpha(img: HTMLImageElement | null, src: string | null): boolean {
  const [hasAlpha, setHasAlpha] = useState(() => (src ? (cache.get(src) ?? false) : false));

  useEffect(() => {
    if (!src || !img) return;
    const known = cache.get(src);
    if (known !== undefined) {
      setHasAlpha(known);
      return;
    }
    // `img` can briefly be the previous src's image while the new one loads
    // (useImage keeps the old to avoid flicker; an in-place src swap triggers
    // this). Detecting against it would cache a wrong answer under the new src,
    // so wait until the loaded image actually matches src.
    if (img.src !== src) return;
    const result = detectAlpha(img);
    cache.set(src, result);
    setHasAlpha(result);
  }, [img, src]);

  return hasAlpha;
}

/**
 * Draw the image small and scan the alpha channel. Downsampling makes this
 * cheap and, if anything, more sensitive: any transparency inside a source
 * region drags that box-filtered sample below opaque. On a tainted canvas
 * (cross-origin) the read throws — we can't inspect, so assume opaque.
 */
function detectAlpha(img: HTMLImageElement): boolean {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) return false;

  const max = 64;
  const scale = Math.min(1, max / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return false;
  ctx.drawImage(img, 0, 0, cw, ch);

  try {
    const data = ctx.getImageData(0, 0, cw, ch).data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i]! < 250) return true;
    }
  } catch {
    return false;
  }
  return false;
}
