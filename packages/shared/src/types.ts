/**
 * Core domain types shared by the web UI and the local backend.
 *
 * The heart of latteart is the {@link ImageProvider} abstraction: cloud (BYOK)
 * and local (ComfyUI/A1111/InvokeAI) engines are just implementations behind a
 * single interface. The frontend never talks to a provider directly — it calls
 * the local backend, which routes to the selected provider.
 */

export type ProviderKind = "cloud" | "local";

/**
 * What a given provider/model can do. Drives which UI affordances are enabled
 * (e.g. gray out inpaint when a provider can't do it). Completed from the
 * kickoff brief's truncated shape with `controlnet` and `upscale`.
 */
export interface ModelCapabilities {
  txt2img: boolean;
  img2img: boolean;
  inpaint: boolean;
  outpaint: boolean;
  removeBg: boolean;
  /** LayerDiffuse-style RGBA transparent-layer output. */
  transparentLayers: boolean;
  controlnet: boolean;
  upscale: boolean;
}

export interface ModelInfo {
  id: string;
  label: string;
  /** Per-model capability overrides, merged over the provider defaults. */
  capabilities?: Partial<ModelCapabilities>;
}

export interface GenerateRequest {
  providerId: string;
  model?: string;
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  seed?: number;
  steps?: number;
  /** Number of images to produce; each becomes its own layer. */
  batch?: number;
}

export type EditMode = "img2img" | "inpaint" | "outpaint";

export interface EditRequest {
  providerId: string;
  model?: string;
  prompt: string;
  /** Source image as a data: URL. */
  image: string;
  /** Mask as a data: URL (white = edit) for inpaint/outpaint. */
  mask?: string;
  mode: EditMode;
  /** img2img denoising strength, 0..1. */
  strength?: number;
  width?: number;
  height?: number;
  seed?: number;
}

export interface GeneratedImage {
  /** Image payload as a data: URL so it drops straight onto the canvas. */
  dataUrl: string;
  width: number;
  height: number;
  /** True for RGBA transparent-layer output (LayerDiffuse). */
  transparent?: boolean;
}

export interface GenResult {
  id: string;
  /** Array so a single generation can yield multiple layers (LayerDiffuse). */
  images: GeneratedImage[];
  provider: string;
  model?: string;
  seed?: number;
  createdAt: number;
}

/** Normalized progress stream — local backends stream steps; cloud fakes it. */
export type ProgressEvent =
  | { type: "queued"; jobId: string }
  | {
      type: "progress";
      jobId: string;
      /** 0..100 */
      pct: number;
      step?: number;
      totalSteps?: number;
      /** Optional low-res preview as a data: URL. */
      previewDataUrl?: string;
    }
  | { type: "done"; jobId: string; result: GenResult }
  | { type: "error"; jobId: string; message: string }
  | { type: "canceled"; jobId: string };

/**
 * Per-call context handed to a provider by the backend: the resolved API key
 * (never exposed to the frontend), an optional base URL (local backends), and a
 * progress sink the backend forwards to the client over SSE.
 */
export interface ProviderContext {
  apiKey?: string;
  baseUrl?: string;
  /**
   * Report incremental progress (pct 0..100). The backend stamps the job id and
   * streams a {@link ProgressEvent} to the client, so providers stay
   * job-agnostic — a local backend forwards diffusion steps; a cloud one fakes.
   */
  onProgress?: (
    pct: number,
    extra?: { step?: number; totalSteps?: number; previewDataUrl?: string },
  ) => void;
}

/**
 * The one interface every image engine implements. Cloud and local providers
 * are interchangeable behind it.
 */
export interface ImageProvider {
  id: string;
  label: string;
  kind: ProviderKind;
  capabilities: ModelCapabilities;
  /** Cloud providers need a BYOK key; local ones need a reachable base URL. */
  requiresKey: boolean;
  listModels(): Promise<ModelInfo[]>;
  generate(req: GenerateRequest, ctx: ProviderContext, signal?: AbortSignal): Promise<GenResult>;
  edit?(req: EditRequest, ctx: ProviderContext, signal?: AbortSignal): Promise<GenResult>;
}

/**
 * Secondary role: a local/BYOK LLM for prompt enhancement and natural-language
 * edit commands. Deliberately separate from {@link ImageProvider}.
 */
export interface LLMProvider {
  id: string;
  label: string;
  kind: ProviderKind;
  enhancePrompt(prompt: string, signal?: AbortSignal): Promise<string>;
}

/**
 * Safe, public description of a provider sent to the frontend. Never contains a
 * key — only whether one is present.
 */
export interface ProviderDescriptor {
  id: string;
  label: string;
  kind: ProviderKind;
  capabilities: ModelCapabilities;
  requiresKey: boolean;
  hasKey: boolean;
  models: ModelInfo[];
}

/** Request body for `POST /api/generate`. */
export interface GenerateApiRequest {
  providerId: string;
  model?: string;
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  seed?: number;
}

/** Immediate response to `POST /api/generate` — the SSE stream carries the rest. */
export interface GenerateApiResponse {
  jobId: string;
}
