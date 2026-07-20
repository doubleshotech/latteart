import type { PaletteHint } from "@latteart/shared";

/**
 * Client-side color/tone analysis of reference images for custom styles. The
 * browser decodes any image format natively, so extraction runs here and the
 * result rides along as a {@link PaletteHint} — the backend stays image-decode-
 * free and uses the hint only as the offline heuristic's input (a reachable
 * vision model ignores it and reads the pixels directly).
 */

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not decode image"));
    img.src = src;
  });
}

/** Draw an image onto a small offscreen canvas (longest side ≤ max), for cheap
 * pixel reads. Returns the canvas + its 2D context and dimensions. */
function drawScaled(img: HTMLImageElement, max: number) {
  const scale = Math.min(1, max / Math.max(img.width, img.height, 1));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx?.drawImage(img, 0, 0, w, h);
  return { canvas, ctx, w, h };
}

/** Bucket center → `#rrggbb`. Buckets are 3 bits/channel; center = n*32 + 16. */
function bucketToHex(key: number): string {
  const r = ((key >> 6) & 7) * 32 + 16;
  const g = ((key >> 3) & 7) * 32 + 16;
  const b = (key & 7) * 32 + 16;
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Summarize the dominant colors and mean brightness/saturation of one or more
 * images. Pixels are quantized into a coarse 3-bit-per-channel histogram; the
 * top buckets become the palette. Undecodable images are skipped.
 */
export async function extractPaletteHint(images: string[]): Promise<PaletteHint> {
  const counts = new Map<number, number>();
  let brightnessSum = 0;
  let saturationSum = 0;
  let samples = 0;

  for (const src of images) {
    let img: HTMLImageElement;
    try {
      img = await loadImage(src);
    } catch {
      continue;
    }
    const { ctx, w, h } = drawScaled(img, 64);
    if (!ctx) continue;
    const { data } = ctx.getImageData(0, 0, w, h);
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3]! < 128) continue; // skip near-transparent pixels
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      brightnessSum += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const mx = Math.max(r, g, b) / 255;
      const mn = Math.min(r, g, b) / 255;
      const l = (mx + mn) / 2;
      saturationSum += mx === mn ? 0 : l > 0.5 ? (mx - mn) / (2 - mx - mn) : (mx - mn) / (mx + mn);
      samples++;
      const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  const colors = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([key]) => bucketToHex(key));

  return {
    colors,
    brightness: samples ? brightnessSum / samples : 0,
    saturation: samples ? saturationSum / samples : 0,
  };
}

/** A small JPEG data: URL preview (longest side ≤ max) for the style picker, or
 * undefined if the source can't be decoded. */
export async function makeThumbnail(src: string, max = 256): Promise<string | undefined> {
  try {
    const img = await loadImage(src);
    const { canvas } = drawScaled(img, max);
    return canvas.toDataURL("image/jpeg", 0.82);
  } catch {
    return undefined;
  }
}

/** Read a File (from a picker or drop) as a data: URL. */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}
