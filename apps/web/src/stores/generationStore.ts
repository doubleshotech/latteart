import { create } from "zustand";
import type { ProgressEvent } from "@latteart/shared";
import { ACTIONS, type ActionKind } from "../lib/actions";
import { streamEdit, streamGenerate } from "../api/generate";
import { flattenLayers } from "../lib/flatten";
import { useDocument } from "./documentStore";
import { useViewport } from "./viewportStore";

/** Re-exported for compat — the canonical definition lives in lib/actions. */
export type { ActionKind };

/** Fit a generated image to a friendly on-canvas display size (longest side). */
function displaySize(w: number, h: number, maxSide = 320) {
  const r = w / h;
  return r >= 1
    ? { dw: maxSide, dh: Math.round(maxSide / r) }
    : { dw: Math.round(maxSide * r), dh: maxSide };
}

/** Scale a layer's display dims up to generation pixels, preserving aspect. */
function requestSize(w: number, h: number, maxSide = 1024) {
  const r = w / h;
  return r >= 1
    ? { rw: maxSide, rh: Math.round(maxSide / r) }
    : { rw: Math.round(maxSide * r), rh: maxSide };
}

/** Default instruction for AI Merge — harmonize the flattened canvas into one image. */
const MERGE_PROMPT =
  "Merge these overlapping elements into a single cohesive, naturally-lit image. " +
  "Preserve the overall composition and positions; blend the edges, lighting, and " +
  "style so it reads as one photograph.";

/** Live metadata for the progress toast and the on-canvas working overlay. */
export interface RunningAction {
  kind: ActionKind;
  sourceId: string;
  sourceName: string;
  /** The result placeholder layer this job streams into — anchors progress UI. */
  placeholderId: string;
  /** Mono subline for the toast, e.g. "img2img · Gemini · quite similar". */
  detail: string;
  /** "2/4" style counter while variations run sequentially. */
  count: number;
  index: number;
}

let cascade = 0;

interface GenerationState {
  running: boolean;
  controller: AbortController | null;
  action: RunningAction | null;
  error: string | null;
  clearError: () => void;
  start: (opts: {
    providerId: string;
    model?: string;
    prompt: string;
    styleId?: string;
    width: number;
    height: number;
  }) => Promise<void>;
  merge: (opts: { providerId: string; model?: string; prompt?: string }) => Promise<void>;
  runAction: (opts: {
    providerId: string;
    model?: string;
    kind: ActionKind;
    sourceId: string;
    /** Remix / change-bg / edit-area user prompt; ignored for remove-bg and variations. */
    prompt?: string;
    /** Remix style override; the /api/edit route composes it server-side. */
    styleId?: string;
    /** img2img similarity → denoising strength, 0..1. */
    strength?: number;
    /** Inpaint mask (white = regenerate) as a data: URL — edit-area only. */
    mask?: string;
    /** Toast subline, e.g. "img2img · Gemini · quite similar". */
    detail?: string;
    count?: number;
  }) => Promise<void>;
  cancel: () => void;
}

