// node:test's describe()/it() are fire-and-forget by design (the runner awaits
// them), so the floating-promise rule doesn't apply in this test file.
/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseStyleDescriptor } from "./ollama.ts";

/**
 * Unit tests for the style-reply parser — the one bit of the vision
 * describeStyle path that's pure and testable offline. Covers labelled output,
 * the optional negatives line, and a model that ignores the label format.
 */
describe("parseStyleDescriptor", () => {
  it("splits labelled Style: and Avoid: lines into prompt + negativePrompt", () => {
    const r = parseStyleDescriptor(
      "Style: muted teal palette, grainy 35mm film\nAvoid: neon, oversaturated",
    );
    assert.equal(r.prompt, "muted teal palette, grainy 35mm film");
    assert.equal(r.negativePrompt, "neon, oversaturated");
  });

  it("leaves negativePrompt undefined when there is no Avoid line", () => {
    const r = parseStyleDescriptor("Style: soft watercolor washes, visible paper texture");
    assert.equal(r.prompt, "soft watercolor washes, visible paper texture");
    assert.equal(r.negativePrompt, undefined);
  });

  it("falls back to the whole reply when the model ignores the labels", () => {
    const r = parseStyleDescriptor("bold flat vector shapes, high contrast");
    assert.equal(r.prompt, "bold flat vector shapes, high contrast");
    assert.equal(r.negativePrompt, undefined);
  });

  it("strips wrapping quotes and collapses whitespace", () => {
    const r = parseStyleDescriptor('Style:  "cinematic  film still,   moody grade"  ');
    assert.equal(r.prompt, "cinematic film still, moody grade");
  });

  it("accepts Negative: as an alias for the avoid line", () => {
    const r = parseStyleDescriptor("Style: anime cel shading\nNegative: photorealistic");
    assert.equal(r.negativePrompt, "photorealistic");
  });
});
