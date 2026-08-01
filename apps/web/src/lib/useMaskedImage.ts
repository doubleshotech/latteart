import { useEffect, useState } from "react";
import { maskedImage } from "./layerMask";

/**
 * The drawable a masked layer renders on the Konva canvas: `img` itself when
 * there's no mask, otherwise `img` composited through it (see lib/layerMask).
 *
 * Compositing is async, so a just-set or just-edited mask lands a frame late. We
 * hold the previous drawable until the new one is ready and fall back to the raw
 * image rather than to nothing — a frame of unmasked pixels reads as a redraw,
 * while a frame of null reads as the layer vanishing.
 */
export function useMaskedImage(
  img: HTMLImageElement | null,
  mask: string | null,
): CanvasImageSource | null {
  const [masked, setMasked] = useState<CanvasImageSource | null>(null);

  useEffect(() => {
    if (!img || !mask) {
      setMasked(null);
      return;
    }
    let alive = true;
    void maskedImage(img, mask).then((out) => {
      if (alive) setMasked(out);
    });
    return () => {
      alive = false;
    };
  }, [img, mask]);

  if (!mask) return img;
  return masked ?? img;
}
