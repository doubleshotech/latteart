// node:test's describe()/it() are fire-and-forget by design — the runner awaits
// them — so the floating-promise rule does not apply in this test file.
/* eslint-disable @typescript-eslint/no-floating-promises */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  GARBAGE_PNG as GARBAGE,
  installDom,
  pixelsOf,
  pngUrl,
  removeDom,
  solidUrl,
} from "./testenv/canvas.ts";
import { extractPaletteHint, makeThumbnail } from "./palette.ts";

installDom();
after(() => removeDom());

const assertClose = (actual: number, expected: number, what: string) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${what}: ${actual} !== ~${expected}`);

describe("extractPaletteHint", () => {
  it("quantizes a solid color to its 3-bit bucket centre", async () => {
    const hint = await extractPaletteHint([solidUrl(8, 8, "#ff0000")]);
    // (255,0,0) → bucket (7,0,0) → centre (7·32+16, 16, 16) = #f01010.
    assert.deepEqual(hint.colors, ["#f01010"]);
    assertClose(hint.brightness, 0.2126, "brightness of pure red");
    assert.equal(hint.saturation, 1, "pure red is fully saturated");
  });

  it("measures black and white at the brightness extremes", async () => {
    const black = await extractPaletteHint([solidUrl(4, 4, "#000000")]);
    assert.deepEqual(black.colors, ["#101010"]);
    assert.equal(black.brightness, 0);
    assert.equal(black.saturation, 0);

    const white = await extractPaletteHint([solidUrl(4, 4, "#ffffff")]);
    assert.deepEqual(white.colors, ["#f0f0f0"]);
    assertClose(white.brightness, 1, "brightness of white");
    assert.equal(white.saturation, 0);
  });

  it("orders the palette by dominance", async () => {
    const hint = await extractPaletteHint([
      pngUrl(8, 8, (ctx) => {
        ctx.fillStyle = "#ff0000";
        ctx.fillRect(0, 0, 6, 8);
        ctx.fillStyle = "#0000ff";
        ctx.fillRect(6, 0, 2, 8);
      }),
    ]);
    assert.deepEqual(hint.colors, ["#f01010", "#1010f0"]);
  });

  it("keeps at most five colors", async () => {
    const hint = await extractPaletteHint([
      pngUrl(6, 1, (ctx) => {
        for (const [i, c] of ["#f00", "#0f0", "#00f", "#ff0", "#0ff", "#f0f"].entries()) {
          ctx.fillStyle = c;
          ctx.fillRect(i, 0, 1, 1);
        }
      }),
    ]);
    assert.equal(hint.colors.length, 5);
  });

  it("skips near-transparent pixels, thresholded at alpha 128", async () => {
    const hint = await extractPaletteHint([
      pngUrl(2, 1, (ctx) => {
        // Exact alpha values via putImageData — left red at 127 (skipped),
        // right blue at 128 (counted).
        const image = ctx.createImageData(2, 1);
        image.data.set([255, 0, 0, 127, 0, 0, 255, 128]);
        ctx.putImageData(image, 0, 0);
      }),
    ]);
    assert.deepEqual(hint.colors, ["#1010f0"], "only the alpha-128 blue pixel counts");
    assert.equal(hint.saturation, 1);
  });

  it("skips an undecodable image and keeps the rest", async () => {
    const hint = await extractPaletteHint([GARBAGE, solidUrl(4, 4, "#ff0000")]);
    assert.deepEqual(hint.colors, ["#f01010"]);
  });

  it("returns the empty hint when nothing decodes", async () => {
    assert.deepEqual(await extractPaletteHint([GARBAGE]), {
      colors: [],
      brightness: 0,
      saturation: 0,
    });
  });

  it("reads a large image through the downsample without changing the answer", async () => {
    const large = await extractPaletteHint([solidUrl(256, 256, "#ff0000")]);
    assert.deepEqual(large.colors, ["#f01010"]);
    assert.equal(large.saturation, 1);
  });
});

describe("makeThumbnail", () => {
  it("scales the longest side down to max and encodes JPEG", async () => {
    const thumb = await makeThumbnail(solidUrl(512, 256, "#123456"), 256);
    assert.ok(thumb);
    assert.ok(thumb.startsWith("data:image/jpeg;base64,"));
    const p = await pixelsOf(thumb);
    assert.equal(p.width, 256);
    assert.equal(p.height, 128);
  });

  it("never upscales", async () => {
    const thumb = await makeThumbnail(solidUrl(100, 50, "#123456"), 256);
    const p = await pixelsOf(thumb!);
    assert.equal(p.width, 100);
    assert.equal(p.height, 50);
  });

  it("is undefined when the source can't decode", async () => {
    assert.equal(await makeThumbnail(GARBAGE), undefined);
  });
});
