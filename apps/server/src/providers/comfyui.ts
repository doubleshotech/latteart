import { noCapabilities } from "@latteart/shared";
import type {
  EditRequest,
  GenResult,
  GenerateRequest,
  GeneratedImage,
  ImageProvider,
  ModelInfo,
  ProviderContext,
} from "@latteart/shared";

/**
 * ComfyUI — local diffusion (Stable Diffusion / SDXL / FLUX) over ComfyUI's
 * HTTP + WebSocket API. This is the provider the SSE plumbing was built to
 * showcase: real per-step progress, streamed from the sampler to the canvas.
 *
 * v1 drives two fixed graphs (txt2img and img2img) against any single-file
 * checkpoint in the user's `models/checkpoints/`. "Models" in the picker are
 * the installed checkpoints, listed live from the instance. Custom user
 * workflows are a later feature.
 */

const DEFAULT_STEPS = 20;
const DEFAULT_CFG = 7;
const PROBE_TIMEOUT_MS = 800;
const CONNECT_TIMEOUT_MS = 4000;

/** Few-step distilled checkpoints (Turbo/Lightning/Hyper/schnell) need very
 * low step counts and cfg ≈ 1 — classic defaults burn their output. Detected
 * from the filename, which is how the community names them. */
function samplerDefaults(ckpt: string): { steps: number; cfg: number } {
  return /turbo|lightning|hyper|schnell|lcm/i.test(ckpt)
    ? { steps: 4, cfg: 1 }
    : { steps: DEFAULT_STEPS, cfg: DEFAULT_CFG };
}

/** Latent sizes must be multiples of 8. */
const snap8 = (v: number) => Math.max(64, Math.round(v / 8) * 8);

const randomSeed = () => Math.floor(Math.random() * 0xffff_ffff);

function unreachable(baseUrl: string): Error {
  return new Error(`ComfyUI isn't reachable at ${baseUrl} — is it running?`);
}

/** Strip the extension for a friendlier picker label. */
function checkpointLabel(file: string): string {
  return file.replace(/\.(safetensors|ckpt|gguf|sft)$/i, "");
}

/**
 * List installed checkpoints, or null when the instance is unreachable. Used
 * by `/api/providers` to publish live models (and availability) — bounded by
 * a short timeout so a stopped ComfyUI never stalls the providers list.
 */
export async function listComfyCheckpoints(baseUrl: string): Promise<ModelInfo[] | null> {
  try {
    const res = await fetch(`${baseUrl}/object_info/CheckpointLoaderSimple`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      CheckpointLoaderSimple?: { input?: { required?: { ckpt_name?: [string[]] } } };
    };
    const names = data.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] ?? [];
    return names.map((id) => ({ id, label: checkpointLabel(id) }));
  } catch {
    return null;
  }
}

/** Resolve the checkpoint to run: the requested one if installed, else the
 * first installed one (sessions can carry a since-deleted checkpoint name). */
async function resolveCheckpoint(baseUrl: string, requested?: string): Promise<string> {
  const models = await listComfyCheckpoints(baseUrl);
  if (models === null) throw unreachable(baseUrl);
  if (models.length === 0)
    throw new Error("ComfyUI has no checkpoints installed — add one to models/checkpoints");
  const match = models.find((m) => m.id === requested);
  return match?.id ?? models[0]!.id;
}

/** Nodes shared by both graphs: checkpoint, positive/negative prompts, save. */
function baseGraph(ckpt: string, prompt: string, negative: string) {
  return {
    ckpt: { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: ckpt } },
    pos: { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["ckpt", 1] } },
    neg: { class_type: "CLIPTextEncode", inputs: { text: negative, clip: ["ckpt", 1] } },
    decode: { class_type: "VAEDecode", inputs: { samples: ["sampler", 0], vae: ["ckpt", 2] } },
    save: {
      class_type: "SaveImage",
      inputs: { images: ["decode", 0], filename_prefix: "latteart" },
    },
  };
}

function sampler(o: {
  seed: number;
  steps: number;
  cfg: number;
  denoise: number;
  latentFrom: string;
}) {
  return {
    class_type: "KSampler",
    inputs: {
      seed: o.seed,
      steps: o.steps,
      cfg: o.cfg,
      sampler_name: "euler",
      scheduler: "normal",
      denoise: o.denoise,
      model: ["ckpt", 0],
      positive: ["pos", 0],
      negative: ["neg", 0],
      latent_image: [o.latentFrom, 0],
    },
  };
}

/** Upload a data-URL image into ComfyUI's input folder under `filename`;
 * returns the name a LoadImage node can reference. Source and mask must use
 * distinct filenames — a shared name + overwrite would clobber one. */
