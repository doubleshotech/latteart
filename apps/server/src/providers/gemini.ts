import { noCapabilities } from "@latteart/shared";
import type {
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
  capabilities: { ...noCapabilities(), txt2img: true },

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
    const model = req.model ?? "gemini-2.5-flash-image";

    // Single synchronous call — no step stream, so report coarse progress.
    ctx.onProgress?.(15);
    const res = await fetch(`${BASE}/models/${model}:generateContent`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": ctx.apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: req.prompt }] }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
      }),
      signal,
    });

    ctx.onProgress?.(70);
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

    const data = await res.json();
    const image = findInlineImage(data);
    if (!image) {
      throw new Error("Gemini returned no image — the model may have declined this prompt");
    }

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
};
