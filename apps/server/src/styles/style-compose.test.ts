// node:test's describe()/it() are fire-and-forget by design (the runner awaits
// them), so the floating-promise rule doesn't apply in this test file.
/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { composeStyle } from "@latteart/shared";
import { heuristicDescriptor } from "./heuristic.ts";

/**
 * Unit tests for the style-composition primitive shared by presets and custom
 * styles, plus the offline palette→descriptor heuristic. Both are pure — no I/O,
 * no fetch — so these are plain input/output assertions.
 */

describe("composeStyle", () => {
  it("passes prompt and negatives through when there is no fragment", () => {
    assert.deepEqual(composeStyle("a cat", undefined, "blurry"), {
      prompt: "a cat",
      negativePrompt: "blurry",
    });
  });

  it("passes through a fragment with an empty prompt", () => {
    assert.deepEqual(composeStyle("a cat", { prompt: "" }), {
      prompt: "a cat",
      negativePrompt: undefined,
    });
  });

  it("appends the fragment as a Style clause and strips trailing punctuation", () => {
    const { prompt } = composeStyle("a cat.  ", { prompt: "oil painting" });
    assert.equal(prompt, "a cat. Style: oil painting.");
  });

  it("merges request and fragment negatives", () => {
    const { negativePrompt } = composeStyle(
      "a cat",
      { prompt: "oil painting", negativePrompt: "photo" },
      "blurry",
    );
    assert.equal(negativePrompt, "blurry, photo");
  });

  it("uses only the fragment negatives when the request has none", () => {
    const { negativePrompt } = composeStyle("a cat", {
      prompt: "oil painting",
      negativePrompt: "photo",
    });
    assert.equal(negativePrompt, "photo");
  });
});

describe("heuristicDescriptor", () => {
  it("includes the palette colors when present", () => {
    const { prompt } = heuristicDescriptor({
      colors: ["#2b4a5e", "#e0a458"],
      brightness: 0.2,
      saturation: 0.7,
    });
    assert.match(prompt, /#2b4a5e/);
    assert.match(prompt, /#e0a458/);
  });

  it("reads low brightness as dark/low-key and high saturation as vivid", () => {
    const { prompt } = heuristicDescriptor({ colors: [], brightness: 0.1, saturation: 0.8 });
    assert.match(prompt, /dark, low-key/);
    assert.match(prompt, /vivid/);
  });

  it("reads high brightness as bright/high-key and low saturation as muted", () => {
    const { prompt } = heuristicDescriptor({ colors: [], brightness: 0.9, saturation: 0.1 });
    assert.match(prompt, /bright, high-key/);
    assert.match(prompt, /muted/);
  });

  it("drops malformed hex colors", () => {
    const { prompt } = heuristicDescriptor({
      colors: ["#2b4a5e", "not-a-color", "#fff"],
      brightness: 0.5,
      saturation: 0.5,
    });
    assert.match(prompt, /#2b4a5e/);
    assert.doesNotMatch(prompt, /not-a-color/);
    assert.doesNotMatch(prompt, /#fff\b/);
  });

  it("still yields a usable descriptor with no hint at all", () => {
    const { prompt } = heuristicDescriptor(undefined);
    assert.ok(prompt.length > 0);
    assert.equal(typeof prompt, "string");
  });
});
