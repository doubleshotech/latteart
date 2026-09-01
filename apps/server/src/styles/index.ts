import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type {
  CustomStyle,
  CustomStyleDetail,
  CustomStyleInfo,
  StyleFragment,
  StyleSource,
} from "@latteart/shared";
import { assetRefFile, readAsset, readAssetBytes, writeAsset } from "../assets.ts";
import { DATA_DIR } from "../paths.ts";

/**
 * On-disk custom-style library (local-first, like the project + key stores).
 * One manifest holds every style; a style is either global (visible in every
 * project) or scoped to one project via `projectId`. Scoping is a visibility
 * feature the picker enforces client-side — the generate/edit routes resolve
 * any custom id they're handed. Lives under `.data/styles/` as:
 *
 *   styles.json           manifest — an array of {@link CustomStyle}
 *   assets/<hash>.<ext>   thumbnails + source reference images, content-hashed
 *
 * The manifest stores `asset:<file>` refs (see ../assets) for the thumbnail and
 * each source reference image; base64 never touches the JSON. On read, only the
 * thumbnail is rehydrated to a data: URL (the picker needs it): a source
 * reference becomes pixels for a native-conditioning provider
 * ({@link resolveCustomStyle}) or raw bytes for the edit dialog
 * ({@link readStyleRef}), never base64 in a list payload. Assets no longer
 * referenced by any style are pruned after each write.
 */

const STYLES_DIR = join(DATA_DIR, "styles");
const ASSETS_DIR = join(STYLES_DIR, "assets");
const MANIFEST_PATH = join(STYLES_DIR, "styles.json");

/** The `custom:` namespace keeps generated ids clear of preset ids. */
function newStyleId(): string {
  return `custom:${randomUUID().slice(0, 8)}`;
}

function readManifest(): CustomStyle[] {
  if (!existsSync(MANIFEST_PATH)) return [];
  try {
    const doc = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as unknown;
    return Array.isArray(doc) ? (doc as CustomStyle[]) : [];
  } catch {
    // Corrupt manifest — treat as empty rather than crash the app.
    return [];
  }
}

