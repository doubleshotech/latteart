import type { LLMContext, LLMProvider } from "@latteart/shared";

/**
 * Ollama runs entirely on the user's machine (no key), so it's the offline-first
 * choice for prompt enhancement. The base URL comes from Settings (stored per
 * this engine), falling back to OLLAMA_URL, then the Ollama default.
 */
const DEFAULT_BASE = process.env.OLLAMA_URL ?? "http://localhost:11434";

/** Resolve the endpoint from context → env/default, trailing slash trimmed. */
function resolveBase(ctx?: LLMContext): string {
  return (ctx?.baseUrl?.trim() || DEFAULT_BASE).replace(/\/+$/, "");
}

/** Small, fast instruct models we prefer for a quick prompt rewrite, in order. */
const PREFERRED = /llama3\.2|llama3\.1|llama3|qwen2\.5|qwen2|mistral|gemma2|gemma|phi/i;

/** Vision-capable models we can hand images to for style distillation. */
const VISION =
  /llava|llama3\.2-vision|llama-?vision|qwen2\.?5?-?vl|qwen2-vl|moondream|bakllava|minicpm-v|gemma3|granite3?\.?2?-vision/i;

const SYSTEM = `You are a prompt engineer for a text-to-image model. Rewrite the user's short description into a single, vivid image-generation prompt.
Rules:
- Keep the user's core subject and intent; never invent a different scene.
- Add concrete visual detail: setting, lighting, mood, color, composition, and medium or camera.
- Output ONLY the rewritten prompt as one line — no preamble, no quotes, no explanation, no markdown.
- Keep it under about 60 words.`;

const INPAINT_SYSTEM = `You are helping edit one masked region of an existing image (inpainting). Rewrite the user's short instruction into a single description of ONLY what should fill the masked area.
Rules:
- Describe just the content of the masked region — not the whole scene.
- Make it blend seamlessly: match the lighting, perspective, color, and style of the surrounding image.
- If image context is given, stay consistent with it; keep the user's core intent.
- Output ONLY the fill description as one line — no preamble, no quotes, no explanation, no markdown.
- Keep it under about 40 words.`;

const STYLE_SYSTEM = `You are a visual style analyst for a text-to-image model. Look at the reference image(s) and describe ONLY their visual STYLE — never the subject or content.
Rules:
- Capture medium, color palette, lighting, mood, texture, and rendering technique.
- Describe the style so it can be applied to a completely different subject.
- Output up to two labelled lines and nothing else:
  Style: <a single comma-separated line of style descriptors>
  Avoid: <optional comma-separated traits to keep OUT of the image, or omit this line entirely>
- No subject nouns, no preamble, no quotes, no markdown. Keep each line under about 40 words.`;

/**
 * Probe the local Ollama instance and choose an installed model — a small
 * instruct model if present, else whatever's first. Returns null when Ollama is
 * unreachable or has no models, which is how availability is decided.
 */
async function pickModel(base: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const res = await fetch(`${base}/api/tags`, { signal });
    if (!res.ok) return null;
    const data = (await res.json()) as { models?: { name?: string }[] };
    const names = (data.models ?? []).map((m) => m.name).filter((n): n is string => !!n);
    if (names.length === 0) return null;
    return names.find((n) => PREFERRED.test(n)) ?? names[0]!;
  } catch {
    return null;
  }
}

/**
 * Pick an installed vision-capable model for image analysis (style distillation),
 * or null when none is pulled. Unlike {@link pickModel} there's no fallback to
 * "whatever's first": a text-only model can't see the image, so a null here
 * means the caller must fall back to the offline heuristic.
 */
async function pickVisionModel(base: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const res = await fetch(`${base}/api/tags`, { signal });
    if (!res.ok) return null;
    const data = (await res.json()) as { models?: { name?: string }[] };
    const names = (data.models ?? []).map((m) => m.name).filter((n): n is string => !!n);
    return names.find((n) => VISION.test(n)) ?? null;
  } catch {
    return null;
  }
}

/** Strip the `data:...;base64,` prefix — Ollama's `images` want bare base64. */
function toBareBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma >= 0 && dataUrl.startsWith("data:") ? dataUrl.slice(comma + 1) : dataUrl;
}

