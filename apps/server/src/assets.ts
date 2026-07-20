import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Content-hashed on-disk asset store, shared by the project and style stores.
 * Pixels split out of a manifest live as `<sha256>.<ext>` files under a caller-
 * supplied assets directory; the manifest keeps only `asset:<file>` refs so
 * base64 never touches the JSON, and identical images dedup by hash. Each store
 * owns its own directory, manifest, and pruning — this module owns only the
 * ref⇄bytes mapping.
 */

// Canonical mime↔ext pairs where the extension isn't just the subtype (jpeg,
// svg+xml). Any other image/* mime falls back to a sanitized subtype so an
// unlisted-but-valid raster (e.g. image/bmp) round-trips instead of being dropped.
const MIME_TO_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/svg+xml": "svg" };
const EXT_TO_MIME: Record<string, string> = { jpg: "image/jpeg", svg: "image/svg+xml" };

// Tolerates optional data-URL parameters (e.g. `;charset=utf-8`) and whitespace
// in the base64 body (line-wrapped payloads) — either would otherwise fail the
// match and drop the pixels. Buffer.from ignores the whitespace when decoding.
const DATA_URL_RE =
  /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+)(?:;[a-z0-9.+-]+=[^;,]*)*;base64,([\sA-Za-z0-9+/=]+)$/i;
const ASSET_REF_RE = /^asset:([a-f0-9]{64}\.[a-z0-9]+)$/;

/** Extension for a mime — canonical map first, else a sanitized image/* subtype.
 * Null only for a non-image or unparseable mime. */
function mimeToExt(mime: string): string | null {
  const m = mime.toLowerCase();
  if (MIME_TO_EXT[m]) return MIME_TO_EXT[m]!;
  const sub = /^image\/([a-z0-9.+-]+)$/.exec(m)?.[1];
  const ext = sub?.replace(/[^a-z0-9]/g, "");
  return ext || null;
}

/** Mime for a stored extension — inverse of mimeToExt. */
function extToMime(ext: string): string {
  return EXT_TO_MIME[ext] ?? `image/${ext}`;
}

/** The `<hash>.<ext>` filename an `asset:` ref points at, or null if the string
 * isn't a well-formed ref. Lets callers build/prune paths without re-deriving
 * the ref format or hand-slicing the `asset:` prefix. */
export function assetRefFile(ref: string): string | null {
  return ASSET_REF_RE.exec(ref)?.[1] ?? null;
}

/**
 * Write a data: URL's bytes to a content-hashed file in `assetsDir`; return its
 * ref (`asset:<hash>.<ext>`), or null if the input isn't a decodable image URL.
 * The caller is responsible for having created `assetsDir`.
 */
export function writeAsset(assetsDir: string, dataUrl: string): string | null {
  const m = DATA_URL_RE.exec(dataUrl);
  if (!m) return null;
  const ext = mimeToExt(m[1]!);
  if (!ext) return null;
  const bytes = Buffer.from(m[2]!, "base64");
  const file = `${createHash("sha256").update(bytes).digest("hex")}.${ext}`;
  const path = join(assetsDir, file);
  if (!existsSync(path)) writeFileSync(path, bytes, { mode: 0o600 });
  return `asset:${file}`;
}

/**
 * Rehydrate an `asset:` ref from `assetsDir` back to a data: URL, or undefined
 * if the ref is malformed or its file has vanished (so callers can keep the
 * surrounding record and simply drop the pixels).
 */
export function readAsset(assetsDir: string, ref: string | undefined): string | undefined {
  const file = ref ? assetRefFile(ref) : null;
  if (!file) return undefined;
  try {
    const bytes = readFileSync(join(assetsDir, file));
    const mime = extToMime(file.split(".").at(-1)!);
    return `data:${mime};base64,${bytes.toString("base64")}`;
  } catch {
    return undefined;
  }
}
