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

/** v1: a single implicit project. */
export const DEFAULT_PROJECT_ID = "default";

function projectDir(id: string): string {
  return join(PROJECTS_DIR, id);
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
    layers.flatMap((l) => {
      const file = typeof l.src === "string" ? assetRefFile(l.src) : null;
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

  return { ...doc, layers };
}
