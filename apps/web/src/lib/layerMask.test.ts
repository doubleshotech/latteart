// node:test's describe()/it() are fire-and-forget by design — the runner awaits
// them — so the floating-promise rule does not apply in this test file.
/* eslint-disable @typescript-eslint/no-floating-promises */
import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  bitmapLog,
  installDom,
  installWorkerCanvas,
  GARBAGE_PNG as GARBAGE,
  halfMask,
  pixelsOf,
  pixelsOfRaster,
  pngUrl,
  POISON_SRC,
  px,
  removeDom,
  resetBitmapLog,
  solidUrl,
} from "./testenv/canvas.ts";
import {
  clearMaskStencils,
  expandMask,
  invertMask,
  loadMaskedLayer,
  luma,
  maskedImage,
  maskedSource,
  masksAnything,
} from "./layerMask.ts";

installWorkerCanvas();

/**
 * The compositing core runs in the worker-shaped environment — the same one
 * `lib/export.worker` uses. The DOM-only helpers get a scoped `document` +
 * `Image` (installed in before/after, because their mere presence flips every
 * `makeRaster` call onto the DOM branch), and the stencil cache is cleared at
 * each crossing so no test inherits a warm stencil from another environment's
 * run.
 */

describe("luma", () => {
  it("matches the Rec. 601 integer weights exactly", () => {
    // (r·77 + g·150 + b·29) >> 8, weights summing to 256 — each value below is
    // that expression worked out by hand, not recomputed from the code.
    assert.equal(luma(0, 0, 0), 0);
    assert.equal(luma(255, 255, 255), 255);
    assert.equal(luma(128, 128, 128), 128);
    assert.equal(luma(255, 0, 0), 76);
    assert.equal(luma(0, 255, 0), 149);
    assert.equal(luma(0, 0, 255), 28);
  });
});

describe("loadMaskedLayer — worker environment", () => {
  beforeEach(() => clearMaskStencils());

  it("returns the bare pixels when there is no mask", async () => {
    const out = await loadMaskedLayer(solidUrl(5, 3, "#12ab34"), null);
    assert.ok(out);
    assert.equal(out.width, 5);
    assert.equal(out.height, 3);
  });

  it("resolves the mask into the layer's alpha, luminance as coverage", async () => {
    const out = await loadMaskedLayer(solidUrl(4, 4, "#12ab34"), halfMask(4, 4));
    assert.ok(out);
    assert.equal(out.width, 4);
    assert.equal(out.height, 4);
    const p = pixelsOfRaster(out.source);
    assert.deepEqual(px(p, 0, 1), [18, 171, 52, 255], "white reveals, color untouched");
    assert.deepEqual(px(p, 3, 1), [0, 0, 0, 0], "black hides completely");
  });

  it("stretches a mask of a different resolution across the image", async () => {
    // A 2×1 mask over an 8×4 image: interpolation owns the middle, but the
    // outer columns are past the ends of the gradient and stay exact.
    const out = await loadMaskedLayer(solidUrl(8, 4, "#12ab34"), halfMask(2, 1));
    assert.ok(out);
    const p = pixelsOfRaster(out.source);
    assert.deepEqual(px(p, 0, 2), [18, 171, 52, 255]);
    assert.deepEqual(px(p, 7, 2), [0, 0, 0, 0]);
  });

  it("falls back to the unmasked pixels when the mask won't decode", async () => {
    const out = await loadMaskedLayer(solidUrl(3, 3, "#ff0000"), GARBAGE);
    assert.ok(out);
    assert.equal(out.width, 3);
    // The fallback is the decoded bitmap itself, not a composite canvas.
    assert.equal("getContext" in (out.source as object), false);
  });

  it("returns null when the source won't decode", async () => {
    assert.equal(await loadMaskedLayer(GARBAGE, null), null);
  });

  it("closes the source bitmap when compositing throws", async () => {
    resetBitmapLog();
    // The poisoned source decodes fine and then blows up at draw time, which
    // is the one exit where nobody downstream could ever close it.
    await assert.rejects(loadMaskedLayer(POISON_SRC, solidUrl(4, 4, "#fff")));
    assert.equal(bitmapLog[0]!.closed, true, "the poisoned source bitmap was given back");
  });
});

