// node:test's describe()/it() are fire-and-forget by design (the runner awaits them).
/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { styleRefInstruction, withStyleRefInstruction } from "./styleRef.ts";

/**
 * The style-only framing clause is shared by every provider that conditions on
 * a custom style's pixels (Gemini, OpenAI, mock), so a regression here would
 * silently degrade all of them at once — each provider's own suite only checks
 * that *some* clause was appended, not what it says. These tests pin the two
 * properties the providers actually depend on: the positional "final N images"
 * wording, and grammatical agreement across the singular/plural boundary.
 */

describe("styleRefInstruction", () => {
  it("uses singular wording and pronouns for one reference", () => {
    const text = styleRefInstruction(1);
    assert.match(text, /The final image is a STYLE REFERENCE/);
    assert.match(text, /Match its artistic style/);
    assert.match(text, /composition of it\./);
    assert.doesNotMatch(text, /images are/);
  });

  it("uses plural wording, the count, and plural pronouns for several", () => {
    const text = styleRefInstruction(3);
    assert.match(text, /The final 3 images are STYLE REFERENCES/);
    assert.match(text, /Match their artistic style/);
    assert.match(text, /composition of them\./);
  });

  it("states the style-only contract every provider relies on", () => {
    // Without this, image models treat an extra image as content to reproduce
    // or edit rather than a look to emulate — the crux of native conditioning.
    const text = styleRefInstruction(2);
    assert.match(text, /not content to reproduce/);
    assert.match(text, /Do not copy the subject, objects, or composition/);
  });

  it("keeps the refs positional, so callers must append them last", () => {
    // Providers order their parts around this promise: Gemini appends trailing
    // inlineData parts, OpenAI appends trailing image[] entries.
    assert.match(styleRefInstruction(1), /^\n\nThe final image/);
    assert.match(styleRefInstruction(4), /^\n\nThe final 4 images/);
  });
});

describe("withStyleRefInstruction", () => {
  it("returns the prompt untouched when there are no refs", () => {
    assert.equal(withStyleRefInstruction("a red bird", 0), "a red bird");
  });

  it("appends the clause after the prompt, leaving the prompt in front", () => {
    const text = withStyleRefInstruction("a red bird", 2);
    assert.match(text, /^a red bird/, "the user's words lead");
    assert.match(text, /The final 2 images are STYLE REFERENCES/);
  });
});
