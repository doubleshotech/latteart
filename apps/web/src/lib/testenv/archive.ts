import assert from "node:assert/strict";

/**
 * A reader for the subset of ZIP `lib/zip` writes — the shared oracle for
 * `zip.test.ts` (archive structure) and `ora.test.ts` (the OpenRaster
 * container). One reader, so the two suites cannot drift apart on what a
 * valid archive looks like.
 *
 * It **parses** rather than comparing byte literals: it walks the central
 * directory, follows each recorded offset to its local header, and pulls the
 * payload from there. That exercises the offset arithmetic, which is the part
 * most likely to be wrong and the part a golden-bytes comparison would happily
 * reproduce. Every structural signature is asserted as it goes, so a malformed
 * archive fails inside the parse with a message naming the field, not later on
 * an opaque value mismatch.
 */

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
/** Local header, central record, and end-of-central-directory, in bytes. */
export const LOCAL_LEN = 30;
const CENTRAL_LEN = 46;
export const EOCD_LEN = 22;

export interface ParsedEntry {
  name: string;
  data: Uint8Array;
  crc: number;
  method: number;
  flags: number;
  localOffset: number;
  compressedSize: number;
  uncompressedSize: number;
  /** MS-DOS packed time and date, still packed — {@link unpackStamp} reads them. */
  dosTime: number;
  dosDate: number;
}

/** Undo the MS-DOS packing `dosStamp` applies. Seconds are stored halved. */
export function unpackStamp(time: number, date: number) {
  return {
    year: ((date >> 9) & 0x7f) + 1980,
    month: (date >> 5) & 0x0f,
    day: date & 0x1f,
    hours: (time >> 11) & 0x1f,
    minutes: (time >> 5) & 0x3f,
    seconds: (time & 0x1f) * 2,
  };
}

export async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

export function readArchive(buf: Uint8Array): {
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
    const dosTime = view.getUint16(p + 12, true);
    const dosDate = view.getUint16(p + 14, true);
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
    assert.equal(view.getUint16(localOffset + 10, true), dosTime, `local time for ${name}`);
    assert.equal(view.getUint16(localOffset + 12, true), dosDate, `local date for ${name}`);
    assert.equal(view.getUint32(localOffset + 14, true), crc, `local CRC for ${name}`);
    assert.equal(
      view.getUint32(localOffset + 18, true),
      compressedSize,
      `local compressed size for ${name}`,
    );
    assert.equal(
      view.getUint32(localOffset + 22, true),
      uncompressedSize,
      `local uncompressed size for ${name}`,
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
      dosTime,
      dosDate,
    });
    p += CENTRAL_LEN + nameLen + extraLen + commentLen;
  }
  assert.equal(p, eocd, "walking the directory must land exactly on the EOCD");
  return { entries, centralOffset, centralSize };
}
