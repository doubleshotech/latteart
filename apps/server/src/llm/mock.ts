import type { LLMProvider } from "@latteart/shared";

/**
 * Tasteful, generic detail modifiers the offline enhancer appends. Kept short
 * and deterministic — this is a no-network placeholder that makes the Enhance
 * button do something useful in the default mock-only setup, mirroring the mock
 * image provider. A real local LLM (Ollama) supersedes it when reachable.
 */
const MODIFIERS = [
  "dramatic cinematic lighting",
  "rich detail",
  "balanced composition",
  "atmospheric depth",
  "sharp focus",
];

/** Blend modifiers the offline enhancer appends to an inpaint fill so the mock
 * fill-prompt reads like a region description that matches its surroundings. */
const INPAINT_MODIFIERS = [
  "seamlessly blended",
  "matching the surrounding lighting",
  "consistent perspective",
];

/**
 * Offline prompt enhancer. No network, no key — always available, so the
 * registry can fall back to it when no real LLM is installed.
 */
export const mockLLMProvider: LLMProvider = {
  id: "offline",
  label: "Offline enhancer",
  kind: "local",

  async isAvailable(): Promise<boolean> {
    return true;
  },

  // ctx/signal are unused — this enhancer is synchronous and endpoint-free.
  async enhancePrompt(prompt: string): Promise<string> {
    return appendUnique(prompt, MODIFIERS);
  },

  // Deterministic offline inpaint rewrite: append blend modifiers so the fill
  // reads as a region description. context is ignored (no reasoning offline).
  async rewriteInpaintInstruction(instruction: string): Promise<string> {
    return appendUnique(instruction, INPAINT_MODIFIERS);
  },
};

/** Trim trailing punctuation and append only modifiers not already present. */
function appendUnique(text: string, modifiers: string[]): string {
  const base = text.trim().replace(/[\s.,]+$/, "");
  if (!base) return text;
  const lower = base.toLowerCase();
  const extras = modifiers.filter((m) => !lower.includes(m));
  return extras.length ? `${base}, ${extras.join(", ")}` : base;
}
