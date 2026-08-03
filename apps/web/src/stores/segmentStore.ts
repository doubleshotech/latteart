import { create } from "zustand";
import { onSegmentLoad, type SegmentLoadPhase } from "../lib/removeBackgroundAI";

/**
 * UI mirror of the segmentation model's one-time load. The matte client owns the
 * state and pushes it here; this store only makes it renderable, so the
 * dependency runs stores → lib like every other store.
 */
export const useSegment = create<{ phase: SegmentLoadPhase; pct: number }>(() => ({
  phase: "idle",
  pct: 0,
}));

onSegmentLoad((phase, pct) => useSegment.setState({ phase, pct }));

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
