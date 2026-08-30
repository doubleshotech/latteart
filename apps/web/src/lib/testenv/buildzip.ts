import { deflateRawSync } from "node:zlib";
import { crc32 } from "../zip.ts";

/**
 * A configurable ZIP builder for exercising `lib/unzip` against archives the
 * production writer never produces — deflated entries, archive comments,
 * local-only extra fields, data-descriptor-style zeroed local sizes, and
 * deliberate corruption. `lib/zip` can't play this role: it writes exactly one
 * shape of archive, and the reader's whole job is accepting *foreign* ones.
 *
 * The layout knowledge here is the same as `testenv/archive.ts` documents; the
 * builder stays in testenv so production code never grows a second writer.
 */

export interface BuildEntry {
  name: string;
  data: Uint8Array;
  /** 0 = stored (default), 8 = deflate via `node:zlib`. */
  method?: 0 | 8;
  /** Write a wrong CRC into both headers — the payload check must catch it. */
  corruptCrc?: boolean;
  /** Stream-writer shape: set flag bit 3 and zero the LOCAL header's CRC and
   * sizes; the central directory keeps the real values. */
  zeroLocalSizes?: boolean;
  /** An extra field written to the local header ONLY — foreign writers do
   * this, and payload offsets must come from the local lengths to survive it. */
  localExtra?: Uint8Array;
  /** Override the compression method recorded in the headers (to fake an
   * unsupported one) without changing how the payload was actually written. */
  declaredMethod?: number;
  /** Extra flag bits to OR in (e.g. 0x0001 encrypted). */
  flags?: number;
}

export function buildZip(
  entries: BuildEntry[],
  opts: { comment?: Uint8Array } = {},
): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const method = entry.declaredMethod ?? entry.method ?? 0;
    const payload = entry.method === 8 ? new Uint8Array(deflateRawSync(entry.data)) : entry.data;
    const crc = (crc32(entry.data) ^ (entry.corruptCrc ? 0xdeadbeef : 0)) >>> 0;
    const flags = 0x0800 | (entry.zeroLocalSizes ? 0x0008 : 0) | (entry.flags ?? 0);
    const extra = entry.localExtra ?? new Uint8Array(0);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, flags, true);
    local.setUint16(8, method, true);
    if (!entry.zeroLocalSizes) {
      local.setUint32(14, crc, true);
      local.setUint32(18, payload.length, true);
      local.setUint32(22, entry.data.length, true);
    }
    local.setUint16(26, name.length, true);
    local.setUint16(28, extra.length, true);
    parts.push(new Uint8Array(local.buffer), name, extra, payload);

    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, 20, true);
    dir.setUint16(6, 20, true);
    dir.setUint16(8, flags, true);
    dir.setUint16(10, method, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, payload.length, true);
    dir.setUint32(24, entry.data.length, true);
    dir.setUint16(28, name.length, true);
    dir.setUint32(42, offset, true);
    const record = new Uint8Array(46 + name.length);
    record.set(new Uint8Array(dir.buffer), 0);
    record.set(name, 46);
    central.push(record);

    offset += 30 + name.length + extra.length + payload.length;
  }

  const directorySize = central.reduce((sum, r) => sum + r.length, 0);
  const comment = opts.comment ?? new Uint8Array(0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, directorySize, true);
  end.setUint32(16, offset, true);
  end.setUint16(20, comment.length, true);

  const total = offset + directorySize + 22 + comment.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of [...parts, ...central, new Uint8Array(end.buffer), comment]) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
