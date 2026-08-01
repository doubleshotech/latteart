/**
 * Decode an image from a data: URL.
 *
 * Resolves null rather than rejecting: every caller here is compositing pixels
 * that are nice-to-have (a mask, a layer in a thumbnail), and the useful
 * response to "this didn't decode" is always to carry on without it rather than
 * to fail the render, the save, or the export.
 */
export function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** A decoded image's natural size, or null when it has none (failed decode, or
 * a zero-dimension image — both of which make it unusable as a source). */
export function naturalSize(img: HTMLImageElement | null): { w: number; h: number } | null {
  const w = img?.naturalWidth ?? 0;
  const h = img?.naturalHeight ?? 0;
  return w && h ? { w, h } : null;
}
