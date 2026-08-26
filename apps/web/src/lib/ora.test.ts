// node:test's describe()/it() are fire-and-forget by design — the runner awaits
// them — so the floating-promise rule does not apply in this test file.
/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bytesOf, readArchive } from "./testenv/archive.ts";
import {
  bitmapLog,
  installWorkerCanvas,
  pixelsOf,
  pngUrl,
  POISON_SRC,
  px,
  resetBitmapLog,
  solidUrl,
} from "./testenv/canvas.ts";
import { layer } from "./testenv/layers.ts";
import { exportOra } from "./ora.ts";
import type { Layer } from "../stores/documentStore";

installWorkerCanvas();

/**
 * The `.ora` writer, driven end to end in the worker-shaped environment and
 * read back through the same archive oracle as `zip.test.ts`, with the layer
 * PNGs decoded by napi's own codec. Geometry expectations are hand-worked
 * literals; the pixel checks stay on alpha 0/255 and solid colors, where the
 * rasterizer is exact.
 */

const GARBAGE = "data:image/png;base64,AAAA";

/** Every layer-attribute record in stack.xml, in document order (topmost first). */
function layerAttrs(xml: string): Record<string, string>[] {
  return [...xml.matchAll(/<layer (.*?)\/>/g)].map((m) =>
    Object.fromEntries([...m[1]!.matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [a[1]!, a[2]!])),
  );
}

async function exportAndRead(layers: Layer[]) {
  const blob = await exportOra(layers);
  assert.ok(blob, "the export produced a file");
  const { entries } = readArchive(await bytesOf(blob));
  const byName = new Map(entries.map((e) => [e.name, e]));
  const xml = new TextDecoder().decode(byName.get("stack.xml")!.data);
  const image = /<image version="([^"]*)" w="(\d+)" h="(\d+)">/.exec(xml);
  assert.ok(image, `stack.xml has no <image> header: ${xml}`);
  return {
    blob,
    entries,
    byName,
    xml,
    stack: layerAttrs(xml),
    version: image[1]!,
    w: Number(image[2]),
    h: Number(image[3]),
  };
}

describe("exportOra — container", () => {
  it("writes the spec's entries in the spec's order, mimetype first and stored", async () => {
    const out = await exportAndRead([
      layer({ src: solidUrl(4, 4, "#ff0000") }),
      layer({ src: solidUrl(4, 4, "#00ff00") }),
    ]);

    assert.deepEqual(
      out.entries.map((e) => e.name),
      [
        "mimetype",
        "stack.xml",
        "data/layer0.png",
        "data/layer1.png",
        "mergedimage.png",
        "Thumbnails/thumbnail.png",
      ],
    );
    const mimetype = out.entries[0]!;
    assert.equal(new TextDecoder().decode(mimetype.data), "image/openraster");
    assert.equal(mimetype.method, 0, "a reader identifies the format at a fixed offset");
    assert.equal(out.blob.type, "image/openraster");
    assert.equal(out.version, "0.0.6");
  });

  it("returns null when no layer holds pixels", async () => {
    assert.equal(await exportOra([]), null);
    assert.equal(await exportOra([layer({ src: null })]), null);
  });
});

describe("exportOra — stack.xml", () => {
  it("writes the stack topmost-first with live opacity, visibility and blend mode", async () => {
    const out = await exportAndRead([
      layer({ src: solidUrl(4, 4, "#f00"), name: "base", opacity: 0.5, blendMode: "multiply" }),
      layer({ src: solidUrl(4, 4, "#0f0"), name: 'A<B>&"C', visible: false, opacity: 1e-7 }),
    ]);

    assert.equal(out.stack.length, 2);
    // The array runs bottom→top; the first <layer> must be the TOPMOST.
    const [top, bottom] = out.stack;
    assert.equal(top!.src, "data/layer1.png");
    assert.equal(top!.name, "A&lt;B&gt;&amp;&quot;C");
    assert.equal(top!.visibility, "hidden");
    // 1e-7 as a "simple floating-point number", not scientific notation.
    assert.equal(top!.opacity, "0");
    assert.equal(top!["composite-op"], "svg:src-over");

    assert.equal(bottom!.src, "data/layer0.png");
    assert.equal(bottom!.name, "base");
    assert.equal(bottom!.visibility, "visible");
    assert.equal(bottom!.opacity, "0.5");
    assert.equal(bottom!["composite-op"], "svg:multiply");
  });
});

