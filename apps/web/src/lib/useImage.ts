import { useEffect, useState } from "react";

/** Load an HTMLImageElement from a src (data: URL) for use as a Konva image. */
export function useImage(src: string | null): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!src) {
      setImg(null);
      return;
    }
    const image = new Image();
    image.src = src;
    const onLoad = () => setImg(image);
    if (image.complete) onLoad();
    else image.addEventListener("load", onLoad);
    return () => image.removeEventListener("load", onLoad);
  }, [src]);

  return img;
}
