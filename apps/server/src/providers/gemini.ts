import { noCapabilities } from "@latteart/shared";
import type {
  EditRequest,
  GenResult,
  GenerateRequest,
  ImageProvider,
  ModelInfo,
  ProviderContext,
} from "@latteart/shared";

const BASE = "https://generativelanguage.googleapis.com/v1beta";

/**
 * Depth-first search for the first inline image in a Gemini response. The image
 * lives at candidates[].content.parts[].inlineData.{mimeType,data}, but we walk
 * the whole tree (and accept snake_case) so we stay robust to response-shape
 * drift across the fast-moving Gemini image models.
 */
function findInlineImage(node: unknown): { mimeType: string; data: string } | null {
  if (!node || typeof node !== "object") return null;
  const rec = node as Record<string, unknown>;
  const inline = (rec.inlineData ?? rec.inline_data) as
    | { mimeType?: string; mime_type?: string; data?: string }
    | undefined;
  if (inline?.data) {
    return {
      mimeType: inline.mimeType ?? inline.mime_type ?? "image/png",
      data: inline.data,
    };
  }
  for (const value of Object.values(rec)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findInlineImage(item);
        if (found) return found;
      }
    } else if (value && typeof value === "object") {
      const found = findInlineImage(value);
      if (found) return found;
    }
  }
  return null;
}

/** Aspect ratios the Gemini image API accepts (width:height). */
const GEMINI_ASPECT_RATIOS = [
  { ratio: "1:1", value: 1 },
  { ratio: "2:3", value: 2 / 3 },
  { ratio: "3:2", value: 3 / 2 },
  { ratio: "3:4", value: 3 / 4 },
  { ratio: "4:3", value: 4 / 3 },
  { ratio: "4:5", value: 4 / 5 },
  { ratio: "5:4", value: 5 / 4 },
  { ratio: "9:16", value: 9 / 16 },
  { ratio: "16:9", value: 16 / 9 },
  { ratio: "21:9", value: 21 / 9 },
];

/** Snap a requested pixel size to the closest aspect ratio Gemini supports. */
function nearestAspectRatio(width: number, height: number): string {
  if (!width || !height) return "1:1";
  const target = width / height;
  let best = GEMINI_ASPECT_RATIOS[0]!;
  for (const entry of GEMINI_ASPECT_RATIOS) {
    if (Math.abs(entry.value - target) < Math.abs(best.value - target)) best = entry;
  }
  return best.ratio;
}

/** Parse a `data:<mime>;base64,<data>` URL into its parts. */
function parseDataUrl(url: string): { mimeType: string; data: string } | null {
  const m = /^data:(.*?);base64,(.*)$/s.exec(url);
  if (!m) return null;
  return { mimeType: m[1] || "image/png", data: m[2] ?? "" };
}

/**
 * Custom styles v2 — native reference-image conditioning. Turn a style's source
 * images into Gemini `inlineData` parts appended AFTER the prompt text, so they
 * become "the final N images" the framing instruction refers to. Returns null
 * when there are none (or none decode), so the caller keeps the plain path.
 */
function styleRefParts(styleRefs: string[] | undefined) {
  if (!styleRefs?.length) return null;
  const parts = styleRefs
    .map(parseDataUrl)
    .filter((p): p is { mimeType: string; data: string } => p !== null)
    .map((p) => ({ inlineData: { mimeType: p.mimeType, data: p.data } }));
  return parts.length > 0 ? parts : null;
}

/**
 * The crux of native conditioning: without this, Gemini treats an extra image as
 * content to blend or edit. This tells it the trailing image(s) are a *style*
 * guide only — emulate the look, don't reproduce the subject. Appended to the
 * generation/edit instruction whenever style refs are present.
 */
function styleRefInstruction(count: number): string {
  const subject =
    count === 1
      ? "The final image is a STYLE REFERENCE"
      : `The final ${count} images are STYLE REFERENCES`;
  const poss = count === 1 ? "its" : "their";
  const obj = count === 1 ? "it" : "them";
  return `\n\n${subject}, not content to reproduce. Match ${poss} artistic style — color palette, lighting, texture, brushwork, and overall rendering — while creating the scene described above. Do not copy the subject, objects, or composition of ${obj}.`;
}

/** Suffix an instruction with the style-only framing when style refs are present
 * — the shared shape used by both generate() and edit(). No-op when there are none. */
function withStyleRefInstruction(base: string, refParts: unknown[] | null): string {
  return refParts ? `${base}${styleRefInstruction(refParts.length)}` : base;
}

/**
 * Gemini has no native img2img denoising strength — `:generateContent` takes an
 * image plus an instruction. Translate the request's strength (0 = stay close,
 * 1 = reinvent) into phrasing so the remix similarity slider still steers it.
 */
function strengthInstruction(strength: number): string {
  if (strength <= 0.2)
    return "Stay extremely faithful to the source image — same composition and subject; apply only the changes the instruction requests.";
  if (strength <= 0.4)
    return "Keep the composition and subject close to the source image; apply the requested changes but refine rather than reinvent.";
  if (strength <= 0.6)
    return "Keep the subject and overall composition recognizable, but freely rework details, lighting, and texture to serve the instruction.";
  if (strength <= 0.8)
    return "Use the source image as loose inspiration — keep the subject recognizable while taking the creative liberties the instruction invites.";
  return "Reinvent freely — treat the source as a starting point only; a bold new interpretation is welcome, guided by the instruction.";
}

