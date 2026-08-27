// node:test's describe()/it() are fire-and-forget by design — the runner awaits
// them — so the floating-promise rule does not apply in this test file.
/* eslint-disable @typescript-eslint/no-floating-promises */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  bitmapLog,
  GARBAGE_PNG,
  installDom,
  installWorkerCanvas,
  pixelsOf,
  px,
  removeDom,
  resetBitmapLog,
  solidUrl,
} from "./testenv/canvas.ts";
import { context2d, decodeImage, encodePng, makeRaster, pngDataUrl } from "./raster.ts";

installWorkerCanvas();

/**
 * The seam itself, in the worker-shaped environment — no `document`, an
 * `OffscreenCanvas`, `createImageBitmap`. This is the environment
 * `lib/export.worker` runs the compositors in, and the one nothing could
 * unit-test before this harness existed.
 */

describe("raster — environment detection", () => {
  it("builds a worker-shaped canvas when there is no document", () => {
    // Harness self-check as much as a raster test: the stub must expose ONLY
    // the OffscreenCanvas surface. `pngDataUrl` and `encodePngBlob` branch on
    // `"toDataURL" in raster` / `"convertToBlob" in raster`, so a stub that
    // leaked `toDataURL` (any subclass of a real canvas does) would silently
    // reroute every test through the main-thread branches.
    assert.equal(typeof document, "undefined", "the worker environment must have no document");
    const raster = makeRaster(4, 4);
    assert.equal("convertToBlob" in raster, true);
    assert.equal("toDataURL" in raster, false);
  });

  it("clamps a zero-size request to 1×1", () => {
    const raster = makeRaster(0, 0);
    assert.equal(raster.width, 1);
    assert.equal(raster.height, 1);
  });
});

describe("raster — decodeImage", () => {
  it("decodes a data: URL to a bitmap with its real size", async () => {
    const img = await decodeImage(solidUrl(5, 3, "#12ab34"));
    assert.ok(img);
    assert.equal(img.width, 5);
    assert.equal(img.height, 3);
    img.close();
  });

  it("resolves null on undecodable bytes", async () => {
    assert.equal(await decodeImage(GARBAGE_PNG), null);
  });

  it("resolves null when the fetch itself throws", async () => {
    assert.equal(await decodeImage("no-such-scheme://nope"), null);
  });

  it("close() releases the underlying bitmap", async () => {
    resetBitmapLog();
    const img = await decodeImage(solidUrl(2, 2, "#fff"));
    assert.ok(img);
    assert.equal(bitmapLog.length, 1);
    assert.equal(bitmapLog[0]!.closed, false);
    img.close();
    assert.equal(bitmapLog[0]!.closed, true);
  });
});

describe("raster — PNG encoding", () => {
  it("encodePng round-trips pixels through a real PNG", async () => {
    const raster = makeRaster(2, 1);
    const ctx = context2d(raster)!;
    ctx.fillStyle = "#12ab34";
    ctx.fillRect(0, 0, 1, 1);
    ctx.fillStyle = "#0000ff";
    ctx.fillRect(1, 0, 1, 1);

    const bytes = await encodePng(raster);
    // The PNG signature, so "it decoded" can't be satisfied by another format.
    assert.deepEqual(Array.from(bytes.slice(0, 4)), [137, 80, 78, 71]);
    const p = await pixelsOf(bytes);
    assert.equal(p.width, 2);
    assert.equal(p.height, 1);
    assert.deepEqual(px(p, 0, 0), [18, 171, 52, 255]);
    assert.deepEqual(px(p, 1, 0), [0, 0, 255, 255]);
  });

  it("pngDataUrl takes the worker branch (blob + FileReader) and round-trips", async () => {
    const raster = makeRaster(1, 1);
    const ctx = context2d(raster)!;
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(0, 0, 1, 1);

    const url = await pngDataUrl(raster);
    assert.ok(url.startsWith("data:image/png;base64,"), `unexpected prefix: ${url.slice(0, 30)}`);
    const p = await pixelsOf(url);
    assert.deepEqual(px(p, 0, 0), [255, 0, 0, 255]);
  });
});

describe("raster — DOM environment", () => {
  before(() => installDom());
  after(() => removeDom());

  it("builds a document canvas and encodePng takes the toBlob fallback", async () => {
    const raster = makeRaster(2, 1);
    // A DOM canvas has toDataURL and toBlob but no convertToBlob, so this is
    // the one place encodePngBlob's callback-style fallback branch runs.
    assert.equal("toDataURL" in raster, true);
    assert.equal("convertToBlob" in raster, false);
    const ctx = context2d(raster)!;
    ctx.fillStyle = "#12ab34";
    ctx.fillRect(0, 0, 2, 1);

    const bytes = await encodePng(raster);
    assert.deepEqual(Array.from(bytes.slice(0, 4)), [137, 80, 78, 71]);
    const p = await pixelsOf(bytes);
    assert.equal(p.width, 2);
    assert.deepEqual(px(p, 1, 0), [18, 171, 52, 255]);
  });
});
