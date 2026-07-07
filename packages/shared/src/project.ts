/**
 * Project persistence types shared by the web autosave client and the server's
 * on-disk project store.
 *
 * Wire vs disk: over the API a layer's `src` is a data: URL, exactly as it
 * lives in the editor. On disk the server splits the pixels out to
 * content-hashed files under `assets/` and stores an `asset:<file>` ref in the
 * manifest instead — project.json never embeds base64.
 */

/** A saved layer — the editor's Layer minus transient state (status/progress). */
export interface ProjectLayer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number; // 0..1
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number; // degrees
  /** data: URL on the wire; `asset:<file>` ref inside the on-disk manifest. */
  src: string | null;
  /** The prompt that produced this layer — prefills Remix "from source". */
  prompt: string | null;
  /** Provenance for layers produced by an editor action. */
  derivedFrom: { id: string; name: string } | null;
}

export interface ProjectViewport {
  scale: number;
  x: number;
  y: number;
}

/** The session picks worth restoring: provider/model, output size, style. */
export interface ProjectSession {
  providerId: string;
  model: string | null;
  size: { w: number; h: number; label: string };
  styleId: string;
}

export interface ProjectDoc {
  version: 1;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** Z-order, index 0 = bottom — same convention as the document store. */
  layers: ProjectLayer[];
  viewport: ProjectViewport;
  session: ProjectSession;
}
