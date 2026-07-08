import type { EditMode, ProgressEvent } from "@latteart/shared";

export interface GenerateParams {
  providerId: string;
  model?: string;
  prompt: string;
  styleId?: string;
  width: number;
  height: number;
  seed?: number;
}

export interface EditParams {
  providerId: string;
  model?: string;
  prompt: string;
  /** Style preset id from STYLE_PRESETS; the route composes it into the prompt. */
  styleId?: string;
  /** Source image as a data: URL. */
  image: string;
  /** Inpaint mask as a data: URL (white = regenerate); matches the source's pixels. */
  mask?: string;
  mode?: EditMode;
  /** img2img similarity → denoising strength, 0..1. */
  strength?: number;
  /** Generation pixel size (scaled up from the source's display dims). */
  width?: number;
  height?: number;
  seed?: number;
}

interface StreamHandlers {
  onEvent: (e: ProgressEvent) => void;
  signal?: AbortSignal;
}

/**
 * POST a JSON body and read the SSE ProgressEvent stream, dispatching each event.
 * Cancel by aborting `signal` — the backend sees the disconnect and stops the
 * provider run. Resolves when the stream closes.
 */
async function postSSE(path: string, body: unknown, handlers: StreamHandlers): Promise<void> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
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
    throw new Error(msg || "request failed");
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

/** Text-to-image generation over `POST /api/generate`. */
export function streamGenerate(params: GenerateParams, handlers: StreamHandlers): Promise<void> {
  return postSSE("/api/generate", params, handlers);
}

/** Image-to-image edit (AI Merge) over `POST /api/edit`. */
export function streamEdit(params: EditParams, handlers: StreamHandlers): Promise<void> {
  return postSSE("/api/edit", params, handlers);
}
