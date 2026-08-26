// node:test's describe()/it() are fire-and-forget by design — the runner awaits
// them — so the floating-promise rule does not apply in this test file.
/* eslint-disable @typescript-eslint/no-floating-promises */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { installDom, pixelsOf, px, removeDom, solidUrl } from "./testenv/canvas.ts";
import { guessTarget, maskFromMatte, previewFromMatte } from "./autoMask.ts";
import type { Matte } from "./removeBackgroundAI.ts";

// Every entry point here builds DOM canvases, so the whole file runs with the
// document installed.
installDom();
after(() => removeDom());

const matte = (width: number, height: number, values: number[]): Matte => ({
  width,
  height,
  data: new Uint8ClampedArray(values),
});

describe("guessTarget", () => {
  it("defaults to background for scene and setting words", () => {
    assert.equal(guessTarget("replace the background with a castle"), "background");
    assert.equal(guessTarget("a misty forest at dawn"), "background");
    assert.equal(guessTarget("make it a sunset"), "background");
  });

  it("defaults to subject otherwise", () => {
    assert.equal(guessTarget("make the cat golden"), "subject");
    assert.equal(guessTarget(""), "subject");
  });

  it("matches whole words only", () => {
    // "skyscraper" contains "sky" but is a subject noun — \b must hold.
    assert.equal(guessTarget("a taller skyscraper"), "subject");
  });
});

describe("maskFromMatte", () => {
  it("thresholds the soft matte at 128, subject polarity", async () => {
    const p = await pixelsOf(maskFromMatte(matte(4, 1, [0, 127, 128, 255]), "subject"));
    assert.equal(p.width, 4);
    assert.equal(p.height, 1);
    assert.deepEqual(px(p, 0, 0), [0, 0, 0, 255]);
    assert.deepEqual(px(p, 1, 0), [0, 0, 0, 255], "127 stays below the threshold");
    assert.deepEqual(px(p, 2, 0), [255, 255, 255, 255], "128 crosses it");
    assert.deepEqual(px(p, 3, 0), [255, 255, 255, 255]);
  });

  it("inverts for a background edit", async () => {
    // RMBG's matte is foreground-high; regenerating the background means the
    // white region is everything the matte is NOT.
    const p = await pixelsOf(maskFromMatte(matte(4, 1, [0, 127, 128, 255]), "background"));
    assert.deepEqual(px(p, 0, 0), [255, 255, 255, 255]);
    assert.deepEqual(px(p, 1, 0), [255, 255, 255, 255]);
    assert.deepEqual(px(p, 2, 0), [0, 0, 0, 255]);
    assert.deepEqual(px(p, 3, 0), [0, 0, 0, 255]);
  });

  it("emits the mask at the matte's own resolution", async () => {
    const p = await pixelsOf(maskFromMatte(matte(3, 2, [0, 0, 0, 255, 255, 255]), "subject"));
    assert.equal(p.width, 3);
    assert.equal(p.height, 2);
    assert.deepEqual(px(p, 0, 1), [255, 255, 255, 255]);
  });
});

describe("previewFromMatte", () => {
  it("tints exactly the region that will regenerate", async () => {
    const source = solidUrl(2, 1, "#0000ff");
    const url = await previewFromMatte(source, matte(2, 1, [255, 0]), "subject");
    const p = await pixelsOf(url);

    // The subject pixel carries the translucent tint — pinned by region, not
    // by Skia's blend rounding: it differs from the source and shows the
    // tint's red, which pure blue has none of.
    const tinted = px(p, 0, 0);
    assert.notDeepEqual(tinted, [0, 0, 255, 255]);
    assert.ok(tinted[0] > 100, `tint red missing: ${tinted.join(",")}`);
    // The background pixel is the source, untouched and exact.
    assert.deepEqual(px(p, 1, 0), [0, 0, 255, 255]);
  });

  it("flips the tinted region for a background edit", async () => {
    const source = solidUrl(2, 1, "#0000ff");
    const p = await pixelsOf(await previewFromMatte(source, matte(2, 1, [255, 0]), "background"));
    assert.deepEqual(px(p, 0, 0), [0, 0, 255, 255], "the subject is untouched");
    assert.ok(px(p, 1, 0)[0]! > 100, "the background is tinted");
  });

  it("rejects when the source can't decode", async () => {
    await assert.rejects(
      previewFromMatte("data:image/png;base64,AAAA", matte(1, 1, [255]), "subject"),
      /preview source failed to load/,
    );
  });
});
