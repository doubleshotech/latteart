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
import type { CustomStyle, CustomStyleInfo, StyleFragment, StyleSource } from "@latteart/shared";
import { assetRefFile, readAsset, writeAsset } from "../assets.ts";
import { DATA_DIR } from "../paths.ts";

/**
 * On-disk custom-style library (local-first, like the project + key stores). A
 * single global library — styles are reusable across projects (there's one
 * implicit project today). Lives under `.data/styles/` as:
 *
 *   styles.json           manifest — an array of {@link CustomStyle}
 *   assets/<hash>.<ext>   thumbnails + source reference images, content-hashed
 *
 * The manifest stores `asset:<file>` refs (see ../assets) for the thumbnail and
 * each source reference image; base64 never touches the JSON. On read, only the
 * thumbnail is rehydrated to a data: URL (the picker needs it); source refs stay
 * as refs until a native-conditioning provider consumes them. Assets no longer
 * referenced by any style are pruned after each write.
 */

const STYLES_DIR = join(DATA_DIR, "styles");
const ASSETS_DIR = join(STYLES_DIR, "assets");
const MANIFEST_PATH = join(STYLES_DIR, "styles.json");

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

/** Public list for the picker — label, thumbnail (rehydrated), and provenance. */
export function listStyles(): CustomStyleInfo[] {
  return readManifest().map((s) => ({
    id: s.id,
    label: s.label,
    thumbnail: readAsset(ASSETS_DIR, s.thumbnail),
    source: s.source,
    createdAt: s.createdAt,
  }));
}

/** Resolve a custom style id to its composition fragment, or undefined. Shared
 * by the generate/edit routes so a `custom:*` id composes exactly like a preset. */
export function getStyleFragment(id: string): StyleFragment | undefined {
  const s = readManifest().find((x) => x.id === id);
  return s ? { prompt: s.prompt, negativePrompt: s.negativePrompt } : undefined;
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
    id: `custom:${randomUUID().slice(0, 8)}`,
    label: input.label,
    prompt: input.prompt,
    negativePrompt: input.negativePrompt,
    thumbnail: thumbRef,
    source: input.source,
    refs,
    createdAt: Date.now(),
  };

  styles.push(style);
  writeManifest(styles);
  return {
    id: style.id,
    label: style.label,
    thumbnail: readAsset(ASSETS_DIR, thumbRef),
    source: style.source,
    createdAt: style.createdAt,
  };
}

/** Remove a custom style (and prune its now-unreferenced assets). No-op if absent. */
export function deleteStyle(id: string): void {
  const styles = readManifest();
  const next = styles.filter((s) => s.id !== id);
  if (next.length !== styles.length) writeManifest(next);
}

/** Default label when the user doesn't name a style: "Custom style N". */
export function nextStyleLabel(): string {
  return `Custom style ${readManifest().length + 1}`;
}
