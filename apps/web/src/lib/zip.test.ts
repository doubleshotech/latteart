// node:test's describe()/it() are fire-and-forget by design — the runner awaits
// them — so the floating-promise rule does not apply in this test file.
/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { crc32 } from "node:zlib";
import { zip, type Bytes, type ZipEntry } from "./zip.ts";

/**
 * The zip writer emits bytes nothing in this repo reads back, so a unit test is
 * the only place its output gets checked at all — a wrong offset or a stale CRC
 * produces a file that looks fine until the user opens it in another program.
 *
 * These tests therefore **parse** the archive rather than assert on byte
 * literals: {@link readArchive} walks the central directory, follows each
 * recorded offset to its local header, and pulls the payload from there. That
 * exercises the offset arithmetic, which is the part most likely to be wrong
 * and the part a golden-bytes comparison would happily reproduce.
 *
 * CRC-32 gets an independent oracle — `node:zlib`'s — so the table in `zip.ts`
 * is checked against another implementation instead of against itself.
 */

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
/** Local header, central record, and end-of-central-directory, in bytes. */
const LOCAL_LEN = 30;
const CENTRAL_LEN = 46;
const EOCD_LEN = 22;

interface ParsedEntry {
  name: string;
  data: Uint8Array;
  crc: number;
  method: number;
  flags: number;
  localOffset: number;
  compressedSize: number;
  uncompressedSize: number;
}

const bytes = (s: string): Bytes => new TextEncoder().encode(s) as Bytes;

async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * A reader for the subset of ZIP `zip()` writes. Asserts every structural
 * signature as it goes, so a malformed archive fails inside the parse with a
 * message naming the field, not later on an opaque value mismatch.
 */
function readArchive(buf: Uint8Array): {
  entries: ParsedEntry[];
  centralOffset: number;
  centralSize: number;
} {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const eocd = buf.byteLength - EOCD_LEN;
  assert.ok(eocd >= 0, "archive is shorter than an end-of-central-directory record");
  assert.equal(view.getUint32(eocd, true), EOCD_SIG, "end-of-central-directory signature");

  const onThisDisk = view.getUint16(eocd + 8, true);
  const count = view.getUint16(eocd + 10, true);
  assert.equal(onThisDisk, count, "single-disk archive counts must agree");
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  assert.equal(
    centralOffset + centralSize,
    eocd,
    "central directory must end where the EOCD starts",
  );

  const decoder = new TextDecoder();
  const entries: ParsedEntry[] = [];
  let p = centralOffset;
  for (let i = 0; i < count; i++) {
    assert.equal(view.getUint32(p, true), CENTRAL_SIG, `central directory signature at entry ${i}`);
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const crc = view.getUint32(p + 16, true);
    const compressedSize = view.getUint32(p + 20, true);
    const uncompressedSize = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = decoder.decode(buf.subarray(p + CENTRAL_LEN, p + CENTRAL_LEN + nameLen));

    // Follow the offset the directory recorded — that round trip is the point.
    assert.equal(
      view.getUint32(localOffset, true),
      LOCAL_SIG,
      `local header signature for ${name}`,
    );
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const localName = decoder.decode(
      buf.subarray(localOffset + LOCAL_LEN, localOffset + LOCAL_LEN + localNameLen),
    );
    // A reader may trust either copy of these, so a mismatch is a real defect
    // even though every field is written twice from the same values.
    assert.equal(localName, name, "local and central names must match");
    assert.equal(view.getUint16(localOffset + 6, true), flags, `local flags for ${name}`);
    assert.equal(view.getUint16(localOffset + 8, true), method, `local method for ${name}`);
    assert.equal(view.getUint32(localOffset + 14, true), crc, `local CRC for ${name}`);
    assert.equal(view.getUint32(localOffset + 18, true), compressedSize, `local size for ${name}`);
    assert.equal(
      view.getUint32(localOffset + 22, true),
      uncompressedSize,
      `local size for ${name}`,
    );

    const start = localOffset + LOCAL_LEN + localNameLen + localExtraLen;
    entries.push({
      name,
      data: buf.subarray(start, start + compressedSize),
      crc,
      method,
      flags,
      localOffset,
      compressedSize,
      uncompressedSize,
    });
    p += CENTRAL_LEN + nameLen + extraLen + commentLen;
  }
  assert.equal(p, eocd, "walking the directory must land exactly on the EOCD");
  return { entries, centralOffset, centralSize };
}

