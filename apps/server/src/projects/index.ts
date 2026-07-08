import { createHash } from "node:crypto";
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
import type { ProjectDoc, ProjectLayer } from "@latteart/shared";
import { DATA_DIR } from "../paths.ts";

/**
 * On-disk project store (local-first, like the keystore). Each project lives
 * under `.data/projects/<id>/` as:
 *
 *   project.json          manifest — layers, viewport, session, timestamps
 *   assets/<hash>.<ext>   layer pixels, content-hashed (identical images dedup)
 *
 * On save, layer data: URLs are split out to asset files and the manifest
 * stores `asset:<file>` refs — base64 never touches the JSON. On load the refs
 * are rehydrated back to data: URLs. Assets no longer referenced by the
 * manifest are pruned after each save.
 */

const PROJECTS_DIR = join(DATA_DIR, "projects");

/** v1: a single implicit project. */
export const DEFAULT_PROJECT_ID = "default";

// Canonical mime↔ext pairs where the extension isn't just the subtype (jpeg,
// svg+xml). Any other image/* mime falls back to a sanitized subtype so its
// pixels are preserved rather than silently dropped on save.
const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/svg+xml": "svg",
};
const EXT_TO_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  svg: "image/svg+xml",
};

/** Extension for a mime — canonical map first, else a sanitized image/* subtype
 * (so an unlisted-but-valid raster like image/bmp round-trips instead of being
 * dropped). Null only for a non-image or unparseable mime. */
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

// Tolerates optional data-URL parameters (e.g. `;charset=utf-8`) and whitespace
// in the base64 body (line-wrapped payloads) — either would otherwise fail the
// match and drop the layer's pixels. Buffer.from ignores the whitespace when
// decoding.
const DATA_URL_RE =
  /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+)(?:;[a-z0-9.+-]+=[^;,]*)*;base64,([\sA-Za-z0-9+/=]+)$/i;
const ASSET_REF_RE = /^asset:([a-f0-9]{64}\.[a-z0-9]+)$/;

function projectDir(id: string): string {
  return join(PROJECTS_DIR, id);
}

/** Write a data: URL's pixels to a content-hashed asset file; return the ref. */
function writeAsset(assetsDir: string, dataUrl: string): string | null {
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
 * Persist a project: split layer images out to content-hashed assets, write the
 * manifest atomically (tmp + rename), then prune unreferenced assets. Returns
 * the stored manifest (with server-stamped timestamps).
 */
export function saveProject(id: string, incoming: ProjectDoc): ProjectDoc {
  const dir = projectDir(id);
  const assetsDir = join(dir, "assets");
  mkdirSync(assetsDir, { recursive: true, mode: 0o700 });

  const layers: ProjectLayer[] = incoming.layers.map((l) => {
    let src: string | null = null;
    if (typeof l.src === "string") {
      if (l.src.startsWith("data:")) src = writeAsset(assetsDir, l.src);
      // Tolerate a client echoing back an on-disk ref; keep it only if the
      // asset actually exists.
      else if (ASSET_REF_RE.test(l.src) && existsSync(join(assetsDir, l.src.slice(6)))) src = l.src;
    }
    return { ...l, src };
  });

  const existing = readManifest(id);
  const doc: ProjectDoc = {
    ...incoming,
    version: 1,
    id,
    name: incoming.name || "Untitled",
    createdAt: existing?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
    layers,
  };

  const manifestPath = join(dir, "project.json");
  const tmpPath = join(dir, "project.json.tmp");
  writeFileSync(tmpPath, JSON.stringify(doc, null, 2), { mode: 0o600 });
  renameSync(tmpPath, manifestPath);

  // Prune assets the new manifest no longer references (old layer versions).
  const referenced = new Set(
    layers.flatMap((l) => (l.src?.startsWith("asset:") ? [l.src.slice(6)] : [])),
  );
  for (const file of readdirSync(assetsDir)) {
    if (!referenced.has(file)) rmSync(join(assetsDir, file), { force: true });
  }

  return doc;
}

function readManifest(id: string): ProjectDoc | null {
  const path = join(projectDir(id), "project.json");
  if (!existsSync(path)) return null;
  try {
    const doc = JSON.parse(readFileSync(path, "utf8")) as ProjectDoc;
    return Array.isArray(doc.layers) ? doc : null;
  } catch {
    // Corrupt manifest — treat as no project rather than crash the app.
    return null;
  }
}

/** Load a project and rehydrate asset refs back to data: URLs. Null if none. */
export function loadProject(id: string): ProjectDoc | null {
  const doc = readManifest(id);
  if (!doc) return null;

  const assetsDir = join(projectDir(id), "assets");
  const layers = doc.layers.map((l) => {
    const m = typeof l.src === "string" ? ASSET_REF_RE.exec(l.src) : null;
    if (!m) return { ...l, src: null };
    const file = m[1]!;
    try {
      const bytes = readFileSync(join(assetsDir, file));
      const mime = extToMime(file.split(".").at(-1)!);
      return { ...l, src: `data:${mime};base64,${bytes.toString("base64")}` };
    } catch {
      // Asset vanished — keep the layer (name/prompt survive), drop the pixels.
      return { ...l, src: null };
    }
  });

  return { ...doc, layers };
}
