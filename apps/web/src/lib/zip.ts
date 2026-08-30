/**
 * A minimal ZIP writer — enough of the format to produce an OpenRaster file.
 *
 * Everything is **stored**, never deflated. That isn't a shortcut: the spec
 * requires the `mimetype` entry to be stored, and every other entry an `.ora`
 * carries is a PNG, which is already deflate-compressed — running it through
 * deflate a second time costs CPU to grow the file. So the one compression
 * method this writer needs is "none", which removes the only reason to pull in
 * a zip dependency.
 *
 * Scope, stated plainly so nobody mistakes this for a general zip library: no
 * compression, no directory entries, no ZIP64 (so a single entry and the total
 * archive must each stay under 4 GB), no data descriptors, no encryption, and
 * names are written as UTF-8 with the language-encoding flag set. That covers
 * an exported document and nothing more.
 */

/** Precomputed CRC-32 table (IEEE 802.3 polynomial, reflected). */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

/** CRC-32 of `data` — shared with `lib/unzip`, which verifies what this
 * writer (or any other) recorded. */
export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Bytes headed for a Blob. Pinned to `ArrayBuffer` rather than the default
 * `ArrayBufferLike`, because a `SharedArrayBuffer`-backed view is not a valid
 * `BlobPart` and everything here ends up in one.
 */
export type Bytes = Uint8Array<ArrayBuffer>;

export interface ZipEntry {
  /** Path inside the archive, e.g. `data/layer0.png`. Forward slashes only. */
  name: string;
  data: Bytes;
}

/** MS-DOS packed date+time. Whole archive shares one stamp — the entries are
 * written in the same instant, and file browsers want a plausible date rather
 * than a precise one. Pre-1980 can't be represented, so the year floors at it. */
function dosStamp(when: Date): { time: number; date: number } {
  const year = Math.max(1980, when.getFullYear());
  return {
    time: (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate(),
  };
}

/**
 * Build a ZIP archive from `entries`, in the order given — order is load-bearing
 * for OpenRaster, whose reader identifies the format by finding `mimetype`
 * first.
 *
 * `type` sets the Blob's MIME type; an `.ora` passes `image/openraster` so a
 * downloaded file is typed the way its content claims.
 */
export function zip(entries: ZipEntry[], type = "application/zip"): Blob {
  // The scope limits above are the format's, not preferences: sizes and offsets
  // are 32-bit fields and the entry count is 16-bit, so anything larger doesn't
  // wrap into a smaller archive, it writes a corrupt one. Refuse instead —
  // silent corruption in a file the user will open somewhere else is the worst
  // available failure.
  if (entries.length > 0xffff) {
    throw new Error(`too many entries for a zip archive: ${entries.length}`);
  }
  let total = 0;
  for (const entry of entries) {
    if (entry.data.length > 0xffffffff) throw new Error(`entry too large: ${entry.name}`);
    total += 30 + 46 + 2 * new TextEncoder().encode(entry.name).length + entry.data.length;
  }
  if (total > 0xffffffff) throw new Error(`archive too large: ${total} bytes`);

  const encoder = new TextEncoder();
  const stamp = dosStamp(new Date());
  const parts: BlobPart[] = [];
  const central: Bytes[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); // local file header signature
    local.setUint16(4, 20, true); // version needed: 2.0
    local.setUint16(6, 0x0800, true); // flags: UTF-8 names
    local.setUint16(8, 0, true); // method: stored
    local.setUint16(10, stamp.time, true);
    local.setUint16(12, stamp.date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true); // compressed size == uncompressed
    local.setUint32(22, size, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true); // extra field length

    parts.push(local.buffer, name, entry.data);

    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true); // central directory header signature
    dir.setUint16(4, 20, true); // version made by
    dir.setUint16(6, 20, true); // version needed
    dir.setUint16(8, 0x0800, true);
    dir.setUint16(10, 0, true);
    dir.setUint16(12, stamp.time, true);
    dir.setUint16(14, stamp.date, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, size, true);
    dir.setUint32(24, size, true);
    dir.setUint16(28, name.length, true);
    // 30 extra len, 32 comment len, 34 disk number, 36 internal attrs — all 0
    dir.setUint32(38, 0, true); // external attrs
    dir.setUint32(42, offset, true); // offset of this entry's local header

    const record = new Uint8Array(46 + name.length);
    record.set(new Uint8Array(dir.buffer), 0);
    record.set(name, 46);
    central.push(record);

    offset += 30 + name.length + size;
  }

  const directorySize = central.reduce((sum, r) => sum + r.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); // end of central directory signature
  end.setUint16(8, entries.length, true); // entries on this disk
  end.setUint16(10, entries.length, true); // entries total
  end.setUint32(12, directorySize, true);
  end.setUint32(16, offset, true); // offset of the central directory

  return new Blob([...parts, ...central, end.buffer], { type });
}
