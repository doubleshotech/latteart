import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { logger } from "hono/logger";

/**
 * The latteart local backend. One user, runs on the user's machine. It holds
 * provider keys (encrypted, on-device), proxies cloud + local image providers,
 * and exposes a small typed API to the web UI via Hono RPC.
 *
 * Chained route definitions build up the `AppType` that the web client imports
 * for end-to-end type safety. Providers, generation, and key routes are added
 * on top of this skeleton.
 */
const app = new Hono();

app.use("*", logger());

const routes = app.get("/api/health", (c) =>
  c.json({ ok: true, service: "latteart-server", version: "0.0.0" } as const),
);

/** Consumed by the web client as `hc<AppType>()` — type-only, never bundled. */
export type AppType = typeof routes;
export default app;

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`latteart server → http://localhost:${info.port}`);
});
