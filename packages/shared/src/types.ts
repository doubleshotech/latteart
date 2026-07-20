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
  /**
   * Conditions on reference-image *pixels* as a native style guide (custom
   * styles v2) — distinct from the distilled text descriptor every provider
   * gets. Gates whether the route injects a custom style's source images into
   * the request; providers without it fall back to the descriptor alone.
   */
  styleRef: boolean;
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
  /** Style preset id from STYLE_PRESETS; the route composes it into the prompt. */
  styleId?: string;
  /**
   * Native style-reference pixels (data: URLs) — the source images of a custom
   * style. The route injects them (from the on-disk style library) only when the
   * style is `custom:*` and the provider's `styleRef` capability is set, so a
   * provider without native conditioning simply never sees them and relies on
   * the composed text descriptor instead. Purely additive; never sent by the client.
   */
  styleRefs?: string[];
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
  negativePrompt?: string;
  /** Style preset id from STYLE_PRESETS; the route composes it into the prompt. */
  styleId?: string;
  /**
   * Native style-reference pixels (data: URLs) for a custom style — injected by
   * the route under the same rule as {@link GenerateRequest.styleRefs}. Distinct
   * from {@link image}: `image` is the source being edited; these are a look to
   * emulate. Providers without the `styleRef` capability never receive them.
   */
  styleRefs?: string[];
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

/**
 * A pure resolution upscale of an existing image — deliberately separate from
 * {@link EditRequest}: it takes no prompt, no mask, and no style, only a source
 * image and an output multiplier. Gated by the `upscale` capability.
 */
export interface UpscaleRequest {
  providerId: string;
  model?: string;
  /** Source image as a data: URL. */
  image: string;
  /** Output size multiplier (2× or 4×). */
  scale: 2 | 4;
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
  /**
   * Optional resolution upscale (e.g. Real-ESRGAN). Prompt-less and distinct
   * from {@link edit}; gated by the `upscale` capability so the UI only offers
   * it where a provider can actually run it.
   */
  upscale?(req: UpscaleRequest, ctx: ProviderContext, signal?: AbortSignal): Promise<GenResult>;
}

/**
 * Per-call context for an {@link LLMProvider}: the configured endpoint for local
 * engines (falls back to the provider's own default when unset). No key field —
 * the prompt-enhance LLMs are local/no-auth today; a BYOK cloud LLM would add one.
 */
export interface LLMContext {
  /** Configured base URL for a local engine (e.g. Ollama); undefined → default. */
  baseUrl?: string;
}

/**
 * Secondary role: a local/BYOK LLM for prompt enhancement and natural-language
 * edit commands. Deliberately separate from {@link ImageProvider}.
 */
export interface LLMProvider {
  id: string;
  label: string;
  kind: ProviderKind;
  /** Connection field for engines configured by URL (Ollama); absent for the mock. */
  connection?: { placeholder: string; defaultValue: string };
  /**
   * Whether this engine is reachable/usable right now. Local engines (Ollama)
   * probe their endpoint; the offline mock is always available so Enhance
   * always does *something*. The backend picks the first available provider.
   */
  isAvailable(ctx?: LLMContext): Promise<boolean>;
  enhancePrompt(prompt: string, ctx?: LLMContext, signal?: AbortSignal): Promise<string>;
  /**
   * Rewrite a terse natural-language edit instruction into a clean inpaint
   * fill-prompt — a description of only what should occupy the masked region,
   * blended to match the surrounding image. A distinct task from
   * {@link enhancePrompt}, which rewrites a whole-scene generation prompt.
   * `context` is an optional description of the source image (the layer's own
   * prompt) so the fill stays coherent with it.
   */
  rewriteInpaintInstruction(
    instruction: string,
    ctx?: LLMContext,
    signal?: AbortSignal,
    context?: string,
  ): Promise<string>;
  /**
   * Distill one or more reference images into a reusable text style descriptor
   * (a prompt fragment + optional negatives) for a custom style. Needs a
   * vision-capable model, so it's optional: an engine without one omits it and
   * the backend falls back to a color/tone heuristic. `images` are data: URLs.
   */
  describeStyle?(
    images: string[],
    ctx?: LLMContext,
    signal?: AbortSignal,
  ): Promise<{ prompt: string; negativePrompt?: string }>;
}