async function uploadImage(
  baseUrl: string,
  dataUrl: string,
  filename: string,
  signal?: AbortSignal,
): Promise<string> {
  const m = /^data:(.*?);base64,(.*)$/s.exec(dataUrl);
  if (!m) throw new Error("ComfyUI edit expected a base64 data URL");
  const bytes = Uint8Array.from(Buffer.from(m[2]!, "base64"));

  const form = new FormData();
  form.append("image", new Blob([bytes], { type: m[1] || "image/png" }), filename);
  form.append("overwrite", "true");

  const res = await fetch(`${baseUrl}/upload/image`, { method: "POST", body: form, signal });
  if (!res.ok) throw new Error(`ComfyUI rejected an image upload (${res.status})`);
  const out = (await res.json()) as { name: string; subfolder?: string };
  return out.subfolder ? `${out.subfolder}/${out.name}` : out.name;
}

/** Open the progress WebSocket, resolving once connected. */
function openSocket(baseUrl: string, clientId: string): Promise<WebSocket> {
  const wsUrl = `${baseUrl.replace(/^http/, "ws")}/ws?clientId=${clientId}`;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      ws.close();
      reject(unreachable(baseUrl));
    }, CONNECT_TIMEOUT_MS);
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve(ws);
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(unreachable(baseUrl));
    });
  });
}

/** Fetch a finished output image and wrap it as a data URL. */
async function fetchOutput(
  baseUrl: string,
  img: { filename: string; subfolder: string; type: string },
  signal?: AbortSignal,
): Promise<string> {
  const q = new URLSearchParams({
    filename: img.filename,
    subfolder: img.subfolder,
    type: img.type,
  });
  const res = await fetch(`${baseUrl}/view?${q.toString()}`, { signal });
  if (!res.ok) throw new Error(`ComfyUI output image fetch failed (${res.status})`);
  const mime = res.headers.get("content-type") ?? "image/png";
  const b64 = Buffer.from(await res.arrayBuffer()).toString("base64");
  return `data:${mime};base64,${b64}`;
}

/**
 * Queue a graph and stream its execution: progress events flow to
 * `ctx.onProgress`, abort interrupts the run, and the finished images are read
 * back from history. Returns the output images as data URLs.
 */
async function runGraph(
  baseUrl: string,
  graph: Record<string, unknown>,
  ctx: ProviderContext,
  signal?: AbortSignal,
): Promise<string[]> {
  const clientId = crypto.randomUUID();
  const ws = await openSocket(baseUrl, clientId);

  try {
    const queued = await fetch(`${baseUrl}/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: graph, client_id: clientId }),
      signal,
    }).catch(() => {
      throw unreachable(baseUrl);
    });
    if (!queued.ok) {
      let message = `ComfyUI rejected the workflow (${queued.status})`;
      try {
        const err = (await queued.json()) as {
          error?: { message?: string };
          node_errors?: Record<string, { errors?: { message?: string }[] }>;
        };
        const nodeError = Object.values(err.node_errors ?? {})[0]?.errors?.[0]?.message;
        message = nodeError ?? err.error?.message ?? message;
      } catch {
        /* keep the status-code message */
      }
      throw new Error(message);
    }
    const { prompt_id: promptId } = (await queued.json()) as { prompt_id: string };

    // Wait for completion, forwarding sampler steps as progress. Cancel =
    // interrupt the executing job and drop it from the queue.
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        void fetch(`${baseUrl}/interrupt`, { method: "POST" }).catch(() => {});
        void fetch(`${baseUrl}/queue`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ delete: [promptId] }),
        }).catch(() => {});
        const err = new Error("canceled");
        err.name = "AbortError";
        reject(err);
      };
      if (signal?.aborted) return onAbort();
      signal?.addEventListener("abort", onAbort, { once: true });

      ws.addEventListener("message", (event) => {
        if (typeof event.data !== "string") return; // binary preview frames — later
        let msg: { type: string; data?: Record<string, unknown> };
        try {
          msg = JSON.parse(event.data) as typeof msg;
        } catch {
          return;
        }
        const d = msg.data ?? {};
        if (d.prompt_id !== undefined && d.prompt_id !== promptId) return;

        if (msg.type === "progress" && typeof d.value === "number" && typeof d.max === "number") {
          ctx.onProgress?.(Math.round((d.value / Math.max(1, d.max)) * 100), {
            step: d.value,
            totalSteps: d.max,
          });
        } else if (
          msg.type === "execution_success" ||
          (msg.type === "executing" && d.node === null)
        ) {
          resolve();
        } else if (msg.type === "execution_error") {
          const detail =
            typeof d.exception_message === "string"
              ? d.exception_message
              : "ComfyUI execution failed";
          reject(new Error(detail));
        } else if (msg.type === "execution_interrupted") {
          const err = new Error("canceled");
          err.name = "AbortError";
          reject(err);
        }
      });
      ws.addEventListener("close", () => reject(new Error("Lost connection to ComfyUI")));
    });

    // History can lag a beat behind the success event.
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${baseUrl}/history/${promptId}`, { signal });
      const history = (await res.json()) as Record<
        string,
        {
          outputs?: Record<
            string,
            { images?: { filename: string; subfolder: string; type: string }[] }
          >;
        }
      >;
      const images = Object.values(history[promptId]?.outputs ?? {})
        .flatMap((o) => o.images ?? [])
        .filter((i) => i.type === "output");
      if (images.length > 0) {
        return Promise.all(images.map((i) => fetchOutput(baseUrl, i, signal)));
      }
      if (attempt >= 4) throw new Error("ComfyUI finished but produced no output image");
      await new Promise((r) => setTimeout(r, 250));
    }
  } finally {
    ws.close();
  }
}

