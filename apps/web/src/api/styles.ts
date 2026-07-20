import type { CreateStyleApiRequest, CustomStyleInfo } from "@latteart/shared";
import { client } from "./client";

/**
 * Custom-style library calls against the local backend. GET uses the typed Hono
 * RPC client; create/delete use plain fetch (like the keystore mutations) so we
 * can shape a friendly error message from the JSON body.
 */

export async function fetchStyles(): Promise<CustomStyleInfo[]> {
  const res = await client.api.styles.$get();
  return (await res.json()) as CustomStyleInfo[];
}

export async function createStyle(body: CreateStyleApiRequest): Promise<CustomStyleInfo> {
  const res = await fetch("/api/styles", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let message = "Couldn't create the style.";
    try {
      const err = (await res.json()) as { error?: string };
      if (err.error) message = err.error;
    } catch {
      /* keep the default message */
    }
    throw new Error(message);
  }
  return (await res.json()) as CustomStyleInfo;
}

export async function deleteStyle(id: string): Promise<void> {
  await fetch(`/api/styles/${encodeURIComponent(id)}`, { method: "DELETE" });
}
