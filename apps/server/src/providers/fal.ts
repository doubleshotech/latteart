import { noCapabilities } from "@latteart/shared";
import type {
  EditRequest,
  GenResult,
  GenerateRequest,
  GeneratedImage,
  ImageProvider,
  ModelInfo,
  ProviderContext,
  UpscaleRequest,
} from "@latteart/shared";

/**
 * Fal.ai — cloud diffusion (FLUX) via BYOK. Unlike Gemini's single synchronous
 * call, Fal runs through its **queue API**: submit a request, poll its status,
 * then fetch the result. That gives real, phase-based progress (queued →
 * running → done) forwarded to `ctx.onProgress`, and it can't time out the way
 * a long synchronous request would.
 *
 * v1 covers text-to-image and image-to-image against two FLUX models, plus a
 * prompt-less Real-ESRGAN upscale on a separate endpoint. Inpaint and
 * transparent-layer (LayerDiffuse) output are further Fal endpoints for later —
 * the catalog capabilities are scoped to match.
 *
 * NOTE: this provider has been verified against Fal's documented queue contract
 * and FLUX schema via fixtures only — it has not yet been smoke-tested against
 * the live API with a real key. See fal.test.ts.
 */

const QUEUE_BASE = "https://queue.fal.run";

/** Real-ESRGAN upscaler endpoint — a single shared model, independent of the
 * FLUX generation models above. Takes an image + scale, returns a larger image. */
const UPSCALE_ENDPOINT = "fal-ai/esrgan";

interface FalModel {
  /** The Fal model id, also the queue submit path (e.g. fal-ai/flux/schnell). */
  id: string;
  label: string;
  /** Whether this model has an image-to-image endpoint. */
  supportsImg2img: boolean;
  /** The img2img endpoint path; present iff supportsImg2img. */
  i2iEndpoint?: string;
  /** Model-specific defaults (schnell is a fixed few-step model). */
  defaults: { steps: number };
}

/**
 * The FLUX models latteart exposes. Adding another same-family model is one
 * entry here. FLUX is guidance-distilled and ignores true negative prompts, so
 * we fold any negative into the positive prompt (see {@link buildInput}).
 */
const FAL_MODELS: FalModel[] = [
  {
    id: "fal-ai/flux/schnell",
    label: "FLUX.1 [schnell]",
    supportsImg2img: false,
    defaults: { steps: 4 },
  },
  {
    id: "fal-ai/flux/dev",
    label: "FLUX.1 [dev]",
    supportsImg2img: true,
    i2iEndpoint: "fal-ai/flux/dev/image-to-image",
    defaults: { steps: 28 },
  },
];

const DEFAULT_MODEL = FAL_MODELS[0]!;

/** Resolve the requested model to a known entry, else the default. */
function resolveModel(requested?: string): FalModel {
  return FAL_MODELS.find((m) => m.id === requested) ?? DEFAULT_MODEL;
}

/**
 * Pick the model + endpoint an edit should run on. If the selected model has no
 * image-to-image endpoint (e.g. schnell), fall back to the first FLUX model
 * that does — there is one shared FLUX i2i endpoint (dev).
 */
function resolveI2iEndpoint(requested?: string): { model: FalModel; endpoint: string } {
  const requestedModel = resolveModel(requested);
  const model = requestedModel.i2iEndpoint ? requestedModel : FAL_MODELS.find((m) => m.i2iEndpoint);
  if (!model?.i2iEndpoint) throw new Error("Fal has no image-to-image model configured");
  return { model, endpoint: model.i2iEndpoint };
}

/** Injectable dependencies so tests can stub the HTTP boundary and skip waits. */
export interface FalOptions {
  /** HTTP client; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Delay between status polls in ms; production default is deliberately slow. */
  pollIntervalMs?: number;
}

const DEFAULT_POLL_INTERVAL_MS = 700;

function abortError(): Error {
  const err = new Error("canceled");
  err.name = "AbortError";
  return err;
}

/** Sleep that rejects promptly if the signal aborts. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    if (signal?.aborted) return onAbort();
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Read a JSON error message off a failed Fal response, else a status fallback. */
async function falError(res: Response): Promise<Error> {
  let message = `Fal request failed (${res.status})`;
  try {
    const body = (await res.json()) as { detail?: string; error?: string; message?: string };
    message = body.detail ?? body.error ?? body.message ?? message;
  } catch {
    /* keep the status-code message */
  }
  return new Error(message);
}

interface SubmitResponse {
  request_id: string;
  status_url: string;
  response_url: string;
  cancel_url: string;
}

