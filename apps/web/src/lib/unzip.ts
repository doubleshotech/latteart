import { crc32 } from "./zip";

/**
 * A minimal ZIP reader — the read-side counterpart of `lib/zip`, sized for
 * opening an OpenRaster file rather than for zips in general.
 *
 * Unlike the writer, this reads *foreign* archives — Krita's, GIMP's, anyone's
 * — so it can't lean on the writer's own simplifications:
 *
 * - **The end-of-central-directory record is found by scanning backwards**,
 *   not assumed to be the last 22 bytes: a zip may end with a comment of up to
 *   64 KiB. A candidate signature only counts when its recorded comment length
 *   reaches exactly the end of the file, so signature bytes that happen to
 *   appear inside entry data can't be mistaken for the record.
 * - **Sizes and CRCs come from the central directory**, which always holds the
 *   final values — a writer that streamed with data descriptors (flag bit 3)
 *   leaves zeros in the local headers. The payload's *position*, though, is
 *   computed from the local header's own name and extra-field lengths: writers
 *   put extra fields in local headers that the central copy doesn't carry.
 * - **Deflate is supported** (method 8, via `DecompressionStream`) alongside
 *   stored — real `.ora` writers compress `stack.xml` at least.
 *
 * Still refused, loudly, in `lib/zip`'s refuse-over-corrupt spirit: any other
 * compression method, ZIP64 (surfacing as 0xFFFF/0xFFFFFFFF sentinel values),
 * multi-disk archives, and encryption. Every payload is verified against the
 * directory's CRC-32 and size when read, so a truncated or corrupted entry
 * names itself instead of decoding into garbage pixels.
 */

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const LOCAL_LEN = 30;
const CENTRAL_LEN = 46;
const EOCD_LEN = 22;
/** A zip comment length is a 16-bit field, so the EOCD sits within this many
 * trailing bytes. */
const MAX_EOCD_SPAN = EOCD_LEN + 0xffff;

/** Encrypted entries set bit 0; readers that ignore it decode noise. */
const FLAG_ENCRYPTED = 0x0001;

export interface UnzippedEntry {
  name: string;
  /**
   * The entry's decompressed payload. Inflating and verifying happen here, on
   * first use, so entries the caller never reads (`mergedimage.png`,
   * thumbnails) cost nothing. Rejects, naming the entry, when the bytes fail
   * the directory's CRC or size — corruption should fail the open, not surface
   * later as a broken layer.
   */
  data(): Promise<Uint8Array<ArrayBuffer>>;
}

async function inflateRaw(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function findEocd(view: DataView, length: number): number {
  const floor = Math.max(0, length - MAX_EOCD_SPAN);
  for (let p = length - EOCD_LEN; p >= floor; p--) {
    if (view.getUint32(p, true) !== EOCD_SIG) continue;
    // The record is only real if its comment runs exactly to the end of the
    // file — otherwise this is entry data that happens to spell the signature.
    if (p + EOCD_LEN + view.getUint16(p + 20, true) === length) return p;
  }
  throw new Error("not a zip archive (no end-of-central-directory record)");
}

/**
 * Parse a ZIP archive into its entries, keyed by their exact stored name.
 * Structural problems (and the unsupported features above) throw here;
 * per-entry payload problems throw from that entry's `data()`. Duplicate
 * names last-win in the map — the same resolution mainstream extractors
 * apply, and an `.ora` writer has no reason to emit duplicates.
 */
export function unzip(buf: Uint8Array<ArrayBuffer>): Map<string, UnzippedEntry> {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf.byteLength < EOCD_LEN) throw new Error("not a zip archive (file too short)");
  const eocd = findEocd(view, buf.byteLength);

  const count = view.getUint16(eocd + 10, true);
  if (count === 0xffff || view.getUint32(eocd + 16, true) === 0xffffffff) {
    throw new Error("ZIP64 archives are not supported");
  }
  if (view.getUint16(eocd + 8, true) !== count || view.getUint16(eocd + 4, true) !== 0) {
    throw new Error("multi-disk archives are not supported");
  }

  const decoder = new TextDecoder();
  const entries = new Map<string, UnzippedEntry>();
  let p = view.getUint32(eocd + 16, true);

  for (let i = 0; i < count; i++) {
    if (p + CENTRAL_LEN > eocd || view.getUint32(p, true) !== CENTRAL_SIG) {
      throw new Error(`corrupt central directory at entry ${i}`);
    }
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
    p += CENTRAL_LEN + nameLen + extraLen + commentLen;

    if (flags & FLAG_ENCRYPTED) throw new Error(`encrypted entry: ${name}`);
    if (method !== 0 && method !== 8) {
      throw new Error(`unsupported compression method ${method}: ${name}`);
    }
    if (
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localOffset === 0xffffffff
    ) {
      throw new Error(`ZIP64 entry is not supported: ${name}`);
    }
    if (
      localOffset + LOCAL_LEN > buf.byteLength ||
      view.getUint32(localOffset, true) !== LOCAL_SIG
    ) {
      throw new Error(`corrupt local header: ${name}`);
    }

    // Position from the LOCAL header's lengths — its extra field can differ
    // from the central copy's. Sizes from the CENTRAL record — see above.
    const start =
      localOffset +
      LOCAL_LEN +
      view.getUint16(localOffset + 26, true) +
      view.getUint16(localOffset + 28, true);
    if (start + compressedSize > buf.byteLength) {
      throw new Error(`entry data runs past the end of the file: ${name}`);
    }
    const raw = buf.subarray(start, start + compressedSize);

    entries.set(name, {
      name,
      data: async () => {
        const bytes = method === 8 ? await inflateRaw(raw) : raw;
        if (bytes.length !== uncompressedSize) {
          throw new Error(`entry has the wrong size after decompression: ${name}`);
        }
        if (crc32(bytes) !== crc) throw new Error(`entry fails its checksum: ${name}`);
        return bytes;
      },
    });
  }
  return entries;
}
