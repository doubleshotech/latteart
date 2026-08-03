import { create } from "zustand";
import type { SegmentDevice } from "../lib/segment.worker";

/**
 * How far the one-time segmentation-model load has got. RMBG is downloaded from
 * HF on first use (44 MB on WASM, 88 MB on WebGPU) and browser-cached after, so
 * this only ever describes the first matte of a session — every later one goes
 * straight to work with `phase` at "idle".
 */
export type SegmentPhase = "idle" | "downloading" | "preparing";

interface SegmentState {
  phase: SegmentPhase;
  /** 0…100, meaningful only while `phase` is "downloading". */
  pct: number;
  /** Which backend the model actually loaded on, once known. */
  device: SegmentDevice | null;
  setLoading: (pct: number) => void;
  setPreparing: () => void;
  setReady: (device: SegmentDevice) => void;
  setIdle: () => void;
}

export const useSegment = create<SegmentState>((set) => ({
  phase: "idle",
  pct: 0,
  device: null,
  // A warm cache reports every file at 100% in one go, so treat a finished
  // download as "preparing" rather than flashing a full bar.
  setLoading: (pct) => set({ phase: pct >= 100 ? "preparing" : "downloading", pct }),
  setPreparing: () => set({ phase: "preparing" }),
  setReady: (device) => set({ phase: "idle", pct: 0, device }),
  setIdle: () => set({ phase: "idle", pct: 0 }),
}));

/**
 * The status line every matte surface shows while the model loads, or null once
 * the model is resident — callers then fall back to their own working copy
 * ("Separating the subject…", "Preparing mask…", the action's own detail).
 */
export function useSegmentLabel(): string | null {
  return useSegment((s) =>
    s.phase === "downloading"
      ? `Downloading model · ${s.pct}%`
      : s.phase === "preparing"
        ? "Preparing model…"
        : null,
  );
}
