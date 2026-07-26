/**
 * Custom styles v2 — the shared framing for native reference-image conditioning.
 *
 * A provider with the `styleRef` capability receives a custom style's source
 * pixels alongside the prompt (see `resolveStyleRefs` in the routes). The pixels
 * alone are not enough: every image model tested treats an extra image as
 * content to blend, reproduce, or edit. The wording below is what turns those
 * images into a *style* guide, and it is the difference between "painted in that
 * style" and "a copy of the reference".
 *
 * It lives here rather than in one provider because it is prompt engineering,
 * not transport — Gemini sends the refs as `inlineData` parts and OpenAI sends
 * them as `image[]` multipart entries, but both need the *same* framing. Keeping
 * one copy means tuning the wording improves every provider at once and the
 * behaviour can't silently drift apart.
 */

/**
 * The style-only framing clause for `count` trailing reference images.
 *
 * Positional by design: it says "the final N images", so callers MUST append the
 * refs last — after the prompt and after any source image being edited.
 */
export function styleRefInstruction(count: number): string {
  const subject =
    count === 1
      ? "The final image is a STYLE REFERENCE"
      : `The final ${count} images are STYLE REFERENCES`;
  const poss = count === 1 ? "its" : "their";
  const obj = count === 1 ? "it" : "them";
  return `\n\n${subject}, not content to reproduce. Match ${poss} artistic style — color palette, lighting, texture, brushwork, and overall rendering — while creating the scene described above. Do not copy the subject, objects, or composition of ${obj}.`;
}

/**
 * Suffix an instruction with the style-only framing, or return it untouched when
 * there are no refs. `count` is the number of refs that actually made it into
 * the request — count the *decoded* refs, not the requested ones, or the
 * instruction will point at images that were never sent.
 */
export function withStyleRefInstruction(base: string, count: number): string {
  return count > 0 ? `${base}${styleRefInstruction(count)}` : base;
}
