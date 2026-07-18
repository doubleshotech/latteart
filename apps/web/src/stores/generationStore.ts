import { create } from "zustand";
import type { ProgressEvent } from "@latteart/shared";
import { ACTIONS, isInpaintKind, type ActionKind } from "../lib/actions";
import { streamEdit, streamGenerate } from "../api/generate";
import { flattenLayers } from "../lib/flatten";
import { keyFlatBackground } from "../lib/keyFlatBackground";
import { removeBackgroundAI } from "../lib/removeBackgroundAI";
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

/** Appended to a generation when "Cutout" is on: steer the model toward a flat,
 * shadow-free subject that the auto-removal step below can key out cleanly. */
const ISOLATE_INSTRUCTION =
  "Place the subject on a completely flat, uniform, single solid-color background — " +
  "no gradient, no floor or surface, no cast shadow, no scenery or props (this makes " +
  "the background trivial to remove). Fit the entire subject within the frame with " +
  "comfortable margin on every side; do not crop or cut off any part of it.";

/**
 * Remove the background locally: an in-browser segmentation matte, falling back
 * to flat-color keying. Honors `signal` (throws AbortError) so a cancel discards
 * the result instead of applying a cut-out the user cancelled. Returns null when
 * neither method finds a subject to isolate. The WASM matte can't be interrupted
 * mid-step, so cancellation takes effect at the next checkpoint.
 */
