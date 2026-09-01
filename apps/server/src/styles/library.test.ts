// node:test's describe()/it() are fire-and-forget by design (the runner awaits
// them), so the floating-promise rule doesn't apply in this test file.
/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
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

  it("getStyleDetail exposes the reference tokens, and readStyleRef serves their bytes", () => {
    const detail = lib.getStyleDetail(created.id);
    assert.equal(detail?.refs.length, 2);
    // Tokens, not pixels: a full-size reference must never ride in the payload.
    assert.ok(detail?.refs.every((r) => /^asset:[a-f0-9]{64}\.png$/.test(r)));
    // The whole token round-trips — readStyleRef matches by equality, so the
    // ref format never has to be parsed by whoever holds it.
    const read = lib.readStyleRef(created.id, detail!.refs[0]!);
    assert.equal(read?.mime, "image/png");
    assert.equal(read?.bytes.toString("utf8"), "png-bytes-ref-1");
  });

  it("readStyleRef refuses a ref this style doesn't hold", () => {
    const other = lib.createStyle({
      label: "Other",
      prompt: "other",
      source: "heuristic",
      images: [dataUrl("ref-other")],
    });
    const theirs = lib.getStyleDetail(other.id)!.refs[0]!;
    // The ref is readable for its OWN style — the scoping is what makes this a
    // miss, so one style can't read another's assets by naming its token.
    assert.ok(lib.readStyleRef(other.id, theirs));
    assert.equal(lib.readStyleRef(created.id, theirs), undefined);
    // A bare filename is not a ref this style holds either, so the equality
    // match is also what keeps a name from walking out of the directory.
    assert.equal(lib.readStyleRef(created.id, theirs.slice("asset:".length)), undefined);
    assert.equal(lib.readStyleRef(created.id, "asset:../styles.json"), undefined);
    lib.deleteStyle(other.id);
  });

  it("storeStyleAssets keeps known refs, writes new images, and collapses duplicates", () => {
    const before = lib.getStyleDetail(created.id)!.refs;
    const { stored, fault } = lib.storeStyleAssets(created.id, {
      // keep the second, add one, and repeat both — a repeat content-hashes to
      // one file, so the manifest must not list it twice.
      refs: [before[1]!, dataUrl("ref-3"), before[1]!, dataUrl("ref-3")],
    });
    assert.equal(fault, undefined);
    assert.equal(stored?.refs?.length, 2);
    assert.equal(stored?.refs?.[0], before[1]);
    assert.notEqual(stored?.refs?.[1], before[0]);
  });

  it("storeStyleAssets names which input it could resolve to nothing", () => {
    const before = lib.getStyleDetail(created.id)!.refs;
    // A token this style doesn't have (it's another style's, or was already
    // removed), a bare string, and an undecodable data: URL all fail rather
    // than drop silently — and the three causes stay apart, so the route can
    // say "invalid thumbnail" instead of blaming the reference images.
    assert.equal(
      lib.storeStyleAssets(created.id, { refs: [`asset:${"a".repeat(64)}.png`] }).fault,
      "refs",
    );
    assert.equal(lib.storeStyleAssets(created.id, { refs: [...before, "hello"] }).fault, "refs");
    assert.equal(
      lib.storeStyleAssets(created.id, { thumbnail: "data:text/plain;base64,aGk=" }).fault,
      "thumbnail",
    );
    assert.equal(lib.storeStyleAssets("custom:missing", { refs: [] }).fault, "no-such-style");
  });

  it("a reference edit replaces the images and prunes only the dropped one", () => {
    const before = lib.getStyleDetail(created.id)!.refs;
    const { stored } = lib.storeStyleAssets(created.id, {
      refs: [before[1]!, dataUrl("ref-3")],
      thumbnail: dataUrl("thumb-2"),
    });
    const info = lib.updateStyle(created.id, { refs: stored!.refs, thumbnail: stored!.thumbnail });
    const after = lib.getStyleDetail(created.id)!;
    assert.deepEqual(after.refs, stored!.refs);
    // The kept ref still resolves to pixels, so the prune spared its file.
    assert.equal(lib.resolveCustomStyle(created.id, true)?.refs.length, 2);
    assert.ok(info?.thumbnail?.startsWith("data:image/png;base64,"));
    // ref-1 and the old thumbnail are unreferenced now; ref-2, ref-3 and the
    // new thumbnail remain.
    assert.equal(readdirSync(ASSETS_DIR).length, 3);
  });

  it("a later edit that omits refs and thumbnail leaves both untouched", () => {
    const before = lib.getStyleDetail(created.id)!;
    lib.updateStyle(created.id, { label: "Rain city" });
    const after = lib.getStyleDetail(created.id)!;
    assert.deepEqual(after.refs, before.refs);
    assert.equal(after.thumbnail, before.thumbnail);
    assert.equal(readdirSync(ASSETS_DIR).length, 3);
  });

  it("a re-describe replaces the descriptor and records the vision source", () => {
    lib.updateStyle(created.id, {
      prompt: "hand-inked, halftone dots",
      negativePrompt: "",
      source: "vision",
    });
    const detail = lib.getStyleDetail(created.id);
    assert.equal(detail?.prompt, "hand-inked, halftone dots");
    assert.equal(detail?.negativePrompt, undefined);
    assert.equal(detail?.source, "vision");
  });

  it("deleteStyle prunes the now-unreferenced assets", () => {
    lib.deleteStyle(created.id);
    assert.equal(lib.listStyles().length, 0);
    assert.equal(readdirSync(ASSETS_DIR).length, 0);
  });
});

