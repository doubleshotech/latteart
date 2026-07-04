# latteart

**Open-source, local-first AI image studio with real layers.**

latteart is a layer-based AI image generation + editing studio — a Recraft /
Photoshop-Firefly alternative that is **provider-agnostic**: bring your own key
(cloud image APIs) or connect a local backend (ComfyUI / A1111 / InvokeAI). It
runs on your machine and can work fully offline against a local model.

- **Local-first & private.** The app is a browser UI plus a thin local backend.
  API keys live only on that backend in an **encrypted local store**, are never
  logged, and are only ever sent to the provider they belong to.
- **Provider-agnostic.** One `ImageProvider` interface; cloud and local are just
  implementations behind it.
- **Non-destructive layers** are a first-class primitive: stack, reorder,
  opacity, blend modes, masks.

> Status: early scaffold. The first milestone is the end-to-end
> **prompt → generate → new layer** loop against a built-in mock provider (no key
> required), plus BYOK settings with encrypted key storage.

## Stack

Monorepo driven by [**Vite+**](https://viteplus.dev) (`vp`), the unified
MIT-licensed toolchain (Vite/Rolldown, Vitest, Oxlint, Oxfmt, tsgo).

| Package           | What                                                            |
| ----------------- | --------------------------------------------------------------- |
| `apps/web`        | Vite + React + TypeScript UI. Zustand state, Konva canvas.      |
| `apps/server`     | Hono on Node — the local backend. Holds keys, routes providers. |
| `packages/shared` | Domain types shared by web and server.                          |

Frontend ↔ backend are type-shared via **Hono RPC**.

## Develop

```bash
vp install    # install workspace deps
pnpm dev      # run web + server together (backend + Vite, concurrently)
```

Or run them in separate terminals: `pnpm dev:server` and `pnpm dev:web`.

- Web: http://localhost:5173 (Vite picks the next free port if taken)
- Server: http://localhost:8899 (proxied under `/api` from the web dev server)

## License

[MIT](./LICENSE) © The latteart Authors
