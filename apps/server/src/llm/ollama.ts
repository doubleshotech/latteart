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
 * system + user prompt, and return the cleaned single-line response. Shared by
 * both the prompt-enhance and inpaint-rewrite tasks — only the system prompt
 * differs. Picks the model at call time so it adapts to whatever the user pulled.
 */
async function runGenerate(
  system: string,
  userPrompt: string,
  ctx?: LLMContext,
  signal?: AbortSignal,
): Promise<string> {
  const base = resolveBase(ctx);
  const model = await pickModel(base, signal);
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
    }),
    signal,
  });
  if (!res.ok) {
    throw new Error(`Ollama request failed (${res.status})`);
  }

  const data = (await res.json()) as { response?: string };
  const out = cleanEnhanced(data.response ?? "");
  if (!out) throw new Error("Ollama returned an empty response.");
  return out;
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
};
