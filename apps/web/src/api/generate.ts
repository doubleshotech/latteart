import type { ProgressEvent } from "@latteart/shared";

export interface GenerateParams {
  providerId: string;
  model?: string;
  prompt: string;
  width: number;
  height: number;
  seed?: number;
}

/**
 * POST /api/generate and read the SSE stream, dispatching each ProgressEvent.
 * Cancel by aborting `signal` — the backend sees the disconnect and stops the
 * provider run. Resolves when the stream closes.
 */
export async function streamGenerate(
  params: GenerateParams,
  handlers: { onEvent: (e: ProgressEvent) => void; signal?: AbortSignal },
): Promise<void> {
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
    signal: handlers.signal,
  });

  if (!res.ok || !res.body) {
    let msg = res.statusText;
    try {
      const j = (await res.json()) as { error?: string };
      msg = j.error ?? msg;
    } catch {
      /* keep statusText */
    }
    throw new Error(msg || "generation failed");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    let idx = buf.indexOf("\n\n");
    while (idx !== -1) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
      if (dataLine) {
        const json = dataLine.slice(5).trim();
        if (json) handlers.onEvent(JSON.parse(json) as ProgressEvent);
      }
      idx = buf.indexOf("\n\n");
    }
  }
}
