/**
 * Project persistence types shared by the web autosave client and the server's
 * on-disk project store.
 *
 * Wire vs disk: over the API a layer's `src` is a data: URL, exactly as it
 * lives in the editor. On disk the server splits the pixels out to
 * content-hashed files under `assets/` and stores an `asset:<file>` ref in the
 * manifest instead — project.json never embeds base64.
 */

import type { BlendMode } from "./blend.ts";

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
  /**
   * How this layer composites onto the layers below. Optional so projects
   * saved before blend modes existed still load — absent reads as "normal".
   */
  blendMode?: BlendMode;
  /**
   * Non-destructive alpha mask: a grayscale image where white reveals the
   * layer's pixels and black hides them. Pixels are pixels, so it follows the
   * same wire-vs-disk split as `src` — a data: URL over the API, an
   * `asset:<file>` ref on disk. Optional/nullable so projects saved before
   * masks existed still load (absent = unmasked).
   */
  mask?: string | null;
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
  /** "Cutout" toggle. Optional so projects saved before it still load. */
  isolate?: boolean;
  /** Chosen prompt-enhancement engine ("auto" | engine id). Optional/back-compat. */
  llmProviderId?: string;
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
  /**
   * A small flattened preview of the canvas, for the project switcher's list.
   * Composited client-side on save. Follows the same wire-vs-disk split as a
   * layer's `src`: a data: URL over the API, an `asset:<file>` ref on disk.
   * Optional — projects saved before thumbnails existed simply have none.
   */
  thumbnail?: string | null;
}

/**
 * A project as the switcher lists it — enough to render a row and open it,
 * without paying for every layer's pixels. `thumbnail` is rehydrated to a data:
 * URL (it's the only image the list needs).
 */
export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** Layer count, so the list can say "empty" without loading the document. */
  layerCount: number;
  thumbnail: string | null;
}
