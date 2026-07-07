import { create } from "zustand";
import { record } from "./history";

export type LayerStatus = "ready" | "generating";

/**
 * A layer is plain serializable data — no Konva objects live here. The canvas
 * derives Konva nodes from this store, which keeps project save/load (Phase 2)
 * a straight JSON dump. Array order is z-order, index 0 = bottom.
 */
export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number; // 0..1
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number; // degrees
  src: string | null; // data: URL; null while generating
  status: LayerStatus;
  progress: number; // 0..100 while generating
  /** The prompt that produced this layer — prefills Remix "from source". */
  prompt: string | null;
  /** Set on layers produced by an editor action; source may be deleted later. */
  derivedFrom: { id: string; name: string } | null;
}

let counter = 0;

export function makeLayer(partial: Partial<Layer>): Layer {
  counter += 1;
  return {
    id: partial.id ?? crypto.randomUUID(),
    name: partial.name ?? `Layer ${counter}`,
    visible: partial.visible ?? true,
    opacity: partial.opacity ?? 1,
    x: partial.x ?? 0,
    y: partial.y ?? 0,
    width: partial.width ?? 320,
    height: partial.height ?? 320,
    rotation: partial.rotation ?? 0,
    src: partial.src ?? null,
    status: partial.status ?? "ready",
    progress: partial.progress ?? 0,
    prompt: partial.prompt ?? null,
    derivedFrom: partial.derivedFrom ?? null,
  };
}

/** Patches touching only these fields are generation plumbing (progress ticks,
 * the final src swap) — never history entries of their own. */
const TRANSIENT_KEYS = new Set(["status", "progress", "src"]);

interface DocumentState {
  layers: Layer[];
  selectedId: string | null;
  select: (id: string | null) => void;
  addLayer: (partial: Partial<Layer>) => string;
  /** Pass `history: false` for system adjustments (e.g. aspect-fit) that
   * shouldn't be undo steps. */
  updateLayer: (id: string, patch: Partial<Layer>, opts?: { history?: boolean }) => void;
  removeLayer: (id: string) => void;
  reorder: (fromId: string, toIndex: number) => void;
  raise: (id: string, dir: "up" | "down") => void;
}

export const useDocument = create<DocumentState>((set) => ({
  layers: [],
  selectedId: null,

  select: (id) => set({ selectedId: id }),

  addLayer: (partial) => {
    const layer = makeLayer(partial);
    // Recorded even for generation placeholders: that entry is the "before
    // generation" state, so one undo removes a finished generation as a unit.
    record();
    set((s) => ({ layers: [...s.layers, layer], selectedId: layer.id }));
    return layer.id;
  },

  updateLayer: (id, patch, opts) => {
    const keys = Object.keys(patch);
    if (opts?.history !== false && keys.some((k) => !TRANSIENT_KEYS.has(k)))
      record(`update:${id}:${keys.sort().join("+")}`);
    set((s) => ({
      layers: s.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    }));
  },

  removeLayer: (id) =>
    set((s) => {
      if (!s.layers.some((l) => l.id === id)) return s;
      record();
      const layers = s.layers.filter((l) => l.id !== id);
      return {
        layers,
        selectedId: s.selectedId === id ? (layers.at(-1)?.id ?? null) : s.selectedId,
      };
    }),

  reorder: (fromId, toIndex) =>
    set((s) => {
      const from = s.layers.findIndex((l) => l.id === fromId);
      if (from === -1) return s;
      record();
      const layers = [...s.layers];
      const [moved] = layers.splice(from, 1);
      if (!moved) return s;
      const clamped = Math.max(0, Math.min(layers.length, toIndex));
      layers.splice(clamped, 0, moved);
      return { layers };
    }),

  raise: (id, dir) =>
    set((s) => {
      const i = s.layers.findIndex((l) => l.id === id);
      if (i === -1) return s;
      const j = dir === "up" ? i + 1 : i - 1;
      if (j < 0 || j >= s.layers.length) return s;
      record();
      const layers = [...s.layers];
      const a = layers[i];
      const b = layers[j];
      if (!a || !b) return s;
      layers[i] = b;
      layers[j] = a;
      return { layers };
    }),
}));
