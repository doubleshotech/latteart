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

> Status: working studio, actively built. It generates, edits and exports real
> multi-layer documents today. Expect rough edges rather than a missing floor.

## What it does

**Generate** — prompt → image → a new layer, with size and style presets, and a
"cutout" mode that returns a stack-ready transparent subject.

**Providers** — Google Gemini, OpenAI, Fal.ai and local ComfyUI, plus a built-in
mock provider so the whole app works offline with no key at all. Cloud keys are
yours and stay encrypted on your own machine.

**Edit** — remix, variations, upscale, outpaint, background replacement, and two
kinds of inpainting: paint a mask yourself, or let it derive one from the
subject. A local LLM (Ollama) can enhance a prompt or write the fill
instruction; an offline fallback covers the case where nothing is installed.

**Layers** — reorder, opacity, 16 blend modes, and non-destructive masks. Every
AI action sees what the canvas shows, so hiding part of a layer changes what the
model gets.

**Background removal** runs in your browser — a segmentation model on WebGPU in
a worker, so nothing leaves the machine and nothing blocks the UI.

**Projects** autosave to disk. Switch, rename, duplicate and delete them.

**Export** as a flattened PNG, or as **OpenRaster (`.ora`)** — which opens in
Krita, GIMP and MyPaint with every layer still separate and its opacity,
visibility and blend mode still editable.

## Stack

Monorepo driven by [**Vite+**](https://viteplus.dev) (`vp`), the unified
MIT-licensed toolchain (Vite/Rolldown, Vitest, Oxlint, Oxfmt, tsgo).

| Package           | What                                                            |
| ----------------- | --------------------------------------------------------------- |
| `apps/web`        | Vite + React + TypeScript UI. Zustand state, Konva canvas.      |
| `apps/server`     | Hono on Node — the local backend. Holds keys, routes providers. |
| `packages/shared` | Domain types shared by web and server.                          |
| `apps/site`       | The marketing site — a static, zero-JS landing page.            |

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
