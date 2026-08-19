import { create } from "zustand";
import type { Box } from "../lib/bounds";

const MIN = 0.1;
const MAX = 5;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * The breathing room {@link ViewportState.fitTo} leaves around the content, in
 * screen pixels — on top of whatever the floating chrome already claims.
 */
const FIT_MARGIN = 40;

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
  /**
   * How much of the stage's bottom edge the floating chrome covers, reported by
   * that chrome itself (the prompt bar, which grows by the queue strip while a
   * job runs). Measured rather than hard-coded: a constant here would be tuned
   * to one state of a component in another file and silently wrong in the rest.
   */
  chromeBottom: number;
  setView: (v: Partial<Pick<ViewportState, "scale" | "x" | "y">>) => void;
  setStageSize: (w: number, h: number) => void;
  setChromeBottom: (px: number) => void;
  /** Zoom by `factor` keeping the screen point (sx, sy) fixed under the cursor. */
  zoomAt: (factor: number, sx: number, sy: number) => void;
  setZoom: (scale: number) => void;
  panBy: (dx: number, dy: number) => void;
  /**
   * Frame `box` (canvas coordinates) in the part of the stage the user can
   * actually see: scale it to fit inside {@link FIT_MARGIN} and
   * {@link ViewportState.chromeBottom}, then centre it there. The caller
   * measures the box, so this store keeps knowing nothing about layers.
   */
  fitTo: (box: Box) => void;
  reset: () => void;
}

export const useViewport = create<ViewportState>((set, get) => ({
  scale: 1,
  x: 0,
  y: 0,
  stageW: 0,
  stageH: 0,
  chromeBottom: 0,

  setView: (v) => set(v),
  setStageSize: (w, h) => set({ stageW: w, stageH: h }),
  setChromeBottom: (px) => set({ chromeBottom: px }),

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

  fitTo: (box) => {
    const { stageW, stageH, chromeBottom } = get();
    if (!stageW || !stageH) return; // not measured yet

    // A window too small to hold the padding gets none of it, rather than a
    // negative viewport that would fit nothing at all.
    const wantB = FIT_MARGIN + chromeBottom;
    const [padL, padR] = stageW > FIT_MARGIN * 2 ? [FIT_MARGIN, FIT_MARGIN] : [0, 0];
    const [padT, padB] = stageH > FIT_MARGIN + wantB ? [FIT_MARGIN, wantB] : [0, 0];
    const availW = stageW - padL - padR;
    const availH = stageH - padT - padB;

    // A zero-area box has no scale that frames it (both ratios are Infinity).
    const ratio = Math.min(availW / box.width, availH / box.height);
    if (!Number.isFinite(ratio) || ratio <= 0) return;

    // Clamped like every other zoom: content far larger or smaller than the
    // stage lands at the zoom limit and simply overflows or sits small.
    const next = clamp(ratio, MIN, MAX);
    set({
      scale: next,
      x: padL + (availW - box.width * next) / 2 - box.x * next,
      y: padT + (availH - box.height * next) / 2 - box.y * next,
    });
  },

  reset: () => set({ scale: 1, x: 0, y: 0 }),
}));
