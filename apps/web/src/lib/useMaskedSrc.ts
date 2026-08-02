import { useEffect, useState } from "react";
import { maskedSource } from "./layerMask";

/**
 * The URL of a layer's masked pixels for the surfaces that work on an `<img>` or
 * a data URL rather than a decoded image — the inpaint backdrop you paint on and
 * the matte Smart edit segments. `src` itself when there's no mask.
 *
 * **Null while the composite is being built** (and only then). It would be
 * friendlier to render the raw pixels for that frame the way `useMaskedImage`
 * does, but this hook feeds decisions, not just paint: Smart edit segments
 * whatever it returns, and a matte built from the unmasked frame stays wrong —
 * `maskFromMatte` doesn't re-run when the pixels arrive, so it would be the mask
 * that reached the provider. Callers already have an unready branch (a
 * placeholder chip, a disabled button); one more frame in it costs nothing.
 *
 * A mask that can't be decoded resolves to `src`, matching every other renderer:
 * losing the mask shows too much, losing the layer shows nothing.
 */
export function useMaskedSrc(src: string | null, mask: string | null | undefined): string | null {
  const [masked, setMasked] = useState<string | null>(null);

  useEffect(() => {
    // Clear first: the previous composite describes the previous layer, and
    // returning it for this one would be worse than returning nothing.
    setMasked(null);
    if (!src || !mask) return;

    let alive = true;
    void maskedSource(src, mask).then((out) => {
      if (alive) setMasked(out ?? src);
    });
    return () => {
      alive = false;
    };
  }, [src, mask]);

  if (!mask) return src;
  return masked;
}
