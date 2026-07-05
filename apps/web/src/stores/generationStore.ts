import { create } from "zustand";
import type { ProgressEvent } from "@latteart/shared";
import { streamEdit, streamGenerate } from "../api/generate";
import { flattenLayers } from "../lib/flatten";
import { useDocument } from "./documentStore";
import { useViewport } from "./viewportStore";

/** Fit a generated image to a friendly on-canvas display size (longest side). */
function displaySize(w: number, h: number, maxSide = 320) {
  const r = w / h;
  return r >= 1
    ? { dw: maxSide, dh: Math.round(maxSide / r) }
    : { dw: Math.round(maxSide * r), dh: maxSide };
}

/** Default instruction for AI Merge — harmonize the flattened canvas into one image. */
const MERGE_PROMPT =
  "Merge these overlapping elements into a single cohesive, naturally-lit image. " +
  "Preserve the overall composition and positions; blend the edges, lighting, and " +
  "style so it reads as one photograph.";

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
  merge: (opts: { providerId: string; model?: string; prompt?: string }) => Promise<void>;
  cancel: () => void;
}

export const useGeneration = create<GenerationState>((set, get) => {
  /**
   * Stream a job (generate or edit) into an already-created placeholder layer:
   * pipe progress, swap in the result on `done`, and on failure/cancel drop the
   * placeholder while restoring the user's prior selection.
   */
  const runStream = async (
    layerId: string,
    prevSelectedId: string | null,
    run: (handlers: { signal: AbortSignal; onEvent: (e: ProgressEvent) => void }) => Promise<void>,
  ) => {
    // Drop the placeholder and restore the prior selection — the placeholder is
    // auto-selected on add, so a failure/cancel shouldn't move the user's focus.
    const dropPlaceholder = () => {
      useDocument.getState().removeLayer(layerId);
      const d = useDocument.getState();
      const restore =
        prevSelectedId && d.layers.some((l) => l.id === prevSelectedId) ? prevSelectedId : null;
      d.select(restore);
    };

    const controller = new AbortController();
    set({ running: true, controller, error: null });

    try {
      await run({
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
            dropPlaceholder();
            set({ error: e.message });
          }
        },
      });
    } catch (err) {
      const e = err as Error;
      if (e.name === "AbortError") {
        // Cancelled — drop the placeholder and return to idle.
        dropPlaceholder();
      } else {
        // Failed (bad key, quota, refusal) — drop the placeholder, surface why.
        dropPlaceholder();
        set({ error: e.message });
      }
    } finally {
      set({ running: false, controller: null });
    }
  };

  return {
    running: false,
    controller: null,
    error: null,

    clearError: () => set({ error: null }),

    start: async ({ providerId, model, prompt, width, height }) => {
      if (get().running) return;

      const doc = useDocument.getState();
      const vp = useViewport.getState();
      const { dw, dh } = displaySize(width, height);
      const prevSelectedId = doc.selectedId;

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

      await runStream(layerId, prevSelectedId, ({ signal, onEvent }) =>
        streamGenerate({ providerId, model, prompt, width, height }, { signal, onEvent }),
      );
    },

    merge: async ({ providerId, model, prompt }) => {
      if (get().running) return;

      const doc = useDocument.getState();
      // Flatten the visible canvas to one composite, capped so the payload stays
      // reasonable, then hand it to the provider's img2img (Strategy B).
      const flat = await flattenLayers(doc.layers, { pixelRatio: 2, maxSide: 1536 });
      if (!flat) {
        set({ error: "Nothing to merge yet — generate a layer first." });
        return;
      }

      const prevSelectedId = doc.selectedId;

      // Placeholder overlays the exact composite bounds; the merged image lands on top.
      const layerId = doc.addLayer({
        name: "AI Merge",
        x: flat.box.x,
        y: flat.box.y,
        width: flat.box.width,
        height: flat.box.height,
        src: null,
        status: "generating",
        progress: 0,
      });

      await runStream(layerId, prevSelectedId, ({ signal, onEvent }) =>
        streamEdit(
          {
            providerId,
            model,
            prompt: prompt?.trim() || MERGE_PROMPT,
            image: flat.dataUrl,
            mode: "img2img",
          },
          { signal, onEvent },
        ),
      );
    },

    cancel: () => {
      get().controller?.abort();
    },
  };
});