describe("exportOra — scale", () => {
  it("supersamples to the densest axis, so no layer drops below its own resolution", async () => {
    // A 20×10 box holding 20×40 pixels: the height ratio (4) is the binding
    // one. Measuring width alone would export at 1× and throw away detail.
    const out = await exportAndRead([
      layer({ src: solidUrl(20, 40, "#123456"), width: 20, height: 10 }),
    ]);

    assert.equal(out.w, 80);
    assert.equal(out.h, 40);
    const png = await pixelsOf(out.byName.get("data/layer0.png")!.data);
    assert.equal(png.width, 80);
    assert.equal(png.height, 40);
    const merged = await pixelsOf(out.byName.get("mergedimage.png")!.data);
    assert.equal(merged.width, 80);
    assert.equal(merged.height, 40);
    // Well under 256, so the thumbnail is the document at 1:1.
    const thumb = await pixelsOf(out.byName.get("Thumbnails/thumbnail.png")!.data);
    assert.equal(thumb.width, 80);
    assert.equal(thumb.height, 40);
  });

  it("caps the supersample at 4×", async () => {
    // 100×100 pixels in a 10×10 box asks for 10×; MAX_SCALE holds it at 4.
    const out = await exportAndRead([
      layer({ src: solidUrl(100, 100, "#123456"), width: 10, height: 10 }),
    ]);
    assert.equal(out.w, 40);
    assert.equal(out.h, 40);
  });

  it("caps the document's longest edge at 8192 and rescales everything to match", async () => {
    // 4200 units at the measured 2× would be 8400px, past the cap, so the
    // scale drops to 8192/4200 and every entry agrees on the smaller size.
    const out = await exportAndRead([
      layer({ src: solidUrl(8400, 100, "#123456"), width: 4200, height: 50 }),
    ]);

    assert.equal(out.w, 8192);
    assert.equal(out.h, 98); // round(50 × 8192/4200)
    const png = await pixelsOf(out.byName.get("data/layer0.png")!.data);
    assert.equal(png.width, 8192);
    assert.equal(png.height, 98);
    // Thumbnail: longest side pinned to 256, the other rounds along.
    const thumb = await pixelsOf(out.byName.get("Thumbnails/thumbnail.png")!.data);
    assert.equal(thumb.width, 256);
    assert.equal(thumb.height, 3); // round(98 × 256/8192)
  });
});

describe("exportOra — placement", () => {
  it("grows the document to contain a layer whose rounded edge lands past the box", async () => {
    // The measured box is 99.4 units wide → rounds to 99. But layer B's offset
    // (88.6 → 89) and PNG width (10.8 → 11) round independently, putting its
    // right edge at 100 — and a reader crops to (0,0,w,h), so a 99-wide
    // document would silently lose that column. The frame must be measured
    // from the layers actually placed.
    const out = await exportAndRead([
      layer({ src: solidUrl(10, 10, "#f00"), x: 0, width: 10, height: 10 }),
      layer({ src: solidUrl(10, 10, "#0f0"), x: 88.6, width: 10.8, height: 10 }),
    ]);

    assert.equal(out.w, 100);
    assert.equal(out.h, 10);
    const b = out.stack[0]!; // topmost = layer B
    assert.equal(b.x, "89");
    const bPng = await pixelsOf(out.byName.get("data/layer1.png")!.data);
    assert.equal(bPng.width, 11);
    for (const attrs of out.stack) {
      const right = Number(attrs.x) + (await pixelsOf(out.byName.get(attrs.src!)!.data)).width;
      assert.ok(right <= out.w, `${attrs.name} spills past the document (${right} > ${out.w})`);
    }
    const merged = await pixelsOf(out.byName.get("mergedimage.png")!.data);
    assert.equal(merged.width, 100, "mergedimage matches the grown frame");
  });

  it("re-origins the stack onto its own bounding box", async () => {
    // Work sitting at (−30, 40) must land at (0,0) — negative offsets are
    // legal but readers crop to (0,0,w,h).
    const out = await exportAndRead([
      layer({ src: solidUrl(8, 4, "#123456"), x: -30, y: 40, width: 8, height: 4 }),
    ]);
    assert.equal(out.stack[0]!.x, "0");
    assert.equal(out.stack[0]!.y, "0");
    assert.equal(out.w, 8);
    assert.equal(out.h, 4);
  });
});