interface StatusResponse {
  /** IN_QUEUE | IN_PROGRESS | COMPLETED — string, since Fal may add states. */
  status: string;
  queue_position?: number;
  error?: string;
  response_url?: string;
}

interface FalImage {
  url: string;
  width?: number;
  height?: number;
  content_type?: string;
}

interface FalResult {
  images?: FalImage[];
  /** ESRGAN (and some single-output endpoints) return one `image`, not `images`. */
  image?: FalImage;
  seed?: number;
}

/**
 * The full queue lifecycle for one request: submit → poll status (forwarding
 * phase-based progress) → fetch result. Threads the abort signal through every
 * wait and network call, so a cancel stops polling promptly.
 */
async function runQueue(
  endpoint: string,
  input: Record<string, unknown>,
  apiKey: string,
  ctx: ProviderContext,
  signal: AbortSignal | undefined,
  fetchImpl: typeof fetch,
  pollIntervalMs: number,
): Promise<FalResult> {
  const auth = { Authorization: `Key ${apiKey}` };

  const submitRes = await fetchImpl(`${QUEUE_BASE}/${endpoint}`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
  if (!submitRes.ok) throw await falError(submitRes);
  const submitted = (await submitRes.json()) as SubmitResponse;
  ctx.onProgress?.(5);

  try {
    // Poll until COMPLETED, forwarding queue/running phases as coarse progress.
    let inProgressTicks = 0;
    for (;;) {
      if (signal?.aborted) throw abortError();
      const statusRes = await fetchImpl(`${submitted.status_url}?logs=0`, {
        headers: auth,
        signal,
      });
      if (!statusRes.ok) throw await falError(statusRes);
      const status = (await statusRes.json()) as StatusResponse;

      if (status.status === "COMPLETED") break;
      if (status.status === "IN_PROGRESS") {
        ctx.onProgress?.(Math.min(90, 20 + inProgressTicks * 10));
        inProgressTicks += 1;
      } else if (status.status === "IN_QUEUE") {
        ctx.onProgress?.(10);
      } else {
        // Any non-queued/running/completed status (FAILED, ERROR, …) is
        // terminal — surface it rather than polling a stuck request forever.
        throw new Error(status.error ?? `Fal run failed (${status.status})`);
      }
      await sleep(pollIntervalMs, signal);
    }

    const resultRes = await fetchImpl(submitted.response_url, { headers: auth, signal });
    if (!resultRes.ok) throw await falError(resultRes);
    const result = (await resultRes.json()) as FalResult;
    ctx.onProgress?.(100);
    return result;
  } catch (err) {
    // On cancel, tell Fal to stop the run so it doesn't bill/finish orphaned.
    // Best-effort: the request is already aborting either way.
    if ((err as Error)?.name === "AbortError" && submitted.cancel_url) {
      void fetchImpl(submitted.cancel_url, { method: "PUT", headers: auth }).catch(() => {});
    }
    throw err;
  }
}

/**
 * FLUX is guidance-distilled and has no negative-prompt field, so fold any
 * negative into the positive prompt as a soft "avoid" clause rather than
 * silently dropping it.
 */
function foldNegative(prompt: string, negative?: string): string {
  const neg = negative?.trim();
  return neg ? `${prompt}\n\nAvoid: ${neg}` : prompt;
}

/** Map latteart's normalized request onto the FLUX input schema. */
function buildInput(model: FalModel, req: GenerateRequest): Record<string, unknown> {
  const input: Record<string, unknown> = {
    prompt: foldNegative(req.prompt, req.negativePrompt),
    image_size: { width: req.width, height: req.height },
    num_inference_steps: req.steps ?? model.defaults.steps,
    num_images: 1,
    enable_safety_checker: true,
    // Ask Fal to inline the result as a data URI so we skip a CDN round-trip.
    sync_mode: true,
  };
  if (typeof req.seed === "number") input.seed = req.seed;
  return input;
}

/**
 * Fal's raw img2img default strength (0.95) nearly reinvents the source; pick a
 * moderate default when the caller (e.g. AI Merge) didn't set one. Remix always
 * sends an explicit strength from its similarity slider.
 */
const DEFAULT_EDIT_STRENGTH = 0.85;

/** Map an edit request onto the FLUX image-to-image schema (no image_size —
 * the output size follows the source image). */
function buildEditInput(model: FalModel, req: EditRequest): Record<string, unknown> {
  const input: Record<string, unknown> = {
    prompt: foldNegative(req.prompt, req.negativePrompt),
    image_url: req.image,
    strength: req.strength ?? DEFAULT_EDIT_STRENGTH,
    num_inference_steps: model.defaults.steps,
    num_images: 1,
    enable_safety_checker: true,
    sync_mode: true,
  };
  if (typeof req.seed === "number") input.seed = req.seed;
  return input;
}

/** Fetch a hosted image and wrap it as a data URL. No auth header — the CDN is
 * a different host than the API, and forwarding the key there would leak it. */
async function fetchAsDataUrl(
  url: string,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetchImpl(url, { signal });
  if (!res.ok) throw new Error(`Fal image fetch failed (${res.status})`);
  const mime = res.headers.get("content-type") ?? "image/png";
  const b64 = Buffer.from(await res.arrayBuffer()).toString("base64");
  return `data:${mime};base64,${b64}`;
}

/**
 * Turn a Fal result into GenResult images (data URLs the canvas can drop in).
 * With `sync_mode: true` the url is already a data URI; otherwise it's a hosted
 * CDN url we fetch and encode.
 */
async function toImages(
  result: FalResult,
  fallbackW: number,
  fallbackH: number,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<GeneratedImage[]> {
  // Normalize both shapes: FLUX returns `images[]`, ESRGAN returns a single `image`.
  const images = result.images ?? (result.image ? [result.image] : []);
  if (images.length === 0) throw new Error("Fal returned no image");
  return Promise.all(
    images.map(async (img) => ({
      dataUrl: img.url.startsWith("data:")
        ? img.url
        : await fetchAsDataUrl(img.url, fetchImpl, signal),
      width: img.width ?? fallbackW,
      height: img.height ?? fallbackH,
    })),
  );
}

/**
 * Build a Fal provider. Production uses the global fetch and a slow poll
 * interval; tests inject a stub and a zero interval.
 */
export function createFalProvider(opts: FalOptions = {}): ImageProvider {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  return {
    id: "fal",
    label: "Fal.ai",
    kind: "cloud",
    requiresKey: true,
    capabilities: { ...noCapabilities(), txt2img: true, img2img: true, upscale: true },

    async listModels(): Promise<ModelInfo[]> {
      return FAL_MODELS.map((m) => ({ id: m.id, label: m.label }));
    },

    async generate(
      req: GenerateRequest,
      ctx: ProviderContext,
      signal?: AbortSignal,
    ): Promise<GenResult> {
      if (!ctx.apiKey)
        throw new Error("Fal needs an API key — create one at fal.ai/dashboard/keys");
      const model = resolveModel(req.model);
      const result = await runQueue(
        model.id,
        buildInput(model, req),
        ctx.apiKey,
        ctx,
        signal,
        fetchImpl,
        pollIntervalMs,
      );
      return {
        id: crypto.randomUUID(),
        images: await toImages(result, req.width, req.height, fetchImpl, signal),
        provider: "fal",
        model: model.id,
        seed: result.seed ?? req.seed,
        createdAt: Date.now(),
      };
    },

    async edit(req: EditRequest, ctx: ProviderContext, signal?: AbortSignal): Promise<GenResult> {
      if (!ctx.apiKey)
        throw new Error("Fal needs an API key — create one at fal.ai/dashboard/keys");
      if (!req.image.startsWith("data:"))
        throw new Error("Fal edit expected a base64 data: URL for the source image");
      const { model, endpoint } = resolveI2iEndpoint(req.model);
      const result = await runQueue(
        endpoint,
        buildEditInput(model, req),
        ctx.apiKey,
        ctx,
        signal,
        fetchImpl,
        pollIntervalMs,
      );
      return {
        id: crypto.randomUUID(),
        images: await toImages(result, req.width ?? 1024, req.height ?? 1024, fetchImpl, signal),
        provider: "fal",
        model: model.id,
        seed: result.seed ?? req.seed,
        createdAt: Date.now(),
      };
    },

    async upscale(
      req: UpscaleRequest,
      ctx: ProviderContext,
      signal?: AbortSignal,
    ): Promise<GenResult> {
      if (!ctx.apiKey)
        throw new Error("Fal needs an API key — create one at fal.ai/dashboard/keys");
      if (!req.image.startsWith("data:"))
        throw new Error("Fal upscale expected a base64 data: URL for the source image");
      const result = await runQueue(
        UPSCALE_ENDPOINT,
        { image_url: req.image, scale: req.scale, sync_mode: true },
        ctx.apiKey,
        ctx,
        signal,
        fetchImpl,
        pollIntervalMs,
      );
      return {
        id: crypto.randomUUID(),
        // ESRGAN echoes the output dims on the image itself; toImages reads them.
        images: await toImages(result, 0, 0, fetchImpl, signal),
        provider: "fal",
        model: UPSCALE_ENDPOINT,
        createdAt: Date.now(),
      };
    },
  };
}

/** The registered Fal provider (production defaults). */
export const falProvider = createFalProvider();
