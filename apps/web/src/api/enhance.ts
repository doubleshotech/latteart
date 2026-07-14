import type { EnhanceApiResponse } from "@latteart/shared";

/**
 * Ask the local backend to rewrite a terse prompt into a richer one. The server
 * resolves the LLM engine (Ollama if reachable, else the offline enhancer), so
 * the client just sends text and gets text back. `/api` is proxied to the
 * backend by the Vite dev server.
 */
export async function enhancePrompt(
  prompt: string,
  providerId?: string,
  signal?: AbortSignal,
): Promise<EnhanceApiResponse> {
  // "auto" (or unset) → let the server pick the best available engine.
  const pinned = providerId && providerId !== "auto" ? { providerId } : {};
  const res = await fetch("/api/enhance", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt, ...pinned }),
    signal,
  });
  if (!res.ok) {
    let message = "Couldn't enhance the prompt.";
    try {
      const err = (await res.json()) as { error?: string };
      if (err.error) message = err.error;
    } catch {
      /* keep the default message */
    }
    throw new Error(message);
  }
  return (await res.json()) as EnhanceApiResponse;
}
