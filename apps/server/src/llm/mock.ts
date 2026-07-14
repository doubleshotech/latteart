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
    const base = prompt.trim().replace(/[\s.,]+$/, "");
    if (!base) return prompt;
    // Deterministic: append only modifiers the prompt doesn't already mention.
    const lower = base.toLowerCase();
    const extras = MODIFIERS.filter((m) => !lower.includes(m));
    return extras.length ? `${base}, ${extras.join(", ")}` : base;
  },
};
