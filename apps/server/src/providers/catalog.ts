import { noCapabilities } from "@latteart/shared";
import type { ModelCapabilities, ModelInfo, ProviderKind } from "@latteart/shared";

/**
 * The set of providers latteart knows about, shown in Settings for BYOK / local
 * connection. `implemented` marks whether the backend can actually run a
 * generation against it yet — only the built-in Mock is wired for the MVP; the
 * rest are drop-in {@link import("@latteart/shared").ImageProvider}s later.
 */
export interface ProviderCatalogEntry {
  id: string;
  label: string;
  /** e.g. "· local", "· built-in" — a muted suffix after the label. */
  sublabel?: string;
  kind: ProviderKind;
  blurb: string;
  requiresKey: boolean;
  capabilities: ModelCapabilities;
  models: ModelInfo[];
  implemented: boolean;
  /** Local providers connect by URL instead of a secret key. */
  connection?: { field: "url"; placeholder: string; defaultValue: string };
  keyPlaceholder?: string;
}

const caps = (o: Partial<ModelCapabilities>): ModelCapabilities => ({
  ...noCapabilities(),
  ...o,
});

export const PROVIDER_CATALOG: ProviderCatalogEntry[] = [
  {
    id: "fal",
    label: "Fal.ai",
    kind: "cloud",
    blurb: "FLUX.1 [dev] · [schnell] · fast cloud",
    requiresKey: true,
    // v1 drives txt2img + img2img (FLUX) and a Real-ESRGAN upscale. Inpaint and
    // transparent-layer output are separate Fal endpoints for later —
    // capabilities gate the UI, so only claim what the provider implements.
    capabilities: caps({ txt2img: true, img2img: true, upscale: true }),
    // schnell first: the UI defaults a provider to models[0], and schnell is
    // the fast/cheap default we want for exploration (dev is the quality option).
    models: [
      { id: "fal-ai/flux/schnell", label: "FLUX.1 [schnell]" },
      { id: "fal-ai/flux/dev", label: "FLUX.1 [dev]" },
    ],
    implemented: true,
    keyPlaceholder: "Paste your Fal API key…",
  },
  {
    id: "openai",
    label: "OpenAI",
    kind: "cloud",
    blurb: "GPT Image 1 · generate, edit, inpaint & outpaint",
    requiresKey: true,
    capabilities: caps({ txt2img: true, img2img: true, inpaint: true, outpaint: true }),
    models: [{ id: "gpt-image-1", label: "GPT Image 1" }],
    implemented: true,
    keyPlaceholder: "Paste your OpenAI API key…",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    kind: "cloud",
    blurb: "Nano Banana image models · Google AI Studio key",
    requiresKey: true,
    // styleRef: conditions natively on a custom style's reference pixels (v2).
    capabilities: caps({ txt2img: true, img2img: true, styleRef: true }),
    models: [
      { id: "gemini-2.5-flash-image", label: "Gemini 2.5 Flash Image" },
      { id: "gemini-3-pro-image", label: "Gemini 3 Pro Image" },
    ],
    implemented: true,
    keyPlaceholder: "Paste your Google AI Studio API key…",
  },
  {
    id: "comfyui",
    label: "ComfyUI",
    sublabel: "· local",
    kind: "local",
    blurb: "SD / SDXL / FLUX checkpoints, on-device",
    requiresKey: false,
    // v1 drives fixed txt2img / img2img / inpaint graphs; outpaint+ later.
    capabilities: caps({ txt2img: true, img2img: true, inpaint: true }),
    // Models are the instance's installed checkpoints — the providers route
    // fills this live; nothing meaningful to declare statically.
    models: [],
    implemented: true,
    connection: {
      field: "url",
      placeholder: "http://127.0.0.1:8188",
      defaultValue: "http://127.0.0.1:8188",
    },
  },
  {
    id: "mock",
    label: "Mock",
    sublabel: "· built-in",
    kind: "local",
    blurb: "Offline placeholder generator · no key needed",
    requiresKey: false,
    // Inpaint & outpaint composite through the mask (SVG), so Edit area and
    // Expand work offline; upscale echoes the source, so Upscale runs offline too.
    capabilities: caps({
      txt2img: true,
      img2img: true,
      inpaint: true,
      outpaint: true,
      upscale: true,
      // Native style refs pinned into the placeholder as a swatch, so v2 verifies offline.
      styleRef: true,
    }),
    models: [{ id: "mock-diffusion", label: "Mock Diffusion" }],
    implemented: true,
  },
];

export function catalogEntry(id: string): ProviderCatalogEntry | undefined {
  return PROVIDER_CATALOG.find((p) => p.id === id);
}