/** Strip wrapper quotes, a leading "Prompt:" label, and collapse whitespace. */
function cleanEnhanced(text: string): string {
  return text
    .trim()
    .replace(/^\s*(?:prompt|enhanced prompt)\s*:\s*/i, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * One non-streaming `/api/generate` call: pick an installed model, run the given
 * system + user prompt, and return the response. Shared by the prompt-enhance,
 * inpaint-rewrite, and style-distill tasks — only the system prompt differs.
 * Picks the model at call time so it adapts to whatever the user pulled. By
 * default the response is collapsed to one clean line; `opts.raw` keeps the
 * multi-line text intact (the style task parses labelled lines from it).
 */
async function runGenerate(
  system: string,
  userPrompt: string,
  ctx?: LLMContext,
  signal?: AbortSignal,
  opts?: { model?: string; images?: string[]; raw?: boolean },
): Promise<string> {
  const base = resolveBase(ctx);
  const model = opts?.model ?? (await pickModel(base, signal));
  if (!model) {
    throw new Error(
      "Ollama isn't reachable — start it with `ollama serve` and pull a model (e.g. `ollama pull llama3.2`).",
    );
  }

  const res = await fetch(`${base}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      system,
      prompt: userPrompt,
      stream: false,
      options: { temperature: 0.8 },
      ...(opts?.images?.length ? { images: opts.images } : {}),
    }),
    signal,
  });
  if (!res.ok) {
    throw new Error(`Ollama request failed (${res.status})`);
  }

  const data = (await res.json()) as { response?: string };
  const out = opts?.raw ? (data.response ?? "").trim() : cleanEnhanced(data.response ?? "");
  if (!out) throw new Error("Ollama returned an empty response.");
  return out;
}

/**
 * Parse the style model's reply into a { prompt, negativePrompt } fragment. It's
 * asked for labelled `Style:` / `Avoid:` lines; a model that ignores the format
 * and returns a bare descriptor still works — the whole reply becomes the prompt.
 * Exported for unit testing.
 */
export function parseStyleDescriptor(text: string): { prompt: string; negativePrompt?: string } {
  const clean = (s: string) =>
    s
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^["'`]+|["'`]+$/g, "")
      .trim();

  let prompt = "";
  let negativePrompt: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    const style = /^\s*style\s*:\s*(.+)$/i.exec(line);
    const avoid = /^\s*(?:avoid|negative|no)\s*:\s*(.+)$/i.exec(line);
    if (style) prompt = clean(style[1]!);
    else if (avoid) negativePrompt = clean(avoid[1]!);
  }
  // Unlabelled reply → treat the whole thing as the descriptor.
  if (!prompt) prompt = clean(text);
  return { prompt, negativePrompt: negativePrompt || undefined };
}

/**
 * Local prompt enhancement + inpaint-instruction rewriting via Ollama's
 * `/api/generate` (non-streaming). No key; runs entirely on the user's machine.
 */
export const ollamaLLMProvider: LLMProvider = {
  id: "ollama",
  label: "Ollama",
  kind: "local",
  connection: { placeholder: DEFAULT_BASE, defaultValue: DEFAULT_BASE },

  async isAvailable(ctx?: LLMContext): Promise<boolean> {
    return (await pickModel(resolveBase(ctx))) !== null;
  },

  enhancePrompt(prompt: string, ctx?: LLMContext, signal?: AbortSignal): Promise<string> {
    return runGenerate(SYSTEM, prompt, ctx, signal);
  },

  rewriteInpaintInstruction(
    instruction: string,
    ctx?: LLMContext,
    signal?: AbortSignal,
    context?: string,
  ): Promise<string> {
    // Fold the optional source-image description in as context so the fill stays
    // coherent with the rest of the picture.
    const userPrompt = context?.trim()
      ? `Image context: ${context.trim()}\nEdit instruction for the masked region: ${instruction}`
      : instruction;
    return runGenerate(INPAINT_SYSTEM, userPrompt, ctx, signal);
  },

  async describeStyle(
    images: string[],
    ctx?: LLMContext,
    signal?: AbortSignal,
  ): Promise<{ prompt: string; negativePrompt?: string }> {
    const base = resolveBase(ctx);
    const model = await pickVisionModel(base, signal);
    if (!model) {
      // No vision model pulled — signal the caller to use the offline heuristic.
      throw new Error("No vision-capable Ollama model is available.");
    }
    // Ollama attaches images to the single prompt; a few refs are enough to read
    // a consistent style, so cap it to keep the request light. Keep the reply raw
    // so the labelled Style:/Avoid: lines survive for parsing.
    const raw = await runGenerate(
      STYLE_SYSTEM,
      "Describe the visual style of the reference image(s).",
      ctx,
      signal,
      { model, images: images.slice(0, 4).map(toBareBase64), raw: true },
    );
    return parseStyleDescriptor(raw);
  },
};