describe("exportOra — baked pixels", () => {
  it("bakes a layer mask into the exported alpha", async () => {
    const mask = pngUrl(4, 4, (ctx) => {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, 2, 4);
      ctx.fillStyle = "#000";
      ctx.fillRect(2, 0, 2, 4);
    });
    const out = await exportAndRead([layer({ src: solidUrl(4, 4, "#12ab34"), mask })]);

    const png = await pixelsOf(out.byName.get("data/layer0.png")!.data);
    assert.deepEqual(px(png, 0, 1), [18, 171, 52, 255], "revealed half survives");
    assert.deepEqual(px(png, 3, 1), [0, 0, 0, 0], "hidden half is baked out");
  });

  it("bakes rotation as the axis-aligned hull", async () => {
    // A 4×4 square at 45°: the hull is 4√2 ≈ 5.66 a side → a 6×6 PNG whose
    // corners are outside the diamond and whose centre is inside it.
    const out = await exportAndRead([
      layer({ src: solidUrl(4, 4, "#12ab34"), width: 4, height: 4, rotation: 45 }),
    ]);

    const png = await pixelsOf(out.byName.get("data/layer0.png")!.data);
    assert.equal(png.width, 6);
    assert.equal(png.height, 6);
    assert.equal(px(png, 0, 0)[3], 0, "hull corner is transparent");
    assert.equal(px(png, 5, 5)[3], 0);
    assert.deepEqual(px(png, 3, 3), [18, 171, 52, 255], "diamond centre is the layer");
  });

  it("keeps opacity and blend mode OUT of the pixels — they stay live in stack.xml", async () => {
    const out = await exportAndRead([
      layer({ src: solidUrl(4, 4, "#12ab34"), opacity: 0.25, blendMode: "multiply" }),
    ]);
    const png = await pixelsOf(out.byName.get("data/layer0.png")!.data);
    // Baking 0.25 here and reading 0.25 from stack.xml would apply it twice.
    assert.deepEqual(px(png, 1, 1), [18, 171, 52, 255]);
    assert.equal(out.stack[0]!.opacity, "0.25");
  });
});

describe("exportOra — hidden and broken layers", () => {
  it("exports a hidden layer, marked hidden, but composites only visible ones", async () => {
    const out = await exportAndRead([
      layer({ src: solidUrl(4, 4, "#ff0000"), visible: false, name: "hidden red" }),
      layer({ src: solidUrl(4, 4, "#00ff00"), name: "green" }),
    ]);

    assert.equal(out.stack.length, 2, "losing hidden layers would make .ora lossier than PNG");
    const merged = await pixelsOf(out.byName.get("mergedimage.png")!.data);
    assert.deepEqual(px(merged, 2, 2), [0, 255, 0, 255], "the hidden red never composites");
  });

  it("writes a transparent mergedimage when every layer is hidden", async () => {
    const out = await exportAndRead([layer({ src: solidUrl(4, 4, "#ff0000"), visible: false })]);
    const merged = await pixelsOf(out.byName.get("mergedimage.png")!.data);
    assert.equal(merged.width, 4);
    assert.equal(merged.height, 4);
    assert.equal(px(merged, 1, 1)[3], 0, "required entry, but nothing to show");
  });

  it("skips a layer whose pixels won't decode rather than failing the export", async () => {
    const out = await exportAndRead([
      layer({ src: solidUrl(4, 4, "#00ff00"), name: "good" }),
      layer({ src: GARBAGE, name: "broken" }),
    ]);
    assert.deepEqual(
      out.stack.map((a) => a.name),
      ["good"],
    );
    assert.equal(out.byName.has("data/layer1.png"), false);
  });

  it("returns null when every layer fails to decode", async () => {
    assert.equal(await exportOra([layer({ src: GARBAGE })]), null);
  });
});

describe("exportOra — resource hygiene and progress", () => {
  it("closes every decoded bitmap on success", async () => {
    resetBitmapLog();
    await exportAndRead([
      layer({ src: solidUrl(4, 4, "#fff"), mask: solidUrl(4, 4, "#fff") }),
      layer({ src: solidUrl(4, 4, "#000") }),
    ]);
    assert.ok(bitmapLog.length >= 3);
    for (const [i, b] of bitmapLog.entries()) assert.equal(b.closed, true, `bitmap ${i} closed`);
  });

  it("closes every decoded bitmap when rendering throws mid-export", async () => {
    resetBitmapLog();
    // The poisoned layer decodes fine and explodes at draw time — the worker
    // outlives the export, so a leak here is permanent.
    await assert.rejects(
      exportOra([layer({ src: solidUrl(4, 4, "#fff") }), layer({ src: POISON_SRC })]),
    );
    assert.ok(bitmapLog.length >= 2);
    for (const [i, b] of bitmapLog.entries()) assert.equal(b.closed, true, `bitmap ${i} closed`);
  });

  it("reports one step per layer plus the merged image and the thumbnail", async () => {
    const ticks: [number, number][] = [];
    await exportOra(
      [layer({ src: solidUrl(2, 2, "#fff") }), layer({ src: solidUrl(2, 2, "#000") })],
      (done, total) => ticks.push([done, total]),
    );
    assert.deepEqual(ticks, [
      [1, 4],
      [2, 4],
      [3, 4],
      [4, 4],
    ]);
  });
});
