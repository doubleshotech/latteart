import { serve } from "@hono/node-server";
import { Hono } from "hono";
import type { Context } from "hono";
import { logger } from "hono/logger";
import { streamSSE } from "hono/streaming";
import type {
  EditRequest,
  EnhanceApiRequest,
  EnhanceApiResponse,
  GenResult,
  GenerateRequest,
  InpaintPromptApiRequest,
  InpaintPromptApiResponse,
  LLMContext,
  LLMProviderDescriptor,
  ProgressEvent,
  ProjectDoc,
  ProviderContext,
} from "@latteart/shared";
import { applyStyle, stylePreset } from "@latteart/shared";
import { PROVIDER_CATALOG, catalogEntry } from "./providers/catalog.ts";
import type { ProviderCatalogEntry } from "./providers/catalog.ts";
import { listComfyCheckpoints } from "./providers/comfyui.ts";
import { getProvider } from "./providers/registry.ts";
import { getLLMProvider, listLLMProviders, resolveLLMProvider } from "./llm/registry.ts";
import { deleteSecret, getSecretValue, hasSecret, setSecret } from "./keystore/index.ts";
import { DEFAULT_PROJECT_ID, loadProject, saveProject } from "./projects/index.ts";

/**
 * The latteart local backend. One user, on the user's machine. It holds provider
 * secrets (encrypted, on-device), proxies cloud + local image providers behind
 * a single interface, and exposes a small typed API to the web UI via Hono RPC.
 *
 * The chained route definitions below build up `AppType`, which the web client
 * imports (type-only) for end-to-end type safety.
 */
const app = new Hono();

app.use("*", logger());

/**
 * Run a provider call (generate or edit) as an SSE job: queued → progress* →
 * done | error | canceled. Cancel = the client disconnects; we catch the abort
 * and stop the provider run. The `run` closure supplies the actual call so the
 * queuing, progress plumbing, and abort handling stay in one place.
 */
function streamJob(
  c: Context,
  providerId: string,
  entry: ProviderCatalogEntry,
  run: (ctx: ProviderContext, signal: AbortSignal) => Promise<GenResult>,
) {
  return streamSSE(c, async (stream) => {
    const ac = new AbortController();
    stream.onAbort(() => ac.abort());

    const jobId = crypto.randomUUID();
    const send = (e: ProgressEvent) => stream.writeSSE({ data: JSON.stringify(e) }).catch(() => {});

    await send({ type: "queued", jobId });
    try {
      const result = await run(
        {
          apiKey: getSecretValue(providerId),
          baseUrl: entry.connection
            ? (getSecretValue(providerId) ?? entry.connection.defaultValue)
            : undefined,
          onProgress: (pct, extra) => void send({ type: "progress", jobId, pct, ...extra }),
        },
        ac.signal,
      );
      await send({ type: "done", jobId, result });
    } catch (err) {
      const e = err as Error;
      if (ac.signal.aborted || e?.name === "AbortError") {
        await send({ type: "canceled", jobId });
      } else {
        await send({
          type: "error",
          jobId,
          message: e?.message ?? "generation failed",
        });
      }
    }
  });
}

