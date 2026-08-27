// node:test's describe()/it() are fire-and-forget by design — the runner awaits
// them — so the floating-promise rule does not apply in this test file.
/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  bitmapLog,
  GARBAGE_PNG,
  halfMask,
  installWorkerCanvas,
  pixelsOf,
  pixelsOfRaster,
  px,
  resetBitmapLog,
  solidUrl,
} from "./testenv/canvas.ts";
import { layer } from "./testenv/layers.ts";
import { exportPng, flattenLayers } from "./flatten.ts";
import { clearMaskStencils } from "./layerMask.ts";

installWorkerCanvas();

/**
 * The compositor, in the worker-shaped environment, asserted on real pixels.
 * Expected values are literals throughout, and pixel checks stick to alpha 0
 * and 255 and to solid colors at 1:1 scale, where Skia compositing is exact.
 */

describe("flattenLayers — nothing to composite", () => {
  it("returns null for no layers, no visible layer, and no pixels", async () => {
    assert.equal(await flattenLayers([]), null);
    assert.equal(
      await flattenLayers([layer({ src: solidUrl(2, 2, "#fff"), visible: false })]),
      null,
    );
    assert.equal(await flattenLayers([layer({ src: null })]), null);
  });

  it("throws when a visible layer's pixels won't decode", async () => {
    await assert.rejects(
      flattenLayers([layer({ src: GARBAGE_PNG })]),
      /layer image failed to load/,
    );
  });
});

describe("flattenLayers — geometry", () => {
  it("frames one layer exactly, at pixelRatio 1", async () => {
    const flat = await flattenLayers(
      [layer({ src: solidUrl(4, 2, "#12ab34"), x: 3, y: 5, width: 4, height: 2 })],
      { pixelRatio: 1 },
    );
    assert.ok(flat);
    assert.deepEqual(flat.box, { x: 3, y: 5, width: 4, height: 2 });
    const p = pixelsOfRaster(flat.canvas);
    assert.equal(p.width, 4);
    assert.equal(p.height, 2);
    assert.deepEqual(px(p, 0, 0), [18, 171, 52, 255]);
    assert.deepEqual(px(p, 3, 1), [18, 171, 52, 255]);
  });

  it("rounds a fractional box up to whole pixels", async () => {
    const flat = await flattenLayers(
      [layer({ src: solidUrl(11, 6, "#fff"), width: 10.4, height: 5.2 })],
      { pixelRatio: 1 },
    );
    assert.ok(flat);
    assert.deepEqual(flat.box, { x: 0, y: 0, width: 11, height: 6 });
    assert.equal(flat.canvas.width, 11);
    assert.equal(flat.canvas.height, 6);
  });

  it("supersamples by pixelRatio", async () => {
    const flat = await flattenLayers(
      [layer({ src: solidUrl(4, 2, "#fff"), width: 4, height: 2 })],
      { pixelRatio: 2 },
    );
    assert.ok(flat);
    assert.equal(flat.canvas.width, 8);
    assert.equal(flat.canvas.height, 4);
  });

  it("caps the longest edge at maxSide", async () => {
    const flat = await flattenLayers(
      [layer({ src: solidUrl(100, 50, "#ff0000"), width: 100, height: 50 })],
      { pixelRatio: 2, maxSide: 120 },
    );
    assert.ok(flat);
    // 100×2 = 200 > 120, so the scale drops to 120/100 = 1.2.
    assert.equal(flat.canvas.width, 120);
    assert.equal(flat.canvas.height, 60);
    const p = pixelsOfRaster(flat.canvas);
    assert.deepEqual(px(p, 0, 0), [255, 0, 0, 255]);
    assert.deepEqual(px(p, 119, 59), [255, 0, 0, 255]);
  });

  it("a pinned box wins over the measured one", async () => {
    const flat = await flattenLayers(
      [layer({ src: solidUrl(4, 4, "#ff0000"), x: 10, y: 10, width: 4, height: 4 })],
      { pixelRatio: 1, box: { x: 0, y: 0, width: 8, height: 8 } },
    );
    assert.ok(flat);
    assert.deepEqual(flat.box, { x: 0, y: 0, width: 8, height: 8 });
    assert.equal(flat.canvas.width, 8);
    assert.equal(flat.canvas.height, 8);
    // The layer sits outside the pinned frame, so the output is empty pixels.
    const p = pixelsOfRaster(flat.canvas);
    assert.deepEqual(px(p, 4, 4), [0, 0, 0, 0]);
  });

  it("a hidden layer contributes neither pixels nor bounds", async () => {
    // Two hidden layers, each pinning one half: the far one would grow the
    // box, the overlapping top one would repaint the pixels red.
    const flat = await flattenLayers(
      [
        layer({ src: solidUrl(10, 10, "#00ff00"), width: 10, height: 10 }),
        layer({ src: solidUrl(10, 10, "#f00"), x: 100, y: 100, visible: false }),
        layer({ src: solidUrl(10, 10, "#f00"), width: 10, height: 10, visible: false }),
      ],
      { pixelRatio: 1 },
    );
    assert.ok(flat);
    assert.deepEqual(flat.box, { x: 0, y: 0, width: 10, height: 10 });
    assert.deepEqual(px(pixelsOfRaster(flat.canvas), 5, 5), [0, 255, 0, 255]);
  });

  it("frames a rotated layer by its hull, not its box", async () => {
    // 4×2 at 90° about the top-left: corners land at x ∈ [8, 10], y ∈ [0, 4].
    const flat = await flattenLayers(
      [layer({ src: solidUrl(4, 2, "#12ab34"), x: 10, y: 0, width: 4, height: 2, rotation: 90 })],
      { pixelRatio: 1 },
    );
    assert.ok(flat);
    assert.deepEqual(flat.box, { x: 8, y: 0, width: 2, height: 4 });
    const p = pixelsOfRaster(flat.canvas);
    assert.equal(p.width, 2);
    assert.equal(p.height, 4);
    // A quarter turn lands on the pixel grid, so every pixel is fully opaque.
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 2; x++)
        assert.deepEqual(px(p, x, y), [18, 171, 52, 255], `pixel ${x},${y}`);
  });
});