export const useGeneration = create<GenerationState>((set, get) => {
  /**
   * Stream a job (generate or edit) into an already-created placeholder layer:
   * pipe progress, swap in the result on `done`, and on failure/cancel drop the
   * placeholder while restoring the user's prior selection. A caller running a
   * multi-job action passes its own controller so cancel spans the whole run.
   */
  const runStream = async (
    layerId: string,
    prevSelectedId: string | null,
    run: (handlers: { signal: AbortSignal; onEvent: (e: ProgressEvent) => void }) => Promise<void>,
    controller: AbortController = new AbortController(),
  ) => {
    // Drop the placeholder and restore the prior selection — the placeholder is
    // auto-selected on add, so a failure/cancel shouldn't move the user's focus.
    // removeLayer only reassigns selection when the removed layer was selected;
    // if the user has since selected something else, leave their focus alone.
    const dropPlaceholder = () => {
      const wasSelected = useDocument.getState().selectedId === layerId;
      useDocument.getState().removeLayer(layerId);
      if (!wasSelected) return;
      const d = useDocument.getState();
      const restore =
        prevSelectedId && d.layers.some((l) => l.id === prevSelectedId) ? prevSelectedId : null;
      d.select(restore);
    };

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
    action: null,
    error: null,

    clearError: () => set({ error: null }),

    start: async ({ providerId, model, prompt, styleId, width, height }) => {
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
        prompt: prompt.trim(),
      });

      await runStream(layerId, prevSelectedId, ({ signal, onEvent }) =>
        streamGenerate({ providerId, model, prompt, styleId, width, height }, { signal, onEvent }),
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
      // flattenLayers awaited above — a click could have started another job in
      // that window, so re-check before claiming the running slot.
      if (get().running) return;

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

    runAction: async ({
      providerId,
      model,
      kind,
      sourceId,
      prompt,
      styleId,
      strength,
      mask,
      detail,
      count = 1,
    }) => {
      if (get().running) return;

      const doc = useDocument.getState();
      const source = doc.layers.find((l) => l.id === sourceId);
      if (!source?.src) {
        set({ error: "Select a finished layer first." });
        return;
      }

      const userPrompt = prompt?.trim() ?? "";
      // The style override rides along as styleId; the /api/edit route composes
      // it into the prompt server-side (same as /api/generate), so send raw.
      const editPrompt = ACTIONS[kind].prompt(userPrompt);
      // Content never mutates, so the img2img payload stays the original source.
      const image = source.src;

      const prevSelectedId = doc.selectedId;
      // One controller for the whole action so cancel stops the remaining jobs.
      const controller = new AbortController();
      const jobs = Math.max(1, Math.min(4, count));

      try {
        for (let i = 0; i < jobs; i++) {
          if (controller.signal.aborted) break;

          // Re-resolve the live source each iteration — the user may rename or
          // move it between jobs (its pixels never change), or delete it.
          const live = useDocument.getState().layers.find((l) => l.id === sourceId);
          if (!live) break;

          // The result lands as a new layer offset above the source (screen 5).
          // Create it first so the action can anchor its progress UI on it.
          const editArea = kind === "edit-area";
          const layerId = doc.addLayer(
            {
              name: ACTIONS[kind].layerName(live.name, i, jobs),
              // Edit-area (inpaint) returns a full image whose unedited regions
              // must line up with the source, so overlay it exactly in place;
              // other actions offset the result above the source.
              x: live.x + (editArea ? 0 : 46 + i * 22),
              y: live.y + (editArea ? 0 : -36 + i * 22),
              width: live.width,
              height: live.height,
              src: null,
              status: "generating",
              progress: 0,
              prompt: kind === "variations" ? live.prompt : userPrompt || live.prompt,
              derivedFrom: { id: live.id, name: live.name },
            },
            // A multi-job run (variations) is one undo unit: only the first
            // placeholder records the pre-run snapshot; the rest add silently.
            { history: i === 0 },
          );

          set({
            action: {
              kind,
              sourceId: live.id,
              sourceName: live.name,
              placeholderId: layerId,
              detail: detail ?? "img2img",
              count: jobs,
              index: i,
            },
          });

          // Layer dims are display size (~320); scale up to generation pixels.
          const { rw, rh } = requestSize(live.width, live.height);

          await runStream(
            layerId,
            prevSelectedId,
            ({ signal, onEvent }) =>
              streamEdit(
                {
                  providerId,
                  model,
                  prompt: editPrompt,
                  styleId: kind === "remix" ? styleId : undefined,
                  image,
                  mode: kind === "edit-area" ? "inpaint" : "img2img",
                  // Mask rides along only for inpaint; matches the source's pixels.
                  mask: kind === "edit-area" ? mask : undefined,
                  strength,
                  width: rw,
                  height: rh,
                  // Distinct seed per variation so mock output actually differs.
                  seed:
                    kind === "variations" ? Math.floor(Math.random() * 1_000_000) + i : undefined,
                },
                { signal, onEvent },
              ),
            controller,
          );

          // A provider failure surfaces an error and drops the placeholder;
          // don't keep hammering the same provider for the remaining jobs.
          if (get().error) break;
        }
      } finally {
        set({ action: null });
      }
    },

    cancel: () => {
      get().controller?.abort();
    },
  };
});