const parse = async (blob: Blob) => readArchive(await bytesOf(blob));

describe("zip — archive structure", () => {
  it("round-trips names and payload bytes in the order given", async () => {
    const input: ZipEntry[] = [
      { name: "mimetype", data: bytes("image/openraster") },
      { name: "stack.xml", data: bytes("<image/>") },
      { name: "data/layer0.png", data: bytes("\x89PNG\r\n\x1a\n") },
    ];

    const { entries } = await parse(zip(input));

    assert.deepEqual(
      entries.map((e) => e.name),
      ["mimetype", "stack.xml", "data/layer0.png"],
      "OpenRaster identifies the format by finding mimetype first, so order is load-bearing",
    );
    for (const [i, entry] of entries.entries()) {
      assert.deepEqual(entry.data, input[i]!.data, `payload of ${entry.name}`);
    }
  });

  it("records each entry's real local-header offset", async () => {
    const first = { name: "a.txt", data: bytes("hello") };
    const second = { name: "nested/b.txt", data: bytes("world!!") };

    const { entries } = await parse(zip([first, second]));

    assert.equal(entries[0]!.localOffset, 0);
    // The second entry starts after the first's header, name and payload.
    assert.equal(entries[1]!.localOffset, LOCAL_LEN + first.name.length + first.data.length);
  });

  it("stores every entry uncompressed, with equal compressed and uncompressed sizes", async () => {
    const data = bytes("compress me".repeat(50));

    const { entries } = await parse(zip([{ name: "big.txt", data }]));

    assert.equal(entries[0]!.method, 0, "method 0 = stored");
    assert.equal(entries[0]!.compressedSize, data.length);
    assert.equal(entries[0]!.uncompressedSize, data.length);
  });

  it("sets the UTF-8 language-encoding flag and round-trips a non-ASCII name", async () => {
    const name = "データ/レイヤー.png";

    const { entries } = await parse(zip([{ name, data: bytes("x") }]));

    assert.equal(entries[0]!.flags & 0x0800, 0x0800, "bit 11 marks the name as UTF-8");
    assert.equal(entries[0]!.name, name);
  });

  it("writes an empty but valid archive for no entries", async () => {
    const buf = await bytesOf(zip([]));

    assert.equal(buf.byteLength, EOCD_LEN, "nothing but an end-of-central-directory record");
    const { entries, centralSize, centralOffset } = readArchive(buf);
    assert.deepEqual(entries, []);
    assert.equal(centralSize, 0);
    assert.equal(centralOffset, 0);
  });

  it("handles a zero-length entry", async () => {
    const { entries } = await parse(zip([{ name: "empty", data: bytes("") }]));

    assert.equal(entries[0]!.compressedSize, 0);
    assert.equal(entries[0]!.data.length, 0);
    assert.equal(entries[0]!.crc, 0, "CRC-32 of no bytes is 0");
  });
});

describe("zip — CRC-32", () => {
  it("matches node:zlib for a range of payloads", async () => {
    const payloads = [
      bytes(""),
      bytes("a"),
      bytes("123456789"), // the standard CRC-32 check vector
      bytes("image/openraster"),
      new Uint8Array(Array.from({ length: 256 }, (_, i) => i)) as Bytes,
      new Uint8Array(1000).fill(0xff) as Bytes,
    ];

    const { entries } = await parse(zip(payloads.map((data, i) => ({ name: `p${i}.bin`, data }))));

    for (const [i, entry] of entries.entries()) {
      assert.equal(entry.crc, crc32(payloads[i]!), `CRC-32 of payload ${i}`);
    }
  });

  it("agrees with the published check value for the standard vector", async () => {
    const { entries } = await parse(zip([{ name: "check", data: bytes("123456789") }]));

    assert.equal(entries[0]!.crc, 0xcbf43926);
  });
});

describe("zip — refusals", () => {
  it("refuses more entries than the 16-bit count field can hold", () => {
    const one: ZipEntry = { name: "a", data: bytes("x") };
    const tooMany = Array.from<ZipEntry>({ length: 0x10000 }).fill(one);

    assert.throws(() => zip(tooMany), /too many entries/);
    // One fewer is exactly the limit, and must not throw.
    assert.doesNotThrow(() => zip(tooMany.slice(0, 0xffff)));
  });
});

describe("zip — blob type", () => {
  it("defaults to application/zip and honours an override", () => {
    assert.equal(zip([]).type, "application/zip");
    assert.equal(zip([], "image/openraster").type, "image/openraster");
  });
});
