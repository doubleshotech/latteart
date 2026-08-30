// node:test's describe()/it() are fire-and-forget by design — the runner awaits
// them — so the floating-promise rule does not apply in this test file.
/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildZip } from "./testenv/buildzip.ts";
import { unzip } from "./unzip.ts";
import { zip } from "./zip.ts";

/**
 * The ZIP reader, fed both the production writer's archives (round-trip) and
 * foreign shapes the writer never emits — built by `testenv/buildzip`, whose
 * layout knowledge is independent of the code under test.
 */

const text = (s: string) => new TextEncoder().encode(s);
const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());

async function payload(archive: Uint8Array<ArrayBuffer>, name: string): Promise<string> {
  const entry = unzip(archive).get(name);
  assert.ok(entry, `entry ${name} exists`);
  return new TextDecoder().decode(await entry.data());
}

describe("unzip — reading back the production writer", () => {
  it("round-trips names, order-independent lookup and payloads", async () => {
    const entries = [
      { name: "mimetype", data: text("image/openraster") },
      { name: "data/layer0.png", data: new Uint8Array([1, 2, 3, 4, 5]) },
      { name: "stack.xml", data: text("<image/>") },
    ];
    const parsed = unzip(await bytesOf(zip(entries)));

    assert.equal(parsed.size, 3);
    for (const entry of entries) {
      assert.deepEqual(await parsed.get(entry.name)!.data(), entry.data);
    }
  });

  it("reads an archive whose bytes sit at a nonzero view offset", async () => {
    // Callers hand over subarrays; absolute offsets in the file must be read
    // relative to the view, not the underlying buffer.
    const plain = await bytesOf(zip([{ name: "a.txt", data: text("hello") }]));
    const shifted = new Uint8Array(plain.length + 7);
    shifted.set(plain, 7);
    assert.equal(await payload(shifted.subarray(7), "a.txt"), "hello");
  });
});

describe("unzip — foreign archive shapes", () => {
  it("inflates a deflated entry and verifies it against the directory", async () => {
    const body = "x".repeat(4096) + "the compressed tail";
    const archive = buildZip([{ name: "stack.xml", data: text(body), method: 8 }]);
    assert.ok(archive.length < body.length, "the fixture is actually compressed");
    assert.equal(await payload(archive, "stack.xml"), body);
  });

  it("finds the end-of-central-directory behind an archive comment", async () => {
    const archive = buildZip([{ name: "a.txt", data: text("hi") }], {
      comment: text("written by some tool"),
    });
    assert.equal(await payload(archive, "a.txt"), "hi");
  });

  it("is not fooled by EOCD signature bytes inside the comment", async () => {
    // A comment containing the magic bytes: a naive backward scan stops at the
    // false signature (closer to the end) and reads garbage counts from it.
    const comment = new Uint8Array([0x99, 0x50, 0x4b, 0x05, 0x06, 0x99, 0x98, 0x97]);
    const archive = buildZip([{ name: "a.txt", data: text("real") }], { comment });
    assert.equal(await payload(archive, "a.txt"), "real");
  });

  it("takes the payload position from the local header's own extra field", async () => {
    // The extra field exists ONLY in the local header; trusting the central
    // directory's lengths would start the payload 8 bytes early.
    const archive = buildZip([
      { name: "a.txt", data: text("payload"), localExtra: new Uint8Array(8).fill(0xee) },
    ]);
    assert.equal(await payload(archive, "a.txt"), "payload");
  });

  it("reads a stream-writer archive whose local sizes are zeroed", async () => {
    // Flag bit 3: sizes and CRC live only in the central directory.
    const archive = buildZip([{ name: "a.txt", data: text("streamed"), zeroLocalSizes: true }]);
    assert.equal(await payload(archive, "a.txt"), "streamed");
  });
});

describe("unzip — refusals", () => {
  it("rejects garbage and truncation as 'not a zip'", () => {
    assert.throws(() => unzip(new Uint8Array([1, 2, 3])), /not a zip/);
    assert.throws(() => unzip(text("PNG or something, definitely not a zip file")), /not a zip/);
  });

  it("names an entry with an unsupported compression method", () => {
    const archive = buildZip([{ name: "weird.bin", data: text("x"), declaredMethod: 12 }]);
    assert.throws(() => unzip(archive), /unsupported compression method 12: weird\.bin/);
  });

  it("names an encrypted entry", () => {
    const archive = buildZip([{ name: "secret.txt", data: text("x"), flags: 0x0001 }]);
    assert.throws(() => unzip(archive), /encrypted entry: secret\.txt/);
  });

  it("rejects a corrupted payload at read time, naming the entry", async () => {
    const archive = buildZip([{ name: "data/l.png", data: text("pixels"), corruptCrc: true }]);
    const entry = unzip(archive).get("data/l.png");
    assert.ok(entry);
    await assert.rejects(entry.data(), /checksum: data\/l\.png/);
  });

  it("rejects an entry whose data runs past the end of the file", () => {
    const archive = buildZip([{ name: "a.txt", data: text("0123456789") }]);
    const view = new DataView(archive.buffer);
    // Stamp a compressed size far larger than the file — the payload span
    // check must refuse it rather than hand back an out-of-range subarray.
    const central = view.getUint32(archive.length - 22 + 16, true);
    view.setUint32(central + 20, 0x7fffffff, true);
    assert.throws(() => unzip(archive), /runs past the end/);
  });

  it("rejects ZIP64 sentinel values", () => {
    const archive = buildZip([{ name: "a.txt", data: text("x") }]);
    const view = new DataView(archive.buffer);
    // Stamp the central directory's uncompressed size with the ZIP64 marker.
    const central = view.getUint32(archive.length - 22 + 16, true);
    view.setUint32(central + 24, 0xffffffff, true);
    assert.throws(() => unzip(archive), /ZIP64/);
  });
});