const routes = app
  .get("/api/health", (c) =>
    c.json({ ok: true, service: "latteart-server", version: "0.0.0" } as const),
  )

  // What providers exist, what they can do, and whether they're usable. Never
  // returns a secret — only whether one is present. ComfyUI's models are its
  // installed checkpoints, so probe the live instance (short timeout) and let
  // reachability drive availability.
  .get("/api/providers", async (c) => {
    const list = await Promise.all(
      PROVIDER_CATALOG.map(async (p) => {
        let models = p.models;
        let available = p.implemented && (!p.requiresKey || hasSecret(p.id));
        if (p.id === "comfyui" && p.implemented) {
          const baseUrl = getSecretValue(p.id) ?? p.connection!.defaultValue;
          const live = await listComfyCheckpoints(baseUrl);
          models = live ?? [];
          available = live !== null && live.length > 0;
        }
        return {
          id: p.id,
          label: p.label,
          sublabel: p.sublabel ?? null,
          kind: p.kind,
          blurb: p.blurb,
          requiresKey: p.requiresKey,
          capabilities: p.capabilities,
          models,
          implemented: p.implemented,
          connection: p.connection ?? null,
          keyPlaceholder: p.keyPlaceholder ?? null,
          hasKey: hasSecret(p.id),
          available,
        };
      }),
    );
    return c.json(list);
  })

  // BYOK: store a secret (API key) or a local connection URL for a provider.
  // Write-only — the value is never echoed back.
  .put("/api/keys/:id", async (c) => {
    const id = c.req.param("id");
    // Accept both image providers and LLM engines (Ollama stores its URL here).
    if (!catalogEntry(id) && !getLLMProvider(id)) return c.json({ error: "unknown provider" }, 404);
    const body = await c.req.json<{ value?: string }>().catch(() => ({}) as { value?: string });
    const value = typeof body.value === "string" ? body.value.trim() : "";
    if (!value) return c.json({ error: "empty value" }, 400);
    setSecret(id, value);
    return c.json({ ok: true, id, hasKey: true });
  })

  .delete("/api/keys/:id", (c) => {
    const id = c.req.param("id");
    deleteSecret(id);
    return c.json({ ok: true, id, hasKey: false });
  })

  // Project persistence (v1: one implicit project). GET rehydrates layer
  // images to data: URLs; PUT is the autosave sink — the whole document each
  // time, pixels split out to content-hashed asset files on disk.
  .get("/api/project", (c) => c.json(loadProject(DEFAULT_PROJECT_ID)))

  .put("/api/project", async (c) => {
    const body = await c.req.json<ProjectDoc>().catch(() => null);
    if (
      !body ||
      !Array.isArray(body.layers) ||
      typeof body.viewport !== "object" ||
      body.viewport === null ||
      typeof body.session !== "object" ||
      body.session === null
    )
      return c.json({ error: "invalid project" }, 400);
    const saved = saveProject(DEFAULT_PROJECT_ID, body);
    return c.json({ ok: true, updatedAt: saved.updatedAt });
  })

  // Generate. Returns an SSE stream of ProgressEvents ending in done/error/
  // canceled. Cancel = the client aborts the request; we catch the disconnect
  // and abort the provider run.
  .post("/api/generate", async (c) => {
    const body = await c.req
      .json<Partial<GenerateRequest>>()
      .catch(() => ({}) as Partial<GenerateRequest>);
    const providerId = String(body.providerId ?? "");
    const entry = catalogEntry(providerId);
    const provider = getProvider(providerId);
    const prompt = String(body.prompt ?? "").trim();
    const styleId = body.styleId === undefined ? undefined : String(body.styleId);

    if (!entry) return c.json({ error: "unknown provider" }, 404);
    if (!provider) return c.json({ error: `provider '${providerId}' is not available yet` }, 400);
    if (!prompt) return c.json({ error: "prompt is required" }, 400);
    if (styleId !== undefined && !stylePreset(styleId))
      return c.json({ error: "unknown style" }, 400);
    if (provider.requiresKey && !hasSecret(providerId))
      return c.json({ error: "missing API key" }, 400);

    const styled = applyStyle(prompt, styleId, body.negativePrompt);
    const req: GenerateRequest = {
      providerId,
      model: body.model,
      prompt: styled.prompt,
      negativePrompt: styled.negativePrompt,
      styleId,
      width: Number(body.width) || 1024,
      height: Number(body.height) || 1024,
      seed: typeof body.seed === "number" ? body.seed : undefined,
    };

    return streamJob(c, providerId, entry, (ctx, signal) => provider.generate(req, ctx, signal));
  })

  // Edit an existing image (img2img). latteart's "AI Merge" flattens the visible
  // canvas to one composite and hands it here with a harmonize prompt. Same SSE
  // contract as /api/generate.
  .post("/api/edit", async (c) => {
    const body = await c.req.json<Partial<EditRequest>>().catch(() => ({}) as Partial<EditRequest>);
    const providerId = String(body.providerId ?? "");
    const entry = catalogEntry(providerId);
    const provider = getProvider(providerId);
    const prompt = String(body.prompt ?? "").trim();
    const image = typeof body.image === "string" ? body.image : "";
    const styleId = body.styleId === undefined ? undefined : String(body.styleId);

    if (!entry) return c.json({ error: "unknown provider" }, 404);
    if (!provider) return c.json({ error: `provider '${providerId}' is not available yet` }, 400);
    if (!provider.edit)
      return c.json({ error: `${entry.label} does not support editing yet` }, 400);
    if (!prompt) return c.json({ error: "prompt is required" }, 400);
    if (!image.startsWith("data:")) return c.json({ error: "a source image is required" }, 400);
    if (styleId !== undefined && !stylePreset(styleId))
      return c.json({ error: "unknown style" }, 400);
    if (provider.requiresKey && !hasSecret(providerId))
      return c.json({ error: "missing API key" }, 400);

    const styled = applyStyle(prompt, styleId, body.negativePrompt);
    const req: EditRequest = {
      providerId,
      model: body.model,
      prompt: styled.prompt,
      negativePrompt: styled.negativePrompt,
      styleId,
      image,
      mask: body.mask,
      mode: body.mode ?? "img2img",
      strength: typeof body.strength === "number" ? body.strength : undefined,
      width: Number(body.width) || undefined,
      height: Number(body.height) || undefined,
      seed: typeof body.seed === "number" ? body.seed : undefined,
    };

    return streamJob(c, providerId, entry, (ctx, signal) => provider.edit!(req, ctx, signal));
  })

  // The LLM enhancement engines and their live availability — the secondary
  // (assist-only) axis, separate from image /api/providers. Powers the Settings
  // picker. Ollama's configured URL lives in the keystore (like ComfyUI's).
  .get("/api/llm", async (c) => {
    const list = await Promise.all(
      listLLMProviders().map(async (p): Promise<LLMProviderDescriptor> => {
        const ctx: LLMContext = { baseUrl: getSecretValue(p.id) };
        return {
          id: p.id,
          label: p.label,
          kind: p.kind,
          available: await p.isAvailable(ctx),
          connection: p.connection ?? null,
          hasUrl: hasSecret(p.id),
        };
      }),
    );
    return c.json(list);
  })

  // Prompt enhancement (Phase 2 assist). Rewrites a terse prompt into a richer
  // one via a local LLM (Ollama) when reachable, else the offline mock. This is
  // the *secondary* LLM axis — no image provider or key involved. Non-streaming:
  // enhancement is a single quick call. A providerId pins the engine; omitted →
  // the server auto-resolves the first available one.
  .post("/api/enhance", async (c) => {
    const body = await c.req
      .json<Partial<EnhanceApiRequest>>()
      .catch(() => ({}) as Partial<EnhanceApiRequest>);
    const prompt = String(body.prompt ?? "").trim();
    if (!prompt) return c.json({ error: "prompt is required" }, 400);

    const providerId = body.providerId === undefined ? undefined : String(body.providerId);
    const ctxFor = (id: string): LLMContext => ({ baseUrl: getSecretValue(id) });
    const llm = await resolveLLMProvider(providerId, ctxFor);
    try {
      const enhanced = await llm.enhancePrompt(prompt, ctxFor(llm.id), c.req.raw.signal);
      return c.json({ prompt: enhanced, provider: llm.label } satisfies EnhanceApiResponse);
    } catch (err) {
      const message = (err as Error)?.message ?? "prompt enhancement failed";
      return c.json({ error: message }, 502);
    }
  })

  // Inpaint-instruction rewrite (Phase 2 assist). Turns a terse edit instruction
  // for a masked region into a coherent fill-prompt via the same LLM axis as
  // /api/enhance — a different task (region fill, not whole scene), same engine
  // resolution. Non-streaming; a providerId pins the engine, else auto-resolve.
  .post("/api/inpaint-prompt", async (c) => {
    const body = await c.req
      .json<Partial<InpaintPromptApiRequest>>()
      .catch(() => ({}) as Partial<InpaintPromptApiRequest>);
    const instruction = String(body.instruction ?? "").trim();
    if (!instruction) return c.json({ error: "instruction is required" }, 400);
    const context = body.context === undefined ? undefined : String(body.context);

    const providerId = body.providerId === undefined ? undefined : String(body.providerId);
    const ctxFor = (id: string): LLMContext => ({ baseUrl: getSecretValue(id) });
    const llm = await resolveLLMProvider(providerId, ctxFor);
    try {
      const prompt = await llm.rewriteInpaintInstruction(
        instruction,
        ctxFor(llm.id),
        c.req.raw.signal,
        context,
      );
      return c.json({ prompt, provider: llm.label } satisfies InpaintPromptApiResponse);
    } catch (err) {
      const message = (err as Error)?.message ?? "inpaint prompt rewrite failed";
      return c.json({ error: message }, 502);
    }
  });

/** Consumed by the web client as `hc<AppType>()` — type-only, never bundled. */
export type AppType = typeof routes;
export default app;

const port = Number(process.env.PORT ?? 8899);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`latteart server → http://localhost:${info.port}`);
});
