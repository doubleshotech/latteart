import { flattenLayers } from "./flatten";
import { exportOra } from "./ora";
import { encodePngBlob } from "./raster";
import type { Layer } from "../stores/documentStore";

/**
 * The export worker: runs `exportOra` and the flattened PNG export off the main
 * thread. Both spend seconds PNG-encoding millions of pixels, and the encode is
 * synchronous once it starts — on the main thread it froze the canvas and every
 * animation for the duration (~12 s on a large document).
 *
 * The pipeline itself lives in `lib/ora` and `lib/flatten`, environment-neutral
 * through `lib/raster`; this file is only the message pump. A `Layer` is plain
 * serializable data by design (see documentStore), so the layer list crosses
 * `postMessage` as-is, and the result crosses back as a `Blob` — an immutable
 * handle, cheap to clone.
 *
 * Jobs are not queued: the export button allows one export at a time, and the
 * pipeline has no shared mutable state beyond `layerMask`'s stencil cache,
 * whose promise-keyed entries are safe to race.
 */

export type ExportRequest =
  | { type: "ora"; id: number; layers: Layer[] }
  | { type: "png"; id: number; layers: Layer[]; pixelRatio: number };

export type ExportResponse =
  /** Equal-weight pipeline steps — see `exportOra`'s onProgress. */
  | { type: "progress"; id: number; done: number; total: number }
  /** Null blob = nothing to export, mirroring the pipeline's own null. */
  | { type: "done"; id: number; blob: Blob | null }
  | { type: "error"; id: number; message: string };

/** `DedicatedWorkerGlobalScope` lives in lib.webworker, which this app's tsconfig
 * can't add without colliding with lib.dom — so type the two members we use. */
interface WorkerScope {
  postMessage(message: ExportResponse): void;
  addEventListener(type: "message", listener: (ev: MessageEvent<ExportRequest>) => void): void;
}
const ctx = self as unknown as WorkerScope;

function post(message: ExportResponse) {
  ctx.postMessage(message);
}

async function run(msg: ExportRequest): Promise<Blob | null> {
  if (msg.type === "ora") {
    return exportOra(msg.layers, (done, total) =>
      post({ type: "progress", id: msg.id, done, total }),
    );
  }
  const flat = await flattenLayers(msg.layers, { pixelRatio: msg.pixelRatio });
  return flat ? encodePngBlob(flat.canvas) : null;
}

ctx.addEventListener("message", (ev: MessageEvent<ExportRequest>) => {
  const msg = ev.data;
  run(msg).then(
    (blob) => post({ type: "done", id: msg.id, blob }),
    (err: unknown) =>
      post({ type: "error", id: msg.id, message: (err as Error).message || "export failed" }),
  );
});
