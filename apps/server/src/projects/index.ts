import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { ProjectDoc, ProjectLayer, ProjectSession, ProjectSummary } from "@latteart/shared";
import { assetRefFile, readAsset, writeAsset } from "../assets.ts";
import { DATA_DIR } from "../paths.ts";

/**
 * On-disk project store (local-first, like the keystore). Each project lives
 * under `.data/projects/<id>/` as:
 *
 *   project.json          manifest — layers, viewport, session, timestamps
 *   assets/<hash>.<ext>   layer pixels, content-hashed (identical images dedup)
 *
 * On save, layer data: URLs are split out to content-hashed asset files (see
 * ../assets) and the manifest stores `asset:<file>` refs — base64 never touches
 * the JSON. On load the refs are rehydrated back to data: URLs. Assets no longer
 * referenced by the manifest are pruned after each save.
 */

const PROJECTS_DIR = join(DATA_DIR, "projects");

/**
 * Ids become directory names, so they must not traverse or collide with the
 * manifest. Generated ids are uuids; this guards the ones that arrive from the
 * client as a path segment.
 */
export function isValidProjectId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id);
}

function projectDir(id: string): string {
  return join(PROJECTS_DIR, id);
}

/**
 * Write a manifest atomically (tmp + rename), so a crash mid-write can't leave
 * a half-written project.json where a whole project used to be. Every writer
 * goes through here — the same rule the style store follows.
 */
function writeManifest(id: string, doc: ProjectDoc): void {
  const dir = projectDir(id);
  const tmpPath = join(dir, "project.json.tmp");
  writeFileSync(tmpPath, JSON.stringify(doc, null, 2), { mode: 0o600 });
  renameSync(tmpPath, join(dir, "project.json"));
}

/** Rehydrate a manifest's `asset:` thumbnail ref to a data: URL. */
function readThumbnail(assetsDir: string, ref: string | null | undefined): string | null {
  return typeof ref === "string" ? (readAsset(assetsDir, ref) ?? null) : null;
}

/**
 * Pixels in → an `asset:` ref out. A data: URL is written to a content-hashed
 * file; a ref the client echoed back is kept only if its asset still exists;
 * anything else (absent, null, unparseable) stores nothing. Every image field
 * on a layer — `src` and `mask` alike — goes through here.
 */
function storeImage(assetsDir: string, value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  if (value.startsWith("data:")) return writeAsset(assetsDir, value);
  const file = assetRefFile(value);
  return file && existsSync(join(assetsDir, file)) ? value : null;
}

/** Fallback session for a new project when the caller doesn't supply one. */
const FALLBACK_SESSION: ProjectSession = {
  providerId: "mock",
  model: null,
  size: { w: 1024, h: 1024, label: "Square" },
  styleId: "none",
};

/**
 * An empty document for a brand-new project. The caller passes its current
 * session so "New project" doesn't silently reset the provider, model and
 * output size the user already chose — a new canvas, not a new setup.
 */
