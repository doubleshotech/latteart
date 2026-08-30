// node:test's describe()/it() are fire-and-forget by design — the runner awaits
// them — so the floating-promise rule does not apply in this test file.
/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DOMParser as XmlDomParser } from "@xmldom/xmldom";
import { buildZip, type BuildEntry } from "./testenv/buildzip.ts";
import { installWorkerCanvas, pixelsOf, px, solidUrl } from "./testenv/canvas.ts";
import { layer } from "./testenv/layers.ts";
import { exportOra } from "./ora.ts";
import { importOra } from "./oraImport.ts";

installWorkerCanvas();
// Node has no DOMParser; xmldom stands in. It differs from the browser's in
// exactly the way oraImport documents: it throws on malformed XML where a
// browser returns a parsererror document — both paths land on the same error.
(globalThis as Record<string, unknown>).DOMParser = XmlDomParser;

/**
 * The `.ora` reader: round-tripped against the project's own writer, and —
 * because a round-trip is blind to any mistake both sides make symmetrically,
 * z-order above all — pinned against hand-written stack.xml fixtures where
 * every expectation is a literal.
 */

const text = (s: string) => new TextEncoder().encode(s);

/** The PNG bytes behind a `data:` URL — how fixtures turn painted canvases
 * into archive entries. */
function png(url: string): Uint8Array {
  return new Uint8Array(Buffer.from(url.split(",")[1]!, "base64"));
}

/** A minimal `.ora` archive. `mimetype: null` omits the entry. */
function ora(
  stackXml: string,
  images: Record<string, string>,
  opts: { mimetype?: string | null; method?: 0 | 8 } = {},
): Uint8Array<ArrayBuffer> {
  const entries: BuildEntry[] = [];
  if (opts.mimetype !== null) {
    entries.push({ name: "mimetype", data: text(opts.mimetype ?? "image/openraster") });
  }
  entries.push({ name: "stack.xml", data: text(stackXml), method: opts.method ?? 0 });
  for (const [name, url] of Object.entries(images)) {
    entries.push({ name, data: png(url), method: opts.method ?? 0 });
  }
  return buildZip(entries);
}

