import type { LLMProvider } from "@latteart/shared";
import { mockLLMProvider } from "./mock.ts";
import { ollamaLLMProvider } from "./ollama.ts";

/**
 * LLM providers for prompt enhancement — the secondary, assist-only engine axis,
 * deliberately separate from the image {@link import("@latteart/shared").ImageProvider}
 * registry. Priority order: prefer a real local LLM (Ollama), fall back to the
 * always-available offline mock so Enhance works even with nothing installed.
 *
 * v1 resolves the provider server-side (no picker yet); adding a BYOK cloud LLM
 * later is just another entry here.
 */
const PROVIDERS: LLMProvider[] = [ollamaLLMProvider, mockLLMProvider];

export function getLLMProvider(id: string): LLMProvider | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

/**
 * Pick the LLM to enhance with. An explicit id wins (if known); otherwise return
 * the first provider that reports itself available. The mock is always available,
 * so this never returns undefined.
 */
export async function resolveLLMProvider(preferredId?: string): Promise<LLMProvider> {
  if (preferredId) {
    const chosen = getLLMProvider(preferredId);
    if (chosen) return chosen;
  }
  for (const p of PROVIDERS) {
    if (await p.isAvailable()) return p;
  }
  return mockLLMProvider;
}
