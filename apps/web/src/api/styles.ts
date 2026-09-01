import type {
  CreateStyleApiRequest,
  CustomStyleDetail,
  CustomStyleInfo,
  UpdateStyleApiRequest,
} from "@latteart/shared";
import { client } from "./client";

/**
 * Custom-style library calls against the local backend. The list GET uses the
 * typed Hono RPC client; the per-style GET and the mutations use plain fetch
 * (like the keystore mutations) so we can shape a friendly error message from
 * the JSON body.
 */

/** How long the list GET may hang before it counts as failed. The list is
 * descriptor-free metadata plus small thumbnails, but projectStore awaits a
 * refresh inside its open/duplicate cascades — without a deadline a hung
 * backend would freeze those paths on this call. */
const LIST_TIMEOUT_MS = 4000;

export async function fetchStyles(): Promise<CustomStyleInfo[]> {
  const res = await client.api.styles.$get(undefined, {
    init: { signal: AbortSignal.timeout(LIST_TIMEOUT_MS) },
  });
  // Without this, a non-ok body would only fail by accident of not parsing —
  // the caller's retry loop needs an honest rejection.
  if (!res.ok) throw new Error(`could not list styles (${res.status})`);
  return (await res.json()) as CustomStyleInfo[];
}

/** Read a JSON error body into a thrown Error, with a fallback message. */
async function throwApiError(res: Response, fallback: string): Promise<never> {
  let message = fallback;
  try {
    const err = (await res.json()) as { error?: string };
    if (err.error) message = err.error;
  } catch {
    /* keep the default message */
  }
  throw new Error(message);
}

export async function createStyle(body: CreateStyleApiRequest): Promise<CustomStyleInfo> {
  const res = await fetch("/api/styles", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) await throwApiError(res, "Couldn't create the style.");
  return (await res.json()) as CustomStyleInfo;
}

export async function fetchStyleDetail(id: string): Promise<CustomStyleDetail> {
  const res = await fetch(`/api/styles/${encodeURIComponent(id)}`);
  if (!res.ok) await throwApiError(res, "Couldn't load the style.");
  return (await res.json()) as CustomStyleDetail;
}

export async function updateStyle(
  id: string,
  body: UpdateStyleApiRequest,
): Promise<CustomStyleInfo> {
  const res = await fetch(`/api/styles/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) await throwApiError(res, "Couldn't save the style.");
  return (await res.json()) as CustomStyleInfo;
}

export async function deleteStyle(id: string): Promise<void> {
  await fetch(`/api/styles/${encodeURIComponent(id)}`, { method: "DELETE" });
}