const wrap = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<image version="0.0.6" w="16" h="16">\n<stack>\n${body}\n</stack>\n</image>`;

describe("importOra — round-trip with the writer", () => {
  it("restores the stack: order, names, opacity, visibility, blend modes, positions", async () => {
    const blob = await exportOra([
      layer({
        src: solidUrl(4, 4, "#ff0000"),
        name: "base",
        opacity: 0.5,
        blendMode: "multiply",
      }),
      layer({
        src: solidUrl(4, 4, "#00ff00"),
        name: 'A<B>&"C',
        x: 10,
        y: 20,
        visible: false,
        blendMode: "exclusion",
      }),
    ]);
    assert.ok(blob);
    const imported = await importOra(new Uint8Array(await blob.arrayBuffer()));

    assert.equal(imported.length, 2);
    const [base, top] = imported;
    assert.equal(base!.name, "base");
    assert.equal(base!.opacity, 0.5);
    assert.equal(base!.blendMode, "multiply");
    assert.deepEqual([base!.x, base!.y, base!.width, base!.height], [0, 0, 4, 4]);

    assert.equal(top!.name, 'A<B>&"C', "XML escaping round-trips");
    assert.equal(top!.visible, false);
    // The writer emits svg:exclusion knowingly out of spec; our own files
    // must still round-trip it.
    assert.equal(top!.blendMode, "exclusion");
    assert.deepEqual([top!.x, top!.y, top!.width, top!.height], [10, 20, 4, 4]);

    const pixels = await pixelsOf(base!.src!);
    assert.deepEqual(px(pixels, 1, 1), [255, 0, 0, 255], "pixels survive the trip");
  });
});

describe("importOra — stack.xml semantics", () => {
  const IMAGES = {
    "data/top.png": solidUrl(3, 5, "#0000ff"),
    "data/mid.png": solidUrl(4, 4, "#00ff00"),
    "data/bottom.png": solidUrl(4, 4, "#ff0000"),
  };

  it("un-reverses the document order: the first <layer> is the topmost", async () => {
    // The independent oracle a round-trip cannot be: which named layer lands
    // where is spelled out by hand.
    const imported = await importOra(
      ora(
        wrap(
          `<layer name="top" src="data/top.png" x="1" y="2"/>
           <layer name="mid" src="data/mid.png"/>
           <layer name="bottom" src="data/bottom.png"/>`,
        ),
        IMAGES,
      ),
    );
    assert.deepEqual(
      imported.map((l) => l.name),
      ["bottom", "mid", "top"],
      "bottom→top, the document store's order",
    );
    assert.equal(imported.at(-1)!.name, "top");
  });

  it("sizes a layer from its own PNG and applies attribute defaults", async () => {
    const imported = await importOra(
      ora(wrap(`<layer name="top" src="data/top.png" x="1" y="2"/>`), IMAGES),
    );
    const [top] = imported;
    assert.deepEqual([top!.x, top!.y], [1, 2]);
    assert.deepEqual([top!.width, top!.height], [3, 5], "box = the PNG's own pixel size");
    assert.equal(top!.opacity, 1);
    assert.equal(top!.visible, true);
    assert.equal(top!.blendMode, "normal");
    assert.equal(top!.rotation, 0);
    assert.equal(top!.mask, null);
  });

  it("flattens a nested stack: opacity multiplies, hidden inherits, own op survives", async () => {
    const imported = await importOra(
      ora(
        wrap(
          `<layer name="over" src="data/top.png"/>
           <stack name="group" opacity="0.5">
             <layer name="in-group" src="data/mid.png" opacity="0.5" composite-op="svg:multiply"/>
           </stack>
           <stack visibility="hidden">
             <layer name="in-hidden" src="data/bottom.png"/>
           </stack>`,
        ),
        IMAGES,
      ),
    );
    assert.deepEqual(
      imported.map((l) => l.name),
      ["in-hidden", "in-group", "over"],
      "group members keep their place in the flattened z-order",
    );
    const [inHidden, inGroup] = imported;
    assert.equal(inGroup!.opacity, 0.25, "0.5 group × 0.5 layer");
    assert.equal(inGroup!.blendMode, "multiply", "the layer's own op, not the group's");
    assert.equal(inHidden!.visible, false, "a layer inside a hidden group imports hidden");
    assert.equal(inHidden!.opacity, 1);
  });

  it("maps ops latteart lacks to normal and resolves ./-prefixed src paths", async () => {
    const imported = await importOra(
      ora(
        wrap(
          `<layer name="pd" src="./data/mid.png" composite-op="svg:plus"/>
           <layer name="vendor" src="data/bottom.png" composite-op="krita:behind"/>`,
        ),
        IMAGES,
      ),
    );
    assert.equal(imported.length, 2, "the ./ path found its entry");
    assert.equal(imported[0]!.blendMode, "normal");
    assert.equal(imported[1]!.blendMode, "normal");
  });

  it("imports a fully deflated archive (the shape real editors write)", async () => {
    const imported = await importOra(
      ora(wrap(`<layer name="only" src="data/mid.png"/>`), IMAGES, { method: 8 }),
    );
    assert.equal(imported.length, 1);
    const pixels = await pixelsOf(imported[0]!.src!);
    assert.deepEqual(px(pixels, 1, 1), [0, 255, 0, 255]);
  });

  it("tolerates a missing mimetype entry — stack.xml is the real test", async () => {
    const imported = await importOra(
      ora(wrap(`<layer src="data/mid.png"/>`), IMAGES, { mimetype: null }),
    );
    assert.equal(imported.length, 1);
    assert.equal(imported[0]!.name, undefined, "an unnamed layer stays unnamed for makeLayer");
  });
});

describe("importOra — refusals", () => {
  const ONE = { "data/a.png": solidUrl(2, 2, "#fff") };

  it("rejects a zip that isn't OpenRaster", async () => {
    await assert.rejects(
      importOra(buildZip([{ name: "readme.txt", data: text("hi") }])),
      /no stack\.xml/,
    );
    await assert.rejects(
      importOra(ora(wrap(`<layer src="data/a.png"/>`), ONE, { mimetype: "application/epub+zip" })),
      /not an OpenRaster file \(mimetype says "application\/epub\+zip"\)/,
    );
  });

  it("rejects unreadable stack.xml, naming what's wrong", async () => {
    await assert.rejects(importOra(ora(`<image version="0.0.6" w="1" h="1">`, {})), /stack\.xml/);
    await assert.rejects(importOra(ora(`<?xml version="1.0"?><wrong/>`, {})), /no <image> root/);
    await assert.rejects(
      importOra(ora(`<image version="0.0.6" w="1" h="1"></image>`, {})),
      /no root <stack>/,
    );
    await assert.rejects(importOra(ora(wrap(""), {})), /contains no layers/);
    await assert.rejects(importOra(ora(wrap(`<layer name="lost"/>`), {})), /layer with no src/);
  });

  it("aborts — never skips — on a broken layer image, naming the entry", async () => {
    await assert.rejects(
      importOra(ora(wrap(`<layer src="data/gone.png"/>`), ONE)),
      /missing a layer image: data\/gone\.png/,
    );
    // PNG magic followed by garbage: passes the sniff, fails the decoder.
    const bad = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    await assert.rejects(
      importOra(
        buildZip([
          { name: "stack.xml", data: text(wrap(`<layer src="data/bad.png"/>`)) },
          { name: "data/bad.png", data: bad },
        ]),
      ),
      /failed to decode: data\/bad\.png/,
    );
    await assert.rejects(
      importOra(
        buildZip([
          { name: "stack.xml", data: text(wrap(`<layer src="data/x.bin"/>`)) },
          { name: "data/x.bin", data: text("plain text, no image signature") },
        ]),
      ),
      /not a PNG or JPEG: data\/x\.bin/,
    );
  });
});
