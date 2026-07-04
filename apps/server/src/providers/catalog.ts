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
    blurb: "FLUX, SDXL, LoRAs · fast cloud",
    requiresKey: true,
    capabilities: caps({
      txt2img: true,
      img2img: true,
      inpaint: true,
      transparentLayers: true,
      upscale: true,
    }),
    models: [
      { id: "fal-ai/flux/dev", label: "FLUX.1 [dev]" },
      { id: "fal-ai/flux/schnell", label: "FLUX.1 [schnell]" },
    ],
    implemented: false,
    keyPlaceholder: "Paste your Fal API key…",
  },
  {
    id: "openai",
    label: "OpenAI",
    kind: "cloud",
    blurb: "GPT Image 1 · DALL·E 3",
    requiresKey: true,
    capabilities: caps({ txt2img: true, inpaint: true }),
    models: [{ id: "gpt-image-1", label: "GPT Image 1" }],
    implemented: false,
    keyPlaceholder: "Paste your OpenAI API key…",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    kind: "cloud",
    blurb: "Nano Banana image models · Google AI Studio key",
    requiresKey: true,
    capabilities: caps({ txt2img: true }),
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
    blurb: "Your own workflows, on-device",
    requiresKey: false,
    capabilities: caps({
      txt2img: true,
      img2img: true,
      inpaint: true,
      outpaint: true,
      transparentLayers: true,
      upscale: true,
    }),
    models: [{ id: "default", label: "Active workflow" }],
    implemented: false,
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
    capabilities: caps({ txt2img: true }),
    models: [{ id: "mock-diffusion", label: "Mock Diffusion" }],
    implemented: true,
  },
];

export function catalogEntry(id: string): ProviderCatalogEntry | undefined {
  return PROVIDER_CATALOG.find((p) => p.id === id);
}
