// node:test's describe()/it() are fire-and-forget by design — the runner awaits
// them — so the floating-promise rule does not apply in this test file.
/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { crc32 } from "node:zlib";
import { zip, type Bytes, type ZipEntry } from "./zip.ts";
import { bytesOf, EOCD_LEN, LOCAL_LEN, readArchive, unpackStamp } from "./testenv/archive.ts";

/**
 * The zip writer emits bytes nothing in this repo reads back, so a unit test is
 * the only place its output gets checked at all — a wrong offset or a stale CRC
 * produces a file that looks fine until the user opens it in another program.
 *
 * These tests therefore **parse** the archive rather than assert on byte
 * literals, via `testenv/archive`'s {@link readArchive} — see its docblock for
 * why parsing beats golden bytes. (`ora.test.ts` reads its OpenRaster container
 * through the same oracle.)
 *
 * CRC-32 gets an independent oracle — `node:zlib`'s — so the table in `zip.ts`
 * is checked against another implementation instead of against itself.
 */

const bytes = (s: string): Bytes => new TextEncoder().encode(s) as Bytes;

/**
 * A payload that only claims to be huge. The size guards read `.length` before
 * anything indexes the buffer, so this reaches them without allocating gigabytes
 * — the reason those two branches are testable at all.
 */
const oversized = (length: number) => ({ length }) as unknown as Bytes;

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

    // Equality, not a mask: `zip.ts` documents that it writes no data
    // descriptor and no encryption, so bit 11 must be the *only* flag set. A
    // mask would wave through a stray bit that changes how a reader behaves.
    assert.equal(entries[0]!.flags, 0x0800, "bit 11, and nothing else, is set");
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

describe("zip — MS-DOS timestamp", () => {
  it("packs today's date into the DOS date field", async () => {
    // The packing is three shifts into 16 bits; nothing else in the repo reads
    // it back, so a wrong shift would ship a file dated 2044 in silence.
    const before = new Date();
    const { entries } = await parse(zip([{ name: "a", data: bytes("x") }]));
    const after = new Date();

    const stamp = unpackStamp(entries[0]!.dosTime, entries[0]!.dosDate);
    const ymd = (d: Date) => [d.getFullYear(), d.getMonth() + 1, d.getDate()];
    // Two readings, in case the test straddles midnight.
    assert.ok(
      JSON.stringify([stamp.year, stamp.month, stamp.day]) === JSON.stringify(ymd(before)) ||
        JSON.stringify([stamp.year, stamp.month, stamp.day]) === JSON.stringify(ymd(after)),
      `decoded ${stamp.year}-${stamp.month}-${stamp.day}, expected ${ymd(after).join("-")}`,
    );
  });

  it("packs a time whose every field is in range", async () => {
    const { entries } = await parse(zip([{ name: "a", data: bytes("x") }]));

    const { hours, minutes, seconds } = unpackStamp(entries[0]!.dosTime, entries[0]!.dosDate);
    assert.ok(hours <= 23, `hours ${hours}`);
    assert.ok(minutes <= 59, `minutes ${minutes}`);
    // DOS stores seconds halved, so odd values are unrepresentable by design.
    assert.ok(seconds <= 58 && seconds % 2 === 0, `seconds ${seconds}`);
  });

  it("gives every entry in one archive the same stamp", async () => {
    const { entries } = await parse(
      zip([
        { name: "a", data: bytes("x") },
        { name: "b", data: bytes("y") },
        { name: "c", data: bytes("z") },
      ]),
    );

    // Documented: the entries are written in the same instant, so file browsers
    // get a plausible date rather than three drifting ones.
    assert.equal(new Set(entries.map((e) => e.dosDate)).size, 1);
    assert.equal(new Set(entries.map((e) => e.dosTime)).size, 1);
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

  it("refuses an entry larger than the 32-bit size field", () => {
    // No 4 GB allocation needed: `zip` reads `.length` before it touches a
    // byte, so a stub reaches the guard in microseconds. Without this the
    // refusal path — which the module calls its reason to exist, since a
    // corrupt archive fails somewhere the user cannot see — never runs.
    assert.throws(
      () => zip([{ name: "huge.png", data: oversized(0x100000000) }]),
      /entry too large: huge\.png/,
    );
  });

  it("refuses an archive whose total overflows, even when each entry fits", () => {
    // Five 1 GiB entries: every one is under the per-entry cap, so only the
    // running total catches this. That is a genuinely separate branch.
    const entries = Array.from({ length: 5 }, (_, i) => ({
      name: `p${i}.bin`,
      data: oversized(0x40000000),
    }));

    assert.throws(() => zip(entries), /archive too large/);
  });
});

describe("zip — blob type", () => {
  it("defaults to application/zip and honours an override", () => {
    assert.equal(zip([]).type, "application/zip");
    assert.equal(zip([], "image/openraster").type, "image/openraster");
  });
});
