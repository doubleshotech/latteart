import type { InpaintPromptApiResponse } from "@latteart/shared";

/**
 * Ask the local backend to rewrite a terse edit instruction for a masked region
 * into a coherent inpaint fill-prompt. Same LLM axis as {@link enhancePrompt},
 * different task — the server resolves the engine (the one pinned in Settings,
 * else the best available). `context` is the source layer's own prompt, sent so
 * the fill stays consistent with the rest of the image.
 */
export async function rewriteInpaintInstruction(
  instruction: string,
  providerId?: string,
  context?: string,
  signal?: AbortSignal,
): Promise<InpaintPromptApiResponse> {
  // "auto" (or unset) → let the server pick the best available engine.
  const pinned = providerId && providerId !== "auto" ? { providerId } : {};
  const res = await fetch("/api/inpaint-prompt", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ instruction, ...(context ? { context } : {}), ...pinned }),
    signal,
  });
  if (!res.ok) {
    let message = "Couldn't rewrite the instruction.";
    try {
      const err = (await res.json()) as { error?: string };
      if (err.error) message = err.error;
    } catch {
      /* keep the default message */
    }
    throw new Error(message);
  }
  return (await res.json()) as InpaintPromptApiResponse;
}