describe("flattenLayers — compositing", () => {
  it("draws bottom→top, so the last layer wins where they overlap", async () => {
    const flat = await flattenLayers(
      [
        layer({ src: solidUrl(4, 4, "#ff0000"), width: 4, height: 4 }),
        layer({ src: solidUrl(4, 4, "#00ff00"), width: 4, height: 4 }),
      ],
      { pixelRatio: 1 },
    );
    assert.ok(flat);
    assert.deepEqual(px(pixelsOfRaster(flat.canvas), 2, 2), [0, 255, 0, 255]);
  });

  it("honours opacity 0 and the multiply blend mode exactly", async () => {
    const base = layer({ src: solidUrl(4, 4, "#ff0000"), width: 4, height: 4 });

    const invisible = await flattenLayers(
      [base, layer({ src: solidUrl(4, 4, "#00ff00"), width: 4, height: 4, opacity: 0 })],
      { pixelRatio: 1 },
    );
    assert.deepEqual(px(pixelsOfRaster(invisible!.canvas), 2, 2), [255, 0, 0, 255]);

    const multiplied = await flattenLayers(
      [base, layer({ src: solidUrl(4, 4, "#00ff00"), width: 4, height: 4, blendMode: "multiply" })],
      { pixelRatio: 1 },
    );
    // Pure red × pure green share no channel, so multiply is exactly black.
    assert.deepEqual(px(pixelsOfRaster(multiplied!.canvas), 2, 2), [0, 0, 0, 255]);
  });

  it("resolves a layer's mask into its own alpha", async () => {
    const flat = await flattenLayers(
      [layer({ src: solidUrl(4, 4, "#12ab34"), width: 4, height: 4, mask: halfMask(4, 4) })],
      { pixelRatio: 1 },
    );
    assert.ok(flat);
    const p = pixelsOfRaster(flat.canvas);
    assert.deepEqual(px(p, 0, 1), [18, 171, 52, 255], "white mask half reveals");
    assert.deepEqual(px(p, 3, 1), [0, 0, 0, 0], "black mask half hides");
  });

  it("gives every decoded bitmap back", async () => {
    resetBitmapLog();
    clearMaskStencils();
    const flat = await flattenLayers(
      [
        layer({ src: solidUrl(4, 4, "#fff"), mask: solidUrl(4, 4, "#fff") }),
        layer({ src: solidUrl(4, 4, "#000") }),
      ],
      { pixelRatio: 1 },
    );
    assert.ok(flat);
    // Exactly src + mask + src — the cleared stencil cache makes it exact.
    assert.equal(bitmapLog.length, 3);
    for (const [i, b] of bitmapLog.entries()) assert.equal(b.closed, true, `bitmap ${i} closed`);
  });

  it("reports one progress tick per layer", async () => {
    const ticks: [number, number][] = [];
    await flattenLayers(
      [layer({ src: solidUrl(2, 2, "#fff") }), layer({ src: solidUrl(2, 2, "#000") })],
      { pixelRatio: 1, onProgress: (done, total) => ticks.push([done, total]) },
    );
    assert.deepEqual(ticks, [
      [1, 2],
      [2, 2],
    ]);
  });
});

describe("exportPng", () => {
  it("exports at the fixed 2× ratio and counts the encode as the last step", async () => {
    const ticks: [number, number][] = [];
    const blob = await exportPng(
      [layer({ src: solidUrl(4, 2, "#12ab34"), width: 4, height: 2 })],
      (done, total) => ticks.push([done, total]),
    );
    assert.ok(blob);
    const p = await pixelsOf(new Uint8Array(await blob.arrayBuffer()));
    assert.equal(p.width, 8);
    assert.equal(p.height, 4);
    assert.deepEqual(px(p, 0, 0), [18, 171, 52, 255]);
    assert.deepEqual(ticks, [
      [1, 2],
      [2, 2],
    ]);
  });

  it("returns null when nothing is visible", async () => {
    assert.equal(await exportPng([layer({ src: solidUrl(2, 2, "#fff"), visible: false })]), null);
  });
});