describe("stencil cache", () => {
  beforeEach(() => clearMaskStencils());

  const realFetch = globalThis.fetch;

  it("builds a mask's stencil once and reuses it", async () => {
    const mask = halfMask(6, 6);
    const src = solidUrl(6, 6, "#123456");
    const counts = new Map<string, number>();
    globalThis.fetch = ((input: string | URL, init?: RequestInit) => {
      const url = input instanceof URL ? input.href : input;
      counts.set(url, (counts.get(url) ?? 0) + 1);
      return realFetch(input, init);
    }) as typeof fetch;
    try {
      await loadMaskedLayer(src, mask);
      await loadMaskedLayer(src, mask);
      assert.equal(counts.get(mask), 1, "the mask decoded once");
      assert.equal(counts.get(src), 2, "the composite itself is not cached");

      clearMaskStencils();
      await loadMaskedLayer(src, mask);
      assert.equal(counts.get(mask), 2, "clearing the cache forces a rebuild");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("does not cache a decode failure", async () => {
    // The same mask URL fails once (a transient decode error) and then decodes
    // fine. A cached failure would disable the mask for the whole session.
    const mask = solidUrl(4, 4, "#ffffff");
    const src = solidUrl(4, 4, "#12ab34");
    let failures = 0;
    globalThis.fetch = ((input: string | URL, init?: RequestInit) => {
      if (input === mask && failures === 0) {
        failures++;
        return realFetch(GARBAGE);
      }
      return realFetch(input, init);
    }) as typeof fetch;
    try {
      const broken = await loadMaskedLayer(src, mask);
      assert.equal("getContext" in (broken!.source as object), false, "first try fell back");

      const healed = await loadMaskedLayer(src, mask);
      const p = pixelsOfRaster(healed!.source);
      assert.deepEqual(px(p, 1, 1), [18, 171, 52, 255], "second try applied the mask");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("main-thread helpers", () => {
  before(() => {
    installDom();
    clearMaskStencils();
  });
  after(() => {
    removeDom();
    clearMaskStencils();
  });

  const domImage = (src: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new (globalThis as { Image: new () => HTMLImageElement }).Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("test image failed to decode"));
      img.src = src;
    });

  describe("maskedImage", () => {
    it("composites for the Konva canvas", async () => {
      const img = await domImage(solidUrl(4, 4, "#12ab34"));
      const out = await maskedImage(img, halfMask(4, 4));
      assert.notEqual(out, img);
      const p = pixelsOfRaster(out);
      assert.deepEqual(px(p, 0, 0), [18, 171, 52, 255]);
      assert.deepEqual(px(p, 3, 0), [0, 0, 0, 0]);
    });

    it("returns the image itself when the mask won't decode", async () => {
      const img = await domImage(solidUrl(4, 4, "#12ab34"));
      assert.equal(await maskedImage(img, GARBAGE), img);
    });
  });

  describe("maskedSource", () => {
    it("is null with no mask — the caller keeps the byte-identical src", async () => {
      assert.equal(await maskedSource(solidUrl(2, 2, "#fff"), null), null);
      assert.equal(await maskedSource(solidUrl(2, 2, "#fff"), undefined), null);
    });

    it("re-encodes the composite the canvas shows", async () => {
      const out = await maskedSource(solidUrl(4, 4, "#12ab34"), halfMask(4, 4));
      assert.ok(out);
      assert.ok(out.startsWith("data:image/png;base64,"));
      const p = await pixelsOf(out);
      assert.deepEqual(px(p, 0, 2), [18, 171, 52, 255]);
      assert.deepEqual(px(p, 3, 2), [0, 0, 0, 0]);
    });

    it("is null when the mask never made it into the pixels", async () => {
      assert.equal(await maskedSource(solidUrl(2, 2, "#fff"), GARBAGE), null);
    });
  });

  describe("expandMask", () => {
    it("re-places the mask and reveals the new border", async () => {
      const out = await expandMask(
        solidUrl(2, 2, "#000"),
        { width: 4, height: 4 },
        { x: 1, y: 1, width: 2, height: 2 },
      );
      assert.ok(out);
      const p = await pixelsOf(out);
      assert.equal(p.width, 4);
      assert.equal(p.height, 4);
      assert.deepEqual(px(p, 0, 0), [255, 255, 255, 255], "border is revealed");
      assert.deepEqual(px(p, 3, 3), [255, 255, 255, 255]);
      assert.deepEqual(px(p, 1, 1), [0, 0, 0, 255], "the old mask still hides");
      assert.deepEqual(px(p, 2, 2), [0, 0, 0, 255]);
    });

    it("is null when the mask won't decode", async () => {
      assert.equal(
        await expandMask(GARBAGE, { width: 4, height: 4 }, { x: 0, y: 0, width: 2, height: 2 }),
        null,
      );
    });
  });

  describe("invertMask", () => {
    it("flips luminance exactly and keeps alpha", async () => {
      const mask = pngUrl(3, 1, (ctx) => {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, 1, 1);
        ctx.fillStyle = "#000000";
        ctx.fillRect(1, 0, 1, 1);
        ctx.fillStyle = "#646464"; // gray 100
        ctx.fillRect(2, 0, 1, 1);
      });
      const p = await pixelsOf(await invertMask(mask));
      assert.deepEqual(px(p, 0, 0), [0, 0, 0, 255]);
      assert.deepEqual(px(p, 1, 0), [255, 255, 255, 255]);
      assert.deepEqual(px(p, 2, 0), [155, 155, 155, 255]);
    });

    it("returns the input unchanged when it won't decode", async () => {
      assert.equal(await invertMask(GARBAGE), GARBAGE);
    });
  });

  describe("masksAnything", () => {
    const canvasOf = (w: number, h: number, paint: (ctx: CanvasRenderingContext2D) => void) => {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      paint(canvas.getContext("2d")!);
      return canvas;
    };

    it("an all-white mask hides nothing", () => {
      assert.equal(
        masksAnything(
          canvasOf(8, 8, (ctx) => {
            ctx.fillStyle = "#fff";
            ctx.fillRect(0, 0, 8, 8);
          }),
        ),
        false,
      );
    });

    it("thresholds at luma 250: 250 passes as white, 249 counts as hiding", () => {
      const gray = (v: number) =>
        canvasOf(8, 8, (ctx) => {
          ctx.fillStyle = `rgb(${v}, ${v}, ${v})`;
          ctx.fillRect(0, 0, 8, 8);
        });
      assert.equal(masksAnything(gray(250)), false);
      assert.equal(masksAnything(gray(249)), true);
    });

    it("still sees a single hidden pixel through the downsample", () => {
      // 128² scans at 64² — box-filtering folds the one black pixel into its
      // sample, dragging it below white instead of erasing it.
      const speck = canvasOf(128, 128, (ctx) => {
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, 128, 128);
        ctx.fillStyle = "#000";
        ctx.fillRect(64, 64, 1, 1);
      });
      assert.equal(masksAnything(speck), true);
    });
  });
});