/** Safe, public description of an LLM enhancement engine sent to the frontend. */
export interface LLMProviderDescriptor {
  id: string;
  label: string;
  kind: ProviderKind;
  /** Live probe: is the engine reachable/usable right now. */
  available: boolean;
  /** Present when the engine is configured by URL; the field's placeholder/default. */
  connection: { placeholder: string; defaultValue: string } | null;
  /** True when a custom URL has been saved for this engine. */
  hasUrl: boolean;
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
  styleId?: string;
  width: number;
  height: number;
  seed?: number;
}

/** Immediate response to `POST /api/generate` — the SSE stream carries the rest. */
export interface GenerateApiResponse {
  jobId: string;
}

/** Request body for `POST /api/enhance` — rewrite a terse prompt into a richer one. */
export interface EnhanceApiRequest {
  prompt: string;
  /** Optional explicit LLM provider id; omitted → the server picks the best available. */
  providerId?: string;
}

/** Response from `POST /api/enhance`. */
export interface EnhanceApiResponse {
  /** The rewritten, more descriptive image prompt. */
  prompt: string;
  /** Human label of the engine that produced it (e.g. "Ollama", "Offline enhancer"). */
  provider: string;
}

/**
 * Request body for `POST /api/inpaint-prompt` — rewrite a terse edit instruction
 * for a masked region into a coherent inpaint fill-prompt.
 */
export interface InpaintPromptApiRequest {
  /** The user's terse instruction for what should fill the painted area. */
  instruction: string;
  /** Optional description of the source image (the layer's prompt) for coherence. */
  context?: string;
  /** Optional explicit LLM provider id; omitted → the server picks the best available. */
  providerId?: string;
}

/** Response from `POST /api/inpaint-prompt`. */
export interface InpaintPromptApiResponse {
  /** The rewritten inpaint fill-prompt describing the masked region's content. */
  prompt: string;
  /** Human label of the engine that produced it. */
  provider: string;
}

/** How a custom style's descriptor was produced. */
export type StyleSource = "vision" | "heuristic";

/**
 * A user-derived custom style, stored server-side. Its {@link prompt} fragment
 * composes into generation prompts through the exact same path as a built-in
 * {@link StylePreset} (see `composeStyle`); the difference is only where the
 * fragment is resolved. `refs` keeps the source reference images (as on-disk
 * asset refs) so a future provider with native reference-image conditioning can
 * use the pixels directly instead of the distilled text.
 */
export interface CustomStyle {
  /** Namespaced id, e.g. `custom:ab12cd34` — never collides with preset ids. */
  id: string;
  label: string;
  /** Distilled style descriptor — the prompt fragment (same role as StylePreset.prompt). */
  prompt: string;
  /** Optional negatives merged into the request's negativePrompt. */
  negativePrompt?: string;
  /** Small preview (a downscaled reference) as a data: URL when rehydrated. */
  thumbnail?: string;
  /** Whether a vision model or the offline color/tone heuristic produced it. */
  source: StyleSource;
  /** On-disk asset refs for the source reference images (native-conditioning door). */
  refs: string[];
  createdAt: number;
}

/**
 * Public description of a custom style for the picker — the label, thumbnail,
 * and provenance, but not the descriptor text (composition stays server-side).
 */
export interface CustomStyleInfo {
  id: string;
  label: string;
  thumbnail?: string;
  source: StyleSource;
  createdAt: number;
}

/**
 * Client-computed color/tone summary of the reference images, sent with a
 * create-style request. It's the input to the offline heuristic descriptor when
 * no vision model is reachable; extraction runs in the browser (canvas decodes
 * any format) so the backend stays image-decode-free.
 */
export interface PaletteHint {
  /** Dominant colors as `#rrggbb`, most-prominent first. */
  colors: string[];
  /** Mean luminance, 0..1. */
  brightness: number;
  /** Mean saturation, 0..1. */
  saturation: number;
}

/** Request body for `POST /api/styles` — create a custom style from images. */
export interface CreateStyleApiRequest {
  /** Reference images as data: URLs (at least one). */
  images: string[];
  /** Optional client-computed palette summary — the offline heuristic's input. */
  paletteHint?: PaletteHint;
  /** Optional user-supplied name; the server derives one when omitted. */
  label?: string;
  /** Small preview data: URL for the picker; the server stores it as an asset. */
  thumbnail?: string;
  /** Optional explicit LLM provider id; omitted → the server picks the best available. */
  providerId?: string;
}
