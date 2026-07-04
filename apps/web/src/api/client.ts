import { hc } from "hono/client";
import type { InferResponseType } from "hono/client";
import type { AppType } from "@latteart/server";

/**
 * Typed Hono RPC client for the local backend's JSON routes (providers, keys).
 * Streaming generation uses a hand-rolled reader in ./generate.ts instead.
 * `/api` is proxied to the backend by the Vite dev server (same-origin).
 */
export const client = hc<AppType>(
  typeof window !== "undefined" ? window.location.origin : "http://localhost:5173",
);

/** Public provider descriptor, inferred from the server's response. */
export type Provider = InferResponseType<typeof client.api.providers.$get>[number];
