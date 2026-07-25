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
import type { ProjectDoc, ProjectLayer, ProjectSummary } from "@latteart/shared";
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
 * The project the very first session lands in, and the id every pre-switcher
 * project already uses on disk — so an existing install just finds its work as
 * the first entry in the list, with no migration.
 */
export const DEFAULT_PROJECT_ID = "default";

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

/** An empty document, used for a brand-new project. */
function emptyDoc(id: string, name: string): ProjectDoc {
  const now = Date.now();
  return {
    version: 1,
    id,
    name,
    createdAt: now,
    updatedAt: now,
    layers: [],
    viewport: { scale: 1, x: 0, y: 0 },
    session: {
      providerId: "mock",
      model: null,
      size: { w: 1024, h: 1024, label: "Square" },
      styleId: "none",
    },
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

  const layers: ProjectLayer[] = incoming.layers.map((l) => {
    let src: string | null = null;
    if (typeof l.src === "string") {
      if (l.src.startsWith("data:")) src = writeAsset(assetsDir, l.src);
      else {
        // Tolerate a client echoing back an on-disk ref; keep it only if the
        // asset actually exists.
        const file = assetRefFile(l.src);
        if (file && existsSync(join(assetsDir, file))) src = l.src;
      }
    }
    return { ...l, src };
  });

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
  else if (typeof incoming.thumbnail === "string") {
    if (incoming.thumbnail.startsWith("data:"))
      thumbnail = writeAsset(assetsDir, incoming.thumbnail);
    else {
      const file = assetRefFile(incoming.thumbnail);
      thumbnail = file && existsSync(join(assetsDir, file)) ? incoming.thumbnail : null;
    }
  }
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

  const manifestPath = join(dir, "project.json");
  const tmpPath = join(dir, "project.json.tmp");
  writeFileSync(tmpPath, JSON.stringify(doc, null, 2), { mode: 0o600 });
  renameSync(tmpPath, manifestPath);

  // Prune assets the new manifest no longer references (old layer versions,
  // superseded thumbnails).
  const referenced = new Set(
    [...layers.map((l) => l.src), thumbnail].flatMap((src) => {
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
  // Asset vanished / non-ref src → keep the layer (name/prompt survive), drop pixels.
  const layers = doc.layers.map((l) => ({
    ...l,
    src: typeof l.src === "string" ? (readAsset(assetsDir, l.src) ?? null) : null,
  }));

  return {
    ...doc,
    layers,
    thumbnail:
      typeof doc.thumbnail === "string" ? (readAsset(assetsDir, doc.thumbnail) ?? null) : null,
  };
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
      thumbnail:
        typeof doc.thumbnail === "string" ? (readAsset(assetsDir, doc.thumbnail) ?? null) : null,
    });
  }
  return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Create an empty project under a fresh id and return its manifest. */
export function createProject(name?: string): ProjectDoc {
  const id = randomUUID();
  const doc = emptyDoc(id, name?.trim() || "Untitled");
  mkdirSync(join(projectDir(id), "assets"), { recursive: true, mode: 0o700 });
  writeFileSync(join(projectDir(id), "project.json"), JSON.stringify(doc, null, 2), {
    mode: 0o600,
  });
  return doc;
}

/** Rename a project in place. Null when it doesn't exist. */
export function renameProject(id: string, name: string): ProjectDoc | null {
  const doc = readManifest(id);
  if (!doc) return null;
  const renamed: ProjectDoc = { ...doc, name: name.trim() || "Untitled", updatedAt: Date.now() };
  writeFileSync(join(projectDir(id), "project.json"), JSON.stringify(renamed, null, 2), {
    mode: 0o600,
  });
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
  writeFileSync(join(newDir, "project.json"), JSON.stringify(copy, null, 2), { mode: 0o600 });
  return copy;
}

/** Delete a project and everything under it. False when it didn't exist. */
export function deleteProject(id: string): boolean {
  const dir = projectDir(id);
  if (!existsSync(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}
