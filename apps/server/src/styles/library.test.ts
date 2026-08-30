// node:test's describe()/it() are fire-and-forget by design (the runner awaits
// them), so the floating-promise rule doesn't apply in this test file.
/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The library binds DATA_DIR at import time (via ../paths.ts), so the override
// must land before the dynamic import — a static import would be hoisted past it.
const dataDir = mkdtempSync(join(tmpdir(), "latteart-styles-"));
process.env.LATTEART_DATA_DIR = dataDir;
const lib = await import("./index.ts");

after(() => rmSync(dataDir, { recursive: true, force: true }));

const ASSETS_DIR = join(dataDir, "styles", "assets");

/** A decodable data: URL with distinct bytes per call (distinct content hashes). */
function dataUrl(seed: string): string {
  return `data:image/png;base64,${Buffer.from(`png-bytes-${seed}`).toString("base64")}`;
}

describe("custom-style library on disk", () => {
  const created = lib.createStyle({
    label: "Neon noir",
    prompt: "neon noir, wet asphalt",
    negativePrompt: "daylight",
    source: "vision",
    thumbnail: dataUrl("thumb"),
    images: [dataUrl("ref-1"), dataUrl("ref-2")],
  });

  it("createStyle stores the thumbnail and reference images as assets", () => {
    assert.equal(readdirSync(ASSETS_DIR).length, 3);
    assert.ok(created.thumbnail?.startsWith("data:image/png;base64,"));
  });

  it("getStyleDetail exposes the descriptor; listStyles does not", () => {
    const detail = lib.getStyleDetail(created.id);
    assert.equal(detail?.prompt, "neon noir, wet asphalt");
    assert.equal(detail?.negativePrompt, "daylight");
    assert.ok(!("prompt" in (lib.listStyles()[0] as object)));
  });

  it("getStyleDetail and updateStyle return undefined for an unknown id", () => {
    assert.equal(lib.getStyleDetail("custom:missing"), undefined);
    assert.equal(lib.updateStyle("custom:missing", { label: "x" }), undefined);
  });

  it("a rename keeps the thumbnail and refs — the asset prune must not fire", () => {
    const info = lib.updateStyle(created.id, { label: "Rain city" });
    assert.equal(info?.label, "Rain city");
    // The load-bearing assertion: writeManifest prunes every asset the manifest
    // no longer references, so a rename that dropped refs/thumbnail would
    // silently delete the source images native styleRef conditioning reads.
    assert.equal(readdirSync(ASSETS_DIR).length, 3);
    assert.ok(info?.thumbnail?.startsWith("data:image/png;base64,"));
    const resolved = lib.resolveCustomStyle(created.id, true);
    assert.equal(resolved?.refs.length, 2);
  });

  it("a descriptor edit changes composition but not the label", () => {
    lib.updateStyle(created.id, { prompt: "pastel dawn", negativePrompt: "night" });
    const detail = lib.getStyleDetail(created.id);
    assert.equal(detail?.label, "Rain city");
    assert.equal(detail?.prompt, "pastel dawn");
    assert.equal(detail?.negativePrompt, "night");
    assert.equal(lib.resolveCustomStyle(created.id, false)?.fragment.prompt, "pastel dawn");
  });

  it("an empty negativePrompt clears the negatives", () => {
    lib.updateStyle(created.id, { negativePrompt: "" });
    assert.equal(lib.getStyleDetail(created.id)?.negativePrompt, undefined);
  });

  it("omitted fields keep their value", () => {
    const info = lib.updateStyle(created.id, {});
    assert.equal(info?.label, "Rain city");
    assert.equal(lib.getStyleDetail(created.id)?.prompt, "pastel dawn");
  });

  it("deleteStyle prunes the now-unreferenced assets", () => {
    lib.deleteStyle(created.id);
    assert.equal(lib.listStyles().length, 0);
    assert.equal(readdirSync(ASSETS_DIR).length, 0);
  });
});