/** Pull the first inline image out of a Gemini response, or throw a clean error. */
async function readImage(res: Response): Promise<{ mimeType: string; data: string }> {
  if (!res.ok) {
    let message = `Gemini request failed (${res.status})`;
    try {
      const err = (await res.json()) as { error?: { message?: string } };
      if (err.error?.message) message = err.error.message;
    } catch {
      /* keep the status-code message */
    }
    throw new Error(message);
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new Error("Gemini returned no image — the model may have declined this prompt");
  }

  const image = findInlineImage(data);
  if (!image) {
    throw new Error("Gemini returned no image — the model may have declined this prompt");
  }
  return image;
}

/**
 * POST content parts to `:generateContent` and return the first image. The key
 * goes in the `x-goog-api-key` header (never the URL). `imageConfig` nudges the
 * output aspect ratio; a model that doesn't support it just ignores the field,
 * so it never breaks the request.
 */
async function generateContent(
  model: string,
  parts: unknown[],
  apiKey: string,
  signal: AbortSignal | undefined,
  imageConfig?: { aspectRatio: string },
): Promise<{ mimeType: string; data: string }> {
  const res = await fetch(`${BASE}/models/${model}:generateContent`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        ...(imageConfig ? { imageConfig } : {}),
      },
    }),
    signal,
  });
  return readImage(res);
}

/**
 * Google Gemini image generation (BYOK, Google AI Studio key). Uses the
 * `:generateContent` endpoint with the key in the `x-goog-api-key` header (never
 * in the URL). Model IDs evolve quickly — they're user-selectable in the picker.
 */
export const geminiProvider: ImageProvider = {
  id: "gemini",
  label: "Google Gemini",
  kind: "cloud",
  requiresKey: true,
  // styleRef: Gemini's multi-image contents array lets a custom style's source
  // pixels ride along as native style conditioning (see generate/edit below).
  capabilities: { ...noCapabilities(), txt2img: true, img2img: true, styleRef: true },

  async listModels(): Promise<ModelInfo[]> {
    return [
      { id: "gemini-2.5-flash-image", label: "Gemini 2.5 Flash Image" },
      { id: "gemini-3-pro-image", label: "Gemini 3 Pro Image" },
    ];
  },

  async generate(
    req: GenerateRequest,
    ctx: ProviderContext,
    signal?: AbortSignal,
  ): Promise<GenResult> {
    if (!ctx.apiKey) {
      throw new Error("Gemini needs an API key — create one at aistudio.google.com");
    }
    const model = req.model?.trim() || "gemini-2.5-flash-image";

    // Native style conditioning: a custom style's reference pixels ride along as
    // trailing image parts, with the prompt suffixed to mark them style-only.
    const refParts = styleRefParts(req.styleRefs);
    const text = withStyleRefInstruction(req.prompt, refParts);
    const parts: unknown[] = [{ text }, ...(refParts ?? [])];

    // Single synchronous call — no step stream, so report coarse progress.
    ctx.onProgress?.(15);
    const image = await generateContent(model, parts, ctx.apiKey, signal, {
      aspectRatio: nearestAspectRatio(req.width, req.height),
    });

    ctx.onProgress?.(100);
    return {
      id: crypto.randomUUID(),
      // Nominal size; the canvas fits the layer to the real image aspect on load.
      images: [
        {
          dataUrl: `data:${image.mimeType};base64,${image.data}`,
          width: req.width,
          height: req.height,
        },
      ],
      provider: "gemini",
      model,
      seed: req.seed,
      createdAt: Date.now(),
    };
  },

  /**
   * Image-to-image: hand Gemini a source image plus an instruction and get one
   * image back. latteart drives "AI Merge" through here — a flattened composite
   * of the canvas plus a harmonize prompt (Strategy B). We don't force an aspect
   * ratio so the model preserves the source composition.
   */
  async edit(req: EditRequest, ctx: ProviderContext, signal?: AbortSignal): Promise<GenResult> {
    if (!ctx.apiKey) {
      throw new Error("Gemini needs an API key — create one at aistudio.google.com");
    }
    const source = parseDataUrl(req.image);
    if (!source) {
      throw new Error("Gemini edit expected a base64 data URL for the source image");
    }
    const model = req.model?.trim() || "gemini-2.5-flash-image";

    const base =
      typeof req.strength === "number"
        ? `${req.prompt}\n\n${strengthInstruction(req.strength)}`
        : req.prompt;

    // The source image is first (the thing being edited); any style refs trail
    // it, so styleRefInstruction's "final N images" points at the refs, not it.
    const refParts = styleRefParts(req.styleRefs);
    const instruction = withStyleRefInstruction(base, refParts);
    const parts: unknown[] = [
      { text: instruction },
      { inlineData: { mimeType: source.mimeType, data: source.data } },
      ...(refParts ?? []),
    ];

    ctx.onProgress?.(15);
    const image = await generateContent(model, parts, ctx.apiKey, signal);

    ctx.onProgress?.(100);
    return {
      id: crypto.randomUUID(),
      images: [
        {
          dataUrl: `data:${image.mimeType};base64,${image.data}`,
          width: req.width ?? 1024,
          height: req.height ?? 1024,
        },
      ],
      provider: "gemini",
      model,
      seed: req.seed,
      createdAt: Date.now(),
    };
  },
};