function emptyDoc(id: string, name: string, session?: ProjectSession): ProjectDoc {
  const now = Date.now();
  return {
    version: 1,
    id,
    name,
    createdAt: now,
    updatedAt: now,
    layers: [],
    viewport: { scale: 1, x: 0, y: 0 },
    session: session ?? FALLBACK_SESSION,
    thumbnail: null,
  };
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

  const layers: ProjectLayer[] = incoming.layers.map((l) => ({
    ...l,
    src: storeImage(assetsDir, l.src),
    mask: storeImage(assetsDir, l.mask),
  }));

  const existing = readManifest(id);

  // The thumbnail is pixels too, so it rides the same content-hashed asset path
  // as a layer — and, critically, must join the referenced set below or the
  // prune at the end of this function would delete it the moment it's written.
  //
  // Three-way, because *absent* and *null* mean different things: an omitted
  // field keeps whatever is on disk (the unload save can't afford to render one
  // and must not wipe the old one), while an explicit null clears it — that's
  // how a project whose last visible layer was deleted loses its preview.
  let thumbnail: string | null = existing?.thumbnail ?? null;
  if (incoming.thumbnail === null) thumbnail = null;
  else if (typeof incoming.thumbnail === "string")
    thumbnail = storeImage(assetsDir, incoming.thumbnail);
  const doc: ProjectDoc = {
    ...incoming,
    version: 1,
    id,
    name: incoming.name || "Untitled",
    createdAt: existing?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
    layers,
    thumbnail,
  };

  writeManifest(id, doc);

  // Prune assets the new manifest no longer references (old layer versions,
  // superseded thumbnails, masks that were edited or removed). Every image
  // field written above must appear here, or the prune deletes it the instant
  // it's written.
  const referenced = new Set(
    [...layers.map((l) => l.src), ...layers.map((l) => l.mask), thumbnail].flatMap((src) => {
      const file = typeof src === "string" ? assetRefFile(src) : null;
      return file ? [file] : [];
    }),
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
  // Asset vanished / non-ref src → keep the layer (name/prompt survive), drop
  // pixels. A vanished mask drops to null, which reads as "unmasked" — the
  // layer comes back whole rather than invisible.
  const layers = doc.layers.map((l) => ({
    ...l,
    src: typeof l.src === "string" ? (readAsset(assetsDir, l.src) ?? null) : null,
    mask: typeof l.mask === "string" ? (readAsset(assetsDir, l.mask) ?? null) : null,
  }));

  return { ...doc, layers, thumbnail: readThumbnail(assetsDir, doc.thumbnail) };
}

/**
 * Every project on disk, newest-edited first — the switcher's list.
 *
 * Only the thumbnail is rehydrated; layer pixels stay on disk, so listing a
 * dozen image-heavy projects costs one small image each rather than every
 * asset. A directory without a readable manifest is skipped rather than fatal,
 * matching readManifest's "corrupt is not a crash" stance.
 */
export function listProjects(): ProjectSummary[] {
  if (!existsSync(PROJECTS_DIR)) return [];
  const summaries: ProjectSummary[] = [];
  for (const entry of readdirSync(PROJECTS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const doc = readManifest(entry.name);
    if (!doc) continue;
    const assetsDir = join(projectDir(entry.name), "assets");
    summaries.push({
      id: entry.name,
      name: doc.name || "Untitled",
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      layerCount: doc.layers.length,
      thumbnail: readThumbnail(assetsDir, doc.thumbnail),
    });
  }
  return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Create an empty project under a fresh id and return its manifest. */
export function createProject(name?: string, session?: ProjectSession): ProjectDoc {
  const id = randomUUID();
  const doc = emptyDoc(id, name?.trim() || "Untitled", session);
  mkdirSync(join(projectDir(id), "assets"), { recursive: true, mode: 0o700 });
  writeManifest(id, doc);
  return doc;
}

/** Rename a project in place. Null when it doesn't exist. */
export function renameProject(id: string, name: string): ProjectDoc | null {
  const doc = readManifest(id);
  if (!doc) return null;
  const renamed: ProjectDoc = { ...doc, name: name.trim() || "Untitled", updatedAt: Date.now() };
  writeManifest(id, renamed);
  return renamed;
}

/**
 * Copy a project (manifest + every asset) under a new id. The copy is a
 * straight file copy rather than a load/save round-trip, so the pixels never
 * pass through base64 — content hashes already match, so the assets land under
 * the same filenames the copied manifest refers to.
 */
export function duplicateProject(id: string, name?: string): ProjectDoc | null {
  const doc = readManifest(id);
  if (!doc) return null;

  const newId = randomUUID();
  const newDir = projectDir(newId);
  mkdirSync(join(newDir, "assets"), { recursive: true, mode: 0o700 });

  const srcAssets = join(projectDir(id), "assets");
  if (existsSync(srcAssets)) {
    for (const file of readdirSync(srcAssets)) {
      copyFileSync(join(srcAssets, file), join(newDir, "assets", file));
    }
  }

  const now = Date.now();
  const copy: ProjectDoc = {
    ...doc,
    id: newId,
    name: name?.trim() || `${doc.name} copy`,
    createdAt: now,
    updatedAt: now,
  };
  writeManifest(newId, copy);
  return copy;
}

/**
 * Point a project's session style at a different id — the duplicate-project
 * cascade rewrites the copy's selection onto its own copied style, so it never
 * references a style scoped to the source project. Null when the project
 * doesn't exist. Deliberately does NOT bump updatedAt (unlike renameProject):
 * this is a system rewrite inside the duplicate, not a user edit, and the
 * copy's timestamps should stay as duplicateProject set them.
 */
export function restyleSession(id: string, styleId: string): ProjectDoc | null {
  const doc = readManifest(id);
  if (!doc) return null;
  const updated: ProjectDoc = { ...doc, session: { ...doc.session, styleId } };
  writeManifest(id, updated);
  return updated;
}

/** Delete a project and everything under it. False when it didn't exist. */
export function deleteProject(id: string): boolean {
  const dir = projectDir(id);
  if (!existsSync(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}
