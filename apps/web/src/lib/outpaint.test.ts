// node:test's describe()/it() are fire-and-forget by design — the runner awaits
// them — so the floating-promise rule does not apply in this test file.
/* eslint-disable @typescript-eslint/no-floating-promises */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { installDom, pixelsOf, pngUrl, px, removeDom, solidUrl } from "./testenv/canvas.ts";
import { layer } from "./testenv/layers.ts";
import { clearMaskStencils } from "./layerMask.ts";
import { buildOutpaintAssets, type Dirs } from "./outpaint.ts";

// Everything here is main-thread DOM code (it also routes through
// lib/layerMask's DOM helpers, hence the stencil clear on the way out).
installDom();
after(() => {
  removeDom();
  clearMaskStencils();
});

const dirs = (over: Partial<Dirs> = {}): Dirs => ({
  up: false,
  down: false,
  left: false,
  right: false,
  ...over,
});

describe("buildOutpaintAssets — geometry", () => {
  it("pads one side by the source-size fraction", async () => {
    const source = layer({
      src: solidUrl(100, 40, "#12ab34"),
      x: 5,
      y: 7,
      width: 200,
      height: 80,
    });
    const out = await buildOutpaintAssets(source, dirs({ right: true }), 0.5);

    assert.equal(out.genWidth, 150);
    assert.equal(out.genHeight, 40);
    const image = await pixelsOf(out.image);
    assert.equal(image.width, 150);
    assert.deepEqual(px(image, 50, 20), [18, 171, 52, 255], "the source sits at its offset");
    assert.equal(px(image, 120, 20)[3], 0, "the padding is transparent");

    const mask = await pixelsOf(out.mask);
    assert.deepEqual(px(mask, 50, 20), [0, 0, 0, 255], "black preserves the original");
    assert.deepEqual(px(mask, 99, 20), [0, 0, 0, 255], "up to its last column");
    assert.deepEqual(px(mask, 100, 20), [255, 255, 255, 255], "white marks the new region");
    assert.deepEqual(px(mask, 149, 20), [255, 255, 255, 255]);

    // The display box grows by the same fraction of the DISPLAY size, so the
    // original keeps its on-canvas spot.
    assert.deepEqual(out.placement, { x: 5, y: 7, width: 300, height: 80 });
    assert.equal(out.resultMask, null, "an unmasked source stays unmasked");
  });

  it("pads all four sides and keeps the assets aligned on one rect", async () => {
    const source = layer({ src: solidUrl(80, 40, "#12ab34"), x: 0, y: 0, width: 80, height: 40 });
    const out = await buildOutpaintAssets(
      source,
      dirs({ up: true, down: true, left: true, right: true }),
      0.25,
    );

    assert.equal(out.genWidth, 120);
    assert.equal(out.genHeight, 60);
    const mask = await pixelsOf(out.mask);
    // The preserved rect is exactly (20,10)–(99,49); its border is new.
    assert.deepEqual(px(mask, 20, 10), [0, 0, 0, 255]);
    assert.deepEqual(px(mask, 99, 49), [0, 0, 0, 255]);
    assert.deepEqual(px(mask, 19, 10), [255, 255, 255, 255]);
    assert.deepEqual(px(mask, 100, 49), [255, 255, 255, 255]);
    const image = await pixelsOf(out.image);
    assert.deepEqual(px(image, 20, 10), [18, 171, 52, 255]);
    assert.equal(px(image, 19, 10)[3], 0);

    assert.deepEqual(out.placement, { x: -20, y: -10, width: 120, height: 60 });
  });

  it("scales the whole canvas down uniformly to fit the 1536 cap", async () => {
    const source = layer({
      src: solidUrl(2000, 1000, "#12ab34"),
      width: 2000,
      height: 1000,
    });
    const out = await buildOutpaintAssets(source, dirs(), 0.5);

    // 2000 → 1536 is a 0.768 scale, applied to both axes.
    assert.equal(out.genWidth, 1536);
    assert.equal(out.genHeight, 768);
    const image = await pixelsOf(out.image);
    assert.equal(image.width, 1536);
    assert.deepEqual(px(image, 700, 400), [18, 171, 52, 255]);
    // Display placement is untouched — the cap is a generation-size concern.
    assert.deepEqual(out.placement, { x: 0, y: 0, width: 2000, height: 1000 });
  });

  it("rounds a fractional pad to whole generation pixels", async () => {
    const source = layer({ src: solidUrl(10, 10, "#12ab34"), width: 10, height: 10 });
    const out = await buildOutpaintAssets(source, dirs({ right: true }), 0.33);
    // 10 + 3.3 → 13.3 → a 13px canvas.
    assert.equal(out.genWidth, 13);
    assert.equal((await pixelsOf(out.image)).width, 13);
  });
});

describe("buildOutpaintAssets — masked sources", () => {
  it("sends the masked composite and re-places the mask on the result", async () => {
    // Source 4×4 with its right half hidden; expand to the right by half.
    const mask = pngUrl(4, 4, (ctx) => {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, 2, 4);
      ctx.fillStyle = "#000";
      ctx.fillRect(2, 0, 2, 4);
    });
    const source = layer({ src: solidUrl(4, 4, "#12ab34"), mask, width: 4, height: 4 });
    const out = await buildOutpaintAssets(source, dirs({ right: true }), 0.5);

    assert.equal(out.genWidth, 6);
    const image = await pixelsOf(out.image);
    assert.deepEqual(px(image, 1, 1), [18, 171, 52, 255], "revealed pixels ride along");
    assert.equal(px(image, 3, 1)[3], 0, "the model must not see what the user hid");
    assert.equal(px(image, 5, 1)[3], 0, "padding");

    assert.ok(out.resultMask, "a masked source hands its mask to the result");
    const result = await pixelsOf(out.resultMask);
    assert.equal(result.width, 6);
    assert.equal(result.height, 4);
    assert.deepEqual(px(result, 1, 1), [255, 255, 255, 255], "old revealed region");
    assert.deepEqual(px(result, 3, 1), [0, 0, 0, 255], "old hidden region stays hidden");
    assert.deepEqual(px(result, 5, 1), [255, 255, 255, 255], "the new border is revealed");
  });
});

describe("buildOutpaintAssets — failure", () => {
  it("rejects when the source image can't load", async () => {
    const source = layer({ src: "data:image/png;base64,AAAA" });
    await assert.rejects(
      buildOutpaintAssets(source, dirs({ right: true }), 0.5),
      /source image failed to load/,
    );
  });
});