export const comfyuiProvider: ImageProvider = {
  id: "comfyui",
  label: "ComfyUI",
  kind: "local",
  requiresKey: false,
  capabilities: { ...noCapabilities(), txt2img: true, img2img: true, inpaint: true },

  async listModels(): Promise<ModelInfo[]> {
    // The interface carries no connection context; live listing goes through
    // listComfyCheckpoints in the providers route instead.
    return [];
  },

  async generate(
    req: GenerateRequest,
    ctx: ProviderContext,
    signal?: AbortSignal,
  ): Promise<GenResult> {
    const baseUrl = ctx.baseUrl ?? "http://127.0.0.1:8188";
    const ckpt = await resolveCheckpoint(baseUrl, req.model);
    const seed = req.seed ?? randomSeed();
    const width = snap8(req.width);
    const height = snap8(req.height);

    const defaults = samplerDefaults(ckpt);
    const graph = {
      ...baseGraph(ckpt, req.prompt, req.negativePrompt ?? ""),
      latent: { class_type: "EmptyLatentImage", inputs: { width, height, batch_size: 1 } },
      sampler: sampler({
        seed,
        steps: req.steps ?? defaults.steps,
        cfg: defaults.cfg,
        denoise: 1,
        latentFrom: "latent",
      }),
    };

    const dataUrls = await runGraph(baseUrl, graph, ctx, signal);
    return {
      id: crypto.randomUUID(),
      images: dataUrls.map((dataUrl): GeneratedImage => ({ dataUrl, width, height })),
      provider: "comfyui",
      model: ckpt,
      seed,
      createdAt: Date.now(),
    };
  },

  /**
   * Edit an existing image. Two graphs behind one method:
   *  - img2img: encode the source and re-sample at denoise = strength.
   *  - inpaint (mask present): only the white-painted region is regenerated
   *    via VAEEncodeForInpaint; the rest of the image is preserved.
   * Both keep the source's dimensions; output lands as a new layer upstream.
   */
  async edit(req: EditRequest, ctx: ProviderContext, signal?: AbortSignal): Promise<GenResult> {
    const baseUrl = ctx.baseUrl ?? "http://127.0.0.1:8188";
    const ckpt = await resolveCheckpoint(baseUrl, req.model);
    const seed = req.seed ?? randomSeed();
    const defaults = samplerDefaults(ckpt);
    const inpaint = req.mode === "inpaint" && typeof req.mask === "string";

    const sourceName = await uploadImage(baseUrl, req.image, "latteart-source.png", signal);

    let graph: Record<string, unknown>;
    if (inpaint) {
      // Mask: white (painted) = regenerate. Uploaded as its own file, read as a
      // ComfyUI MASK from the red channel, then VAEEncodeForInpaint noises only
      // that region. Full denoise so the fill is fresh; grow softens the seam.
      const maskName = await uploadImage(baseUrl, req.mask!, "latteart-mask.png", signal);
      const denoise = Math.min(1, Math.max(0.2, req.strength ?? 1));
      graph = {
        ...baseGraph(ckpt, req.prompt, req.negativePrompt ?? ""),
        source: { class_type: "LoadImage", inputs: { image: sourceName } },
        maskimg: { class_type: "LoadImage", inputs: { image: maskName } },
        mask: { class_type: "ImageToMask", inputs: { image: ["maskimg", 0], channel: "red" } },
        encode: {
          class_type: "VAEEncodeForInpaint",
          inputs: { pixels: ["source", 0], vae: ["ckpt", 2], mask: ["mask", 0], grow_mask_by: 6 },
        },
        sampler: sampler({
          seed,
          steps: defaults.steps,
          cfg: defaults.cfg,
          denoise,
          latentFrom: "encode",
        }),
      };
    } else {
      const denoise = Math.min(1, Math.max(0.05, req.strength ?? 0.6));
      graph = {
        ...baseGraph(ckpt, req.prompt, req.negativePrompt ?? ""),
        source: { class_type: "LoadImage", inputs: { image: sourceName } },
        encode: { class_type: "VAEEncode", inputs: { pixels: ["source", 0], vae: ["ckpt", 2] } },
        sampler: sampler({
          seed,
          steps: defaults.steps,
          cfg: defaults.cfg,
          denoise,
          latentFrom: "encode",
        }),
      };
    }

    const dataUrls = await runGraph(baseUrl, graph, ctx, signal);
    return {
      id: crypto.randomUUID(),
      images: dataUrls.map(
        (dataUrl): GeneratedImage => ({
          dataUrl,
          width: req.width ?? 1024,
          height: req.height ?? 1024,
        }),
      ),
      provider: "comfyui",
      model: ckpt,
      seed,
      createdAt: Date.now(),
    };
  },
};
