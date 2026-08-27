import type {
  CreateStyleApiRequest,
  CustomStyleDetail,
  CustomStyleInfo,
  UpdateStyleApiRequest,
} from "@latteart/shared";
import { client } from "./client";

/**
 * Custom-style library calls against the local backend. The list GET uses the
 * typed Hono RPC client; the mutations use plain fetch (like the keystore
 * mutations) so we can shape a friendly error message from the JSON body.
 */

export async function fetchStyles(): Promise<CustomStyleInfo[]> {
  const res = await client.api.styles.$get();
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
