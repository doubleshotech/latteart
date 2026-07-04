import { create } from "zustand";

const MIN = 0.1;
const MAX = 5;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * The infinite-canvas viewport: a single Konva Stage whose position + scale come
 * from here. Panning and zooming mutate only this store, so the layer panel
 * never re-renders on a canvas pan.
 */
interface ViewportState {
  scale: number;
  x: number;
  y: number;
  stageW: number;
  stageH: number;
  setView: (v: Partial<Pick<ViewportState, "scale" | "x" | "y">>) => void;
  setStageSize: (w: number, h: number) => void;
  /** Zoom by `factor` keeping the screen point (sx, sy) fixed under the cursor. */
  zoomAt: (factor: number, sx: number, sy: number) => void;
  setZoom: (scale: number) => void;
  panBy: (dx: number, dy: number) => void;
  reset: () => void;
}

export const useViewport = create<ViewportState>((set, get) => ({
  scale: 1,
  x: 0,
  y: 0,
  stageW: 0,
  stageH: 0,

  setView: (v) => set(v),
  setStageSize: (w, h) => set({ stageW: w, stageH: h }),

  zoomAt: (factor, sx, sy) => {
    const { scale, x, y } = get();
    const next = clamp(scale * factor, MIN, MAX);
    if (next === scale) return;
    set({
      scale: next,
      x: sx - (sx - x) * (next / scale),
      y: sy - (sy - y) * (next / scale),
    });
  },

  setZoom: (scale) => {
    const { scale: cur, x, y, stageW, stageH } = get();
    const next = clamp(scale, MIN, MAX);
    const sx = stageW / 2;
    const sy = stageH / 2;
    set({
      scale: next,
      x: sx - (sx - x) * (next / cur),
      y: sy - (sy - y) * (next / cur),
    });
  },

  panBy: (dx, dy) => set((s) => ({ x: s.x + dx, y: s.y + dy })),
  reset: () => set({ scale: 1, x: 0, y: 0 }),
}));