/** Persist the manifest atomically (tmp + rename) and prune unreferenced assets. */
function writeManifest(styles: CustomStyle[]): void {
  mkdirSync(ASSETS_DIR, { recursive: true, mode: 0o700 });
  const tmp = `${MANIFEST_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(styles, null, 2), { mode: 0o600 });
  renameSync(tmp, MANIFEST_PATH);

  const referenced = new Set<string>();
  for (const s of styles) {
    for (const ref of [s.thumbnail, ...s.refs]) {
      const file = ref ? assetRefFile(ref) : null;
      if (file) referenced.add(file);
    }
  }
  for (const file of readdirSync(ASSETS_DIR)) {
    if (!referenced.has(file)) rmSync(join(ASSETS_DIR, file), { force: true });
  }
}

/** Project a stored record to its public picker shape (thumbnail rehydrated). */
function toInfo(s: CustomStyle): CustomStyleInfo {
  return {
    id: s.id,
    label: s.label,
    thumbnail: readAsset(ASSETS_DIR, s.thumbnail),
    source: s.source,
    projectId: s.projectId,
    createdAt: s.createdAt,
  };
}

/** Public list for the picker — label, thumbnail (rehydrated), and provenance. */
export function listStyles(): CustomStyleInfo[] {
  return readManifest().map(toInfo);
}

/** One style with its descriptor text, for the edit dialog. Undefined if absent. */
export function getStyleDetail(id: string): CustomStyleDetail | undefined {
  const s = findStyle(id);
  if (!s) return undefined;
  // `refs` are the storage tokens, not the pixels: the dialog renders them via
  // readStyleRef and hands the survivors back on save, so editing the reference
  // list never base64s a full-size image in either direction.
  return { ...toInfo(s), prompt: s.prompt, negativePrompt: s.negativePrompt, refs: [...s.refs] };
}

/**
 * Read one of a style's reference images as raw bytes — the read side of the
 * refs route. `file` is the `<hash>.<ext>` name from a ref token; it is checked
 * against THIS style's refs, so a request can neither reach another style's
 * assets nor walk out of the directory. Undefined when the style, the ref, or
 * the file is missing.
 */
export function readStyleRef(
  id: string,
  file: string,
): { bytes: Buffer; mime: string } | undefined {
  const s = findStyle(id);
  const ref = s?.refs.find((r) => assetRefFile(r) === file);
  if (!ref) return undefined;
  return readAssetBytes(ASSETS_DIR, ref);
}

/** Look up a custom style record by id (one manifest read), or undefined. */
function findStyle(id: string): CustomStyle | undefined {
  return readManifest().find((s) => s.id === id);
}

/**
 * Resolve a custom style to its composition fragment plus (optionally) its
 * source reference images as data: URLs — from a SINGLE manifest read, so the
 * generate/edit routes never parse the library twice for one request. Shared by
 * both routes so a `custom:*` id composes exactly like a preset. `withRefs`
 * gates the heavier asset rehydration (the read-side of the `refs`
 * "native-conditioning door"): the routes pass true only when the chosen
 * provider conditions on the pixels natively (`styleRef` capability), so the
 * disk reads happen just when the pixels will be used. `refs` is [] when there
 * are none (or their assets have vanished); undefined for an unknown id.
 */
export function resolveCustomStyle(
  id: string,
  withRefs: boolean,
): { fragment: StyleFragment; refs: string[] } | undefined {
  const s = findStyle(id);
  if (!s) return undefined;
  return {
    fragment: { prompt: s.prompt, negativePrompt: s.negativePrompt },
    refs: withRefs
      ? s.refs.map((ref) => readAsset(ASSETS_DIR, ref)).filter((url): url is string => !!url)
      : [],
  };
}

export interface CreateStyleInput {
  label: string;
  prompt: string;
  negativePrompt?: string;
  source: StyleSource;
  /** Preview data: URL (downscaled reference) for the picker. */
  thumbnail?: string;
  /** Source reference images as data: URLs — kept for native conditioning later. */
  images: string[];
  /** Scope to one project; undefined = global. */
  projectId?: string;
}

/** Persist a new custom style; returns its public info. */
export function createStyle(input: CreateStyleInput): CustomStyleInfo {
  const styles = readManifest();
  mkdirSync(ASSETS_DIR, { recursive: true, mode: 0o700 });

  const thumbRef = input.thumbnail
    ? (writeAsset(ASSETS_DIR, input.thumbnail) ?? undefined)
    : undefined;
  const refs = input.images
    .map((img) => writeAsset(ASSETS_DIR, img))
    .filter((r): r is string => r !== null);

  const style: CustomStyle = {
    id: newStyleId(),
    label: input.label,
    prompt: input.prompt,
    negativePrompt: input.negativePrompt,
    thumbnail: thumbRef,
    source: input.source,
    refs,
    projectId: input.projectId,
    createdAt: Date.now(),
  };

  styles.push(style);
  writeManifest(styles);
  return toInfo(style);
}

export interface UpdateStylePatch {
  label?: string;
  prompt?: string;
  /** `""` clears the negatives; undefined keeps them. */
  negativePrompt?: string;
  /** `null` makes the style global; a project id scopes it; undefined keeps the scope. */
  projectId?: string | null;
  /** How the descriptor was produced — set when a re-describe replaces it. */
  source?: StyleSource;
  /** The complete new reference list as STORAGE refs (see {@link storeStyleAssets}). */
  refs?: string[];
  /** Replacement thumbnail as a STORAGE ref (see {@link storeStyleAssets}). */
  thumbnail?: string;
}

/**
 * Store the pixels an update carries, and return them as storage refs for
 * {@link updateStyle}'s patch. `refs` is the complete new list, each entry
 * either one of THIS style's current refs (kept as-is) or a data: URL (written
 * as a new asset); `thumbnail` is a replacement preview. Duplicates collapse —
 * two copies of one image content-hash to a single file, and the manifest must
 * not list it twice.
 *
 * Null means an entry resolved to nothing — a token belonging to no ref of this
 * style, or an image the asset store could not decode. The caller turns that
 * into a 400 rather than silently dropping a reference the user chose.
 *
 * The new asset files exist before the manifest names them, so the caller must
 * reach `updateStyle` in the SAME synchronous stretch: any `writeManifest` in
 * between (another route handler, a cascade) prunes every file the manifest
 * doesn't reference yet — including these.
 */
export function storeStyleAssets(
  id: string,
  input: { refs?: string[]; thumbnail?: string },
): { refs?: string[]; thumbnail?: string } | null {
  const s = findStyle(id);
  if (!s) return null;
  mkdirSync(ASSETS_DIR, { recursive: true, mode: 0o700 });
  const out: { refs?: string[]; thumbnail?: string } = {};

  if (input.refs !== undefined) {
    const current = new Set(s.refs);
    const refs: string[] = [];
    for (const entry of input.refs) {
      const ref = current.has(entry) ? entry : writeAsset(ASSETS_DIR, entry);
      if (!ref) return null;
      if (!refs.includes(ref)) refs.push(ref);
    }
    out.refs = refs;
  }

  if (input.thumbnail !== undefined) {
    const ref = writeAsset(ASSETS_DIR, input.thumbnail);
    if (!ref) return null;
    out.thumbnail = ref;
  }

  return out;
}

/**
 * Rename a style, edit its descriptor text, change its scope and/or replace its
 * reference images; returns the updated public info, or undefined for an
 * unknown id. Mutates the found record in place — an OMITTED `thumbnail` or
 * `refs` must survive untouched, or the post-write asset prune would silently
 * delete the source images native styleRef conditioning reads. When they are
 * provided, that same prune is what collects the images the user dropped.
 */
export function updateStyle(id: string, patch: UpdateStylePatch): CustomStyleInfo | undefined {
  const styles = readManifest();
  const s = styles.find((x) => x.id === id);
  if (!s) return undefined;
  if (patch.label !== undefined) s.label = patch.label;
  if (patch.prompt !== undefined) s.prompt = patch.prompt;
  if (patch.negativePrompt !== undefined) s.negativePrompt = patch.negativePrompt || undefined;
  if (patch.projectId !== undefined) s.projectId = patch.projectId ?? undefined;
  if (patch.source !== undefined) s.source = patch.source;
  if (patch.refs !== undefined) s.refs = patch.refs;
  if (patch.thumbnail !== undefined) s.thumbnail = patch.thumbnail;
  writeManifest(styles);
  return toInfo(s);
}

/** Remove a custom style (and prune its now-unreferenced assets). No-op if absent. */
export function deleteStyle(id: string): void {
  const styles = readManifest();
  const next = styles.filter((s) => s.id !== id);
  if (next.length !== styles.length) writeManifest(next);
}

/**
 * Remove every style scoped to a project — the delete-project cascade, so a
 * deleted project leaves no styles nothing can ever see again. Assets shared
 * with a surviving style (content-hashed, so a copy references the same files)
 * survive the prune; the rest go with the manifest write.
 */
export function deleteStylesForProject(projectId: string): void {
  const styles = readManifest();
  const next = styles.filter((s) => s.projectId !== projectId);
  if (next.length !== styles.length) writeManifest(next);
}

/**
 * Copy every style scoped to one project onto another — the duplicate-project
 * cascade. A copy is just a new manifest record (fresh id, `projectId` = the
 * duplicate) pointing at the SAME asset files; content-hashing makes the pixels
 * shared, and the prune keeps any file at least one record references. Returns
 * the old-id → new-id map so the caller can remap the duplicated project's
 * session styleId.
 */
export function copyStylesForProject(
  fromProjectId: string,
  toProjectId: string,
): Map<string, string> {
  const styles = readManifest();
  const idMap = new Map<string, string>();
  const copies: CustomStyle[] = [];
  for (const s of styles) {
    if (s.projectId !== fromProjectId) continue;
    const copy: CustomStyle = {
      ...s,
      id: newStyleId(),
      projectId: toProjectId,
    };
    idMap.set(s.id, copy.id);
    copies.push(copy);
  }
  if (copies.length > 0) writeManifest([...styles, ...copies]);
  return idMap;
}

/** Default label when the user doesn't name a style: "Custom style N". */
export function nextStyleLabel(): string {
  return `Custom style ${readManifest().length + 1}`;
}