async function removeBackgroundLocal(image: string, signal: AbortSignal): Promise<string | null> {
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  let cut: string | null;
  try {
    cut = await removeBackgroundAI(image, signal);
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    // Segmentation unavailable (e.g. the model failed to load) — try flat keying.
    cut = await keyFlatBackground(image);
  }
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  return cut;
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

/** A submitted job waiting its turn (or executing). Jobs run one at a time in
 * submission order — local diffusion is serial anyway — so the UI keeps
 * accepting new work while a slow generation streams. */
export interface QueuedJob {
  id: string;
  /** What produced the job — picks the chip icon in the queue strip. */
  kind: ActionKind | "generate" | "merge";
  /** Short human label for the queue strip, e.g. the prompt or "Remix · Cat". */
  label: string;
  run: () => Promise<void>;
}

let cascade = 0;

interface StartOpts {
  providerId: string;
  model?: string;
  prompt: string;
  styleId?: string;
  width: number;
  height: number;
  /** Generate the subject on a flat background, then auto-remove it so the
   * layer lands transparent and composes cleanly (the "Cutout" toggle). */
  isolate?: boolean;
}

interface MergeOpts {
  providerId: string;
  model?: string;
  prompt?: string;
}

interface RunActionOpts {
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
}

interface GenerationState {
  /** A job is executing — covers its whole span (flatten preamble, the
   * multi-variation loop, the stream, auto-cutout), not just the live stream,
   * and is what gates undo/redo. Waiting jobs don't set it. */
  busy: boolean;
  /** Jobs waiting their turn; the executing job is `current`, not in here. */
  queue: QueuedJob[];
  current: QueuedJob | null;
  controller: AbortController | null;
  action: RunningAction | null;
  error: string | null;
  clearError: () => void;
  /** Surface a one-off error in the toast (e.g. a prompt-enhance failure). */
  setError: (message: string) => void;
  /** Each of these enqueues; the job runs immediately when nothing else is. */
  start: (opts: StartOpts) => void;
  merge: (opts: MergeOpts) => void;
  runAction: (opts: RunActionOpts) => void;
  /** Remove a waiting job (queue-chip ✕). No effect on the executing job. */
  dequeue: (id: string) => void;
  /** Drop every waiting job; the executing one keeps running. */
  clearQueue: () => void;
  /** Abort the executing job; the queue advances to the next one. */
  cancel: () => void;
}

export const useGeneration = create<GenerationState>((set, get) => {
  /**
   * Run the next waiting job if nothing is executing. The check-and-claim is
   * synchronous, so two rapid submits can't both start; each job's completion
   * (success, failure, or cancel) pulls the next one.
   */
  const pump = () => {
    if (get().busy) return;
    const next = get().queue[0];
    if (!next) return;
    set((s) => ({ queue: s.queue.slice(1), busy: true, current: next }));
    next
      .run()
      // Jobs surface their own errors; this backstop keeps an unexpected throw
      // from becoming an unhandled rejection that would wedge the queue.
      .catch((err) => console.error("Queued job failed:", err))
      .finally(() => {
        set({ busy: false, current: null });
        pump();
      });
  };

  const enqueue = (job: Omit<QueuedJob, "id">) => {
    // A fresh submission clears a lingering failure toast (the queue advancing
    // on its own does not — an unattended error must stay visible).
    set((s) => ({ queue: [...s.queue, { ...job, id: crypto.randomUUID() }], error: null }));
    pump();
  };

  /**
   * Stream a job (generate or edit) into an already-created placeholder layer:
   * pipe progress, swap in the result on `done`, and on failure/cancel drop the
   * placeholder while restoring the user's prior selection. A caller running a
   * multi-job action passes its own controller so cancel spans the whole run.
   * Returns this stream's own outcome — callers must not infer it from the
   * global `error`, which may still hold a previous queued job's failure.
   */
  const runStream = async (
    layerId: string,
    prevSelectedId: string | null,
    run: (handlers: { signal: AbortSignal; onEvent: (e: ProgressEvent) => void }) => Promise<void>,
    controller?: AbortController,
  ): Promise<"ok" | "failed" | "aborted"> => {
    // A multi-job action supplies its own controller and owns state.controller
    // for the whole run (so Cancel spans every variation, not just one stream);
    // a single-stream job lets runStream own that lifecycle.
    const ctrl = controller ?? new AbortController();
    const ownsController = controller === undefined;

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

    if (ownsController) set({ controller: ctrl });
    let outcome: "ok" | "failed" | "aborted" = "ok";

    try {
      await run({
        signal: ctrl.signal,
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
            // A successful result clears a stale failure toast from an earlier
            // queued job (a failure with nothing succeeding after it stays up).
            set({ error: null });
          } else if (e.type === "error") {
            // The stream itself closes cleanly after an error event, so mark
            // the failure here for the return value.
            outcome = "failed";
            dropPlaceholder();
            set({ error: e.message });
          }
        },
      });
    } catch (err) {
      const e = err as Error;
      if (e.name === "AbortError") {
        // Cancelled — drop the placeholder and return to idle.
        outcome = "aborted";
        dropPlaceholder();
      } else {
        // Failed (bad key, quota, refusal) — drop the placeholder, surface why.
        outcome = "failed";
        dropPlaceholder();
        set({ error: e.message });
      }
    } finally {
      if (ownsController) set({ controller: null });
    }
    return outcome;
  };

  /**
   * Second phase of an isolated generation: strip the background off the
   * just-generated layer, in place, via the local matte (AI segmentation, then
   * flat-color keying). Runs under a working scrim over the subject; on success
   * the `src` swaps to the transparent cut-out. A failure or cancel keeps the
   * opaque generation — still a usable result — rather than dropping the layer.
   */
  const autoCutout = async (layerId: string, image: string) => {
    const layer = useDocument.getState().layers.find((l) => l.id === layerId);
    if (!layer) return;

    const controller = new AbortController();
    set({
      controller,
      // Anchor the on-canvas working ring + toast on the layer itself; the ring
      // reads placeholder.progress, so placeholderId === the layer being cut out.
      action: {
        kind: "remove-bg",
        sourceId: layerId,
        sourceName: layer.name,
        placeholderId: layerId,
        detail: "isolate · removing background",
        count: 1,
        index: 0,
      },
    });
    useDocument.getState().updateLayer(layerId, { progress: 0 }, { history: false });

    try {
      const cut = await removeBackgroundLocal(image, controller.signal);
      const d = useDocument.getState();
      if (cut) {
        // In-place swap: same layer, now transparent. Kept out of history so one
        // undo removes the whole isolated generation as a unit.
        d.updateLayer(layerId, { src: cut, progress: 100 }, { history: false });
      } else {
        d.updateLayer(layerId, { progress: 100 }, { history: false });
        set({ error: "Couldn't isolate the subject — kept the original." });
      }
    } catch (err) {
      // Cancelled or the matte errored — keep the opaque generation as-is.
      useDocument.getState().updateLayer(layerId, { progress: 100 }, { history: false });
      if ((err as Error).name !== "AbortError") set({ error: (err as Error).message });
    } finally {
      set({ controller: null, action: null });
    }
  };

  /**
   * A runStream "job" that removes the background locally instead of via a
   * provider: try the in-browser segmentation matte, then flat-color keying.
   * Emits one progress tick and a done event carrying the cut-out, so it reuses
   * runStream's placeholder/error/selection handling unchanged.
   */
  const localMatteJob = async (
    image: string,
    signal: AbortSignal,
    onEvent: (e: ProgressEvent) => void,
  ) => {
    onEvent({ type: "progress", jobId: "local-matte", pct: 12 });
    const cut = await removeBackgroundLocal(image, signal);
    if (!cut) throw new Error("Couldn't remove the background — no clear subject found.");
    onEvent({
      type: "done",
      jobId: "local-matte",
      result: {
        id: "local-matte",
        images: [{ dataUrl: cut, width: 0, height: 0, transparent: true }],
        provider: "local",
        createdAt: 0,
      },
    });
  };

  const doStart = async ({
    providerId,
    model,
    prompt,
    styleId,
    width,
    height,
    isolate,
  }: StartOpts) => {
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

    // The isolate hint rides only on the request — layer.prompt/name keep the
    // user's words so Remix "from source" isn't polluted with boilerplate.
    const genPrompt = isolate ? `${prompt.trim()}. ${ISOLATE_INSTRUCTION}` : prompt;

    const outcome = await runStream(layerId, prevSelectedId, ({ signal, onEvent }) =>
      streamGenerate(
        { providerId, model, prompt: genPrompt, styleId, width, height },
        { signal, onEvent },
      ),
    );

    // Chain the background removal only if the generation actually survived
    // (not dropped by cancel, not failed).
    if (!isolate || outcome !== "ok") return;
    const generated = useDocument.getState().layers.find((l) => l.id === layerId);
    if (!generated?.src) return;
    await autoCutout(layerId, generated.src);
  };

  const doMerge = async ({ providerId, model, prompt }: MergeOpts) => {
    const doc = useDocument.getState();
    // Flatten the visible canvas to one composite, capped so the payload stays
    // reasonable, then hand it to the provider's img2img (Strategy B). A queued
    // merge flattens when its turn comes, so it includes layers generated by
    // the jobs queued ahead of it.
    let flat: Awaited<ReturnType<typeof flattenLayers>>;
    try {
      flat = await flattenLayers(doc.layers, { pixelRatio: 2, maxSide: 1536 });
    } catch (err) {
      // Surface it — otherwise the rejection is a silent unhandled rejection at
      // the pump, and the merge just vanishes with no feedback.
      set({ error: (err as Error).message || "Couldn't flatten the canvas to merge." });
      return;
    }
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
  };

  const doRunAction = async ({
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
  }: RunActionOpts) => {
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
    // Hold it in state for the run's full span (runStream leaves a caller's
    // controller alone) so Cancel also works in the gap between variations.
    const controller = new AbortController();
    set({ controller });
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
        const inpaint = isInpaintKind(kind);
        const layerId = doc.addLayer(
          {
            name: ACTIONS[kind].layerName(live.name, i, jobs),
            // Inpaint (edit-area / smart-edit) returns a full image whose
            // unedited regions must line up with the source, so overlay it
            // exactly in place; other actions offset the result above the source.
            x: live.x + (inpaint ? 0 : 46 + i * 22),
            y: live.y + (inpaint ? 0 : -36 + i * 22),
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

        const outcome = await runStream(
          layerId,
          prevSelectedId,
          // Remove background runs a local segmentation matte (any provider,
          // any background); the rest go through the provider's edit endpoint.
          kind === "remove-bg"
            ? ({ signal, onEvent }) => localMatteJob(image, signal, onEvent)
            : ({ signal, onEvent }) =>
                streamEdit(
                  {
                    providerId,
                    model,
                    prompt: editPrompt,
                    styleId: kind === "remix" ? styleId : undefined,
                    image,
                    mode: inpaint ? "inpaint" : "img2img",
                    // Mask rides along only for inpaint; matches the source's pixels.
                    mask: inpaint ? mask : undefined,
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
        // (Abort is also caught by the signal check at the top of the loop.)
        if (outcome !== "ok") break;
      }
    } finally {
      set({ controller: null, action: null });
    }
  };

  return {
    busy: false,
    queue: [],
    current: null,
    controller: null,
    action: null,
    error: null,

    clearError: () => set({ error: null }),
    setError: (message) => set({ error: message }),

    start: (opts) => {
      enqueue({
        kind: "generate",
        label: opts.prompt.trim().slice(0, 48) || "Generation",
        run: () => doStart(opts),
      });
    },

    merge: (opts) => {
      enqueue({ kind: "merge", label: "AI Merge", run: () => doMerge(opts) });
    },

    runAction: (opts) => {
      // The label resolves the source now (for the queue chip); the job itself
      // re-resolves at run time and errors cleanly if the layer is gone by then.
      const source = useDocument.getState().layers.find((l) => l.id === opts.sourceId);
      enqueue({
        kind: opts.kind,
        label: source ? `${ACTIONS[opts.kind].label} · ${source.name}` : ACTIONS[opts.kind].label,
        run: () => doRunAction(opts),
      });
    },

    dequeue: (id) => set((s) => ({ queue: s.queue.filter((j) => j.id !== id) })),

    clearQueue: () => set({ queue: [] }),

    cancel: () => {
      get().controller?.abort();
    },
  };
});
