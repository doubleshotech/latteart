import type { ExportRequest, ExportResponse } from "./export.worker";
import type { Layer } from "../stores/documentStore";

/**
 * Main-thread client for the export worker — the same RPC shape as
 * `removeBackgroundAI` in front of the segmentation worker. The pipeline and
 * its PNG encoding live in `lib/export.worker`; this file ships the layer list
 * over and hands back the finished `Blob`.
 *
 * Deliberately no main-thread fallback: `exportOra` is still callable here by
 * construction, but a worker that can't start is exotic enough (module workers
 * exist everywhere this app runs) that surfacing the error beats silently
 * re-freezing the UI for twelve seconds.
 */

export type ExportProgress = (done: number, total: number) => void;

interface Pending {
  resolve: (blob: Blob | null) => void;
  reject: (reason: unknown) => void;
  onProgress?: ExportProgress;
}

const pending = new Map<number, Pending>();
let worker: Worker | null = null;
let nextId = 1;

function getWorker(): Worker {
  worker ??= createWorker();
  return worker;
}

function createWorker(): Worker {
  const w = new Worker(new URL("./export.worker.ts", import.meta.url), { type: "module" });
  w.addEventListener("message", (ev: MessageEvent<ExportResponse>) => {
    const msg = ev.data;
    if (msg.type === "progress") {
      pending.get(msg.id)?.onProgress?.(msg.done, msg.total);
      return;
    }
    const job = pending.get(msg.id);
    pending.delete(msg.id);
    if (!job) return;
    if (msg.type === "error") job.reject(new Error(msg.message));
    else job.resolve(msg.blob);
  });
  // A worker that fails to start (bad import, blocked module script) never
  // answers, so fail everything waiting and drop it — otherwise the export
  // promise hangs forever behind an "Exporting…" button that never releases.
  // The next call rebuilds.
  w.addEventListener("error", (ev: ErrorEvent) => {
    const err = new Error(ev.message || "export worker failed");
    for (const job of pending.values()) job.reject(err);
    pending.clear();
    // Guarded on identity: a late error from a worker we already replaced must
    // not terminate its successor.
    if (worker === w) worker = null;
    w.terminate();
  });
  return w;
}

function request(
  req: (id: number) => ExportRequest,
  onProgress?: ExportProgress,
): Promise<Blob | null> {
  const id = nextId++;
  return new Promise<Blob | null>((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    getWorker().postMessage(req(id));
  });
}

/** `lib/ora`'s exportOra, run in the worker. Null = nothing to export. */
export function exportOraOffThread(
  layers: Layer[],
  onProgress?: ExportProgress,
): Promise<Blob | null> {
  return request((id) => ({ type: "ora", id, layers }), onProgress);
}

/** The flattened PNG export, run in the worker. Null = nothing visible. */
export function exportPngOffThread(
  layers: Layer[],
  onProgress?: ExportProgress,
): Promise<Blob | null> {
  return request((id) => ({ type: "png", id, layers }), onProgress);
}