describe("project scoping", () => {
  const makeStyle = (label: string, projectId?: string) =>
    lib.createStyle({
      label,
      prompt: `${label} descriptor`,
      source: "heuristic",
      thumbnail: dataUrl(`thumb-${label}`),
      images: [dataUrl(`ref-${label}`)],
      projectId,
    });

  it("createStyle records the scope and listStyles exposes it", () => {
    const global = makeStyle("Global");
    const scoped = makeStyle("Scoped", "proj-a");
    assert.equal(global.projectId, undefined);
    assert.equal(scoped.projectId, "proj-a");
    const listed = lib.listStyles().find((s) => s.id === scoped.id);
    assert.equal(listed?.projectId, "proj-a");
    lib.deleteStyle(global.id);
    lib.deleteStyle(scoped.id);
  });

  it("updateStyle is three-way on projectId: keep, scope, clear", () => {
    const s = makeStyle("Wander");
    assert.equal(lib.updateStyle(s.id, { label: "Wander 2" })?.projectId, undefined);
    assert.equal(lib.updateStyle(s.id, { projectId: "proj-a" })?.projectId, "proj-a");
    // An unrelated edit must not disturb the scope (mutate-in-place guard).
    assert.equal(lib.updateStyle(s.id, { prompt: "new words" })?.projectId, "proj-a");
    const cleared = lib.updateStyle(s.id, { projectId: null });
    assert.equal(cleared?.projectId, undefined);
    // null must land as ABSENT in the manifest, not as a JSON null that a
    // future strict reader or the picker's `!s.projectId` filter reads oddly.
    const manifest = JSON.parse(
      readFileSync(join(dataDir, "styles", "styles.json"), "utf8"),
    ) as Record<string, unknown>[];
    const record = manifest.find((x) => x.id === s.id);
    assert.ok(record && !("projectId" in record));
    lib.deleteStyle(s.id);
  });

  it("deleteStylesForProject removes only that project's styles and prunes their assets", () => {
    const global = makeStyle("Keep global");
    makeStyle("Mine", "proj-a");
    const other = makeStyle("Other", "proj-b");
    const before = readdirSync(ASSETS_DIR).length;
    assert.equal(before, 6);

    lib.deleteStylesForProject("proj-a");
    const ids = lib.listStyles().map((s) => s.id);
    // mine.id's absence is implied: deepEqual pins the surviving set exactly.
    assert.deepEqual(ids.toSorted(), [global.id, other.id].toSorted());
    assert.equal(readdirSync(ASSETS_DIR).length, 4);

    lib.deleteStyle(global.id);
    lib.deleteStyle(other.id);
  });

  it("copyStylesForProject copies scoped styles onto the new project, sharing assets", () => {
    const global = makeStyle("Stays global");
    const scoped = makeStyle("Travels", "proj-a");
    const assetsBefore = readdirSync(ASSETS_DIR).toSorted();

    const idMap = lib.copyStylesForProject("proj-a", "proj-copy");
    assert.equal(idMap.size, 1);
    const copyId = idMap.get(scoped.id);
    assert.ok(copyId && copyId !== scoped.id);

    // The copy is scoped to the destination; the source and globals are untouched.
    const list = lib.listStyles();
    assert.equal(list.find((s) => s.id === copyId)?.projectId, "proj-copy");
    assert.equal(list.find((s) => s.id === scoped.id)?.projectId, "proj-a");
    assert.equal(list.find((s) => s.id === global.id)?.projectId, undefined);

    // Content-hashed sharing: the copy references the SAME files — no new assets,
    // and the copy still resolves its descriptor and reference pixels.
    assert.deepEqual(readdirSync(ASSETS_DIR).toSorted(), assetsBefore);
    const resolved = lib.resolveCustomStyle(copyId, true);
    assert.equal(resolved?.fragment.prompt, "Travels descriptor");
    assert.equal(resolved?.refs.length, 1);

    // Deleting the source project's styles must keep the copy's shared assets.
    lib.deleteStylesForProject("proj-a");
    assert.deepEqual(readdirSync(ASSETS_DIR).toSorted(), assetsBefore);
    assert.equal(lib.resolveCustomStyle(copyId, true)?.refs.length, 1);

    lib.deleteStylesForProject("proj-copy");
    lib.deleteStyle(global.id);
  });

  it("copyStylesForProject with nothing scoped copies nothing", () => {
    const global = makeStyle("Only global");
    assert.equal(lib.copyStylesForProject("proj-empty", "proj-copy").size, 0);
    assert.equal(lib.listStyles().length, 1);
    lib.deleteStyle(global.id);
  });
});
