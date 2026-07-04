import { create } from "zustand";
import { streamGenerate } from "../api/generate";
import { useDocument } from "./documentStore";
import { useViewport } from "./viewportStore";

/** Fit a generated image to a friendly on-canvas display size (longest side). */
function displaySize(w: number, h: number, maxSide = 320) {
  const r = w / h;
  return r >= 1
    ? { dw: maxSide, dh: Math.round(maxSide / r) }
    : { dw: Math.round(maxSide * r), dh: maxSide };
}

let cascade = 0;

interface GenerationState {
  running: boolean;
  controller: AbortController | null;
  error: string | null;
  clearError: () => void;
  start: (opts: {
    providerId: string;
    model?: string;
    prompt: string;
    width: number;
    height: number;
  }) => Promise<void>;
  cancel: () => void;
}

export const useGeneration = create<GenerationState>((set, get) => ({
  running: false,
  controller: null,
  error: null,

  clearError: () => set({ error: null }),

  start: async ({ providerId, model, prompt, width, height }) => {
    if (get().running) return;

    const doc = useDocument.getState();
    const vp = useViewport.getState();
    const { dw, dh } = displaySize(width, height);

    // Drop the placeholder at the viewport center, cascading repeats slightly.
    const cx = (vp.stageW / 2 - vp.x) / vp.scale;
    const cy = (vp.stageH / 2 - vp.y) / vp.scale;
    cascade = (cascade + 1) % 6;

    const layerId = doc.addLayer({
      name: prompt.trim().slice(0, 28) || "Generation",
      x: cx - dw / 2 + cascade * 22,
      y: cy - dh / 2 + cascade * 22,
      width: dw,
      height: dh,
      src: null,
      status: "generating",
      progress: 0,
    });

    const controller = new AbortController();
    set({ running: true, controller, error: null });

    try {
      await streamGenerate(
        { providerId, model, prompt, width, height },
        {
          signal: controller.signal,
          onEvent: (e) => {
            const d = useDocument.getState();
            if (e.type === "progress") {
              d.updateLayer(layerId, { progress: e.pct });
            } else if (e.type === "done") {
              const img = e.result.images[0];
              d.updateLayer(layerId, {
                src: img?.dataUrl ?? null,
                status: "ready",
                progress: 100,
              });
            } else if (e.type === "error") {
              d.updateLayer(layerId, { status: "error" });
              set({ error: e.message });
            }
          },
        },
      );
    } catch (err) {
      const e = err as Error;
      if (e.name === "AbortError") {
        // Cancelled — drop the placeholder and return to idle.
        useDocument.getState().removeLayer(layerId);
      } else {
        useDocument.getState().updateLayer(layerId, { status: "error" });
        set({ error: e.message });
      }
    } finally {
      set({ running: false, controller: null });
    }
  },

  cancel: () => {
    get().controller?.abort();
  },
}));
