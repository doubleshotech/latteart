import { noCapabilities } from "@latteart/shared";
import type {
  EditRequest,
  GenResult,
  GenerateRequest,
  ImageProvider,
  ModelInfo,
  ProviderContext,
} from "@latteart/shared";

/** Deterministic 32-bit FNV-1a hash so a prompt always maps to the same look. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

function escapeXml(s: string): string {
  return s.replace(
    /[<>&'"]/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c] ?? c,
  );
}

/** A neon-gradient placeholder, colored from the prompt — no network, no model. */
function placeholderSvg(prompt: string, width: number, height: number, seed: number): string {
  const h1 = (hash(prompt) + seed) % 360;
  const h2 = (h1 + 55) % 360;
  const h3 = (h1 + 210) % 360;
  const label = (prompt.trim() || "untitled").slice(0, 48);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <radialGradient id="a" cx="32%" cy="28%" r="78%">
      <stop offset="0%" stop-color="hsl(${h1} 72% 62%)"/>
      <stop offset="55%" stop-color="hsl(${h2} 55% 30%)"/>
      <stop offset="100%" stop-color="hsl(${h3} 48% 11%)"/>
    </radialGradient>
    <radialGradient id="b" cx="74%" cy="78%" r="55%">
      <stop offset="0%" stop-color="hsl(${h3} 85% 60%)" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="hsl(${h3} 85% 60%)" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="v" x1="0" y1="0" x2="0" y2="1">
      <stop offset="52%" stop-color="#000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0.5"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="#12141a"/>
  <rect width="100%" height="100%" fill="url(#a)"/>
  <rect width="100%" height="100%" fill="url(#b)"/>
  <rect width="100%" height="100%" fill="url(#v)"/>
  <g font-family="ui-monospace, monospace" fill="#ffffff">
    <text x="6%" y="90%" font-size="${Math.round(width * 0.03)}" font-weight="500" fill-opacity="0.92">${escapeXml(label)}</text>
    <text x="6%" y="95%" font-size="${Math.round(width * 0.021)}" fill-opacity="0.6">mock · ${width}×${height}</text>
  </g>
</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

/**
 * Inpaint placeholder: the original image with only the masked region replaced
 * by a bright gradient. An SVG luminance mask (white in the PNG = regenerate)
 * composites the fill over the source, so the mock genuinely honors the mask —
 * letting the whole inpaint flow verify offline without a raster library.
 */
function inpaintSvg(
  prompt: string,
  image: string,
  mask: string,
  width: number,
  height: number,
  seed: number,
): string {
  const h1 = (hash(prompt) + seed) % 360;
  const h2 = (h1 + 55) % 360;
  const h3 = (h1 + 210) % 360;
  // Both the source and the mask stretch to the output box (preserveAspectRatio
  // "none") so they line up even though the mask is at the source's native size.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <mask id="edit" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}">
      <image href="${escapeXml(mask)}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none"/>
    </mask>
    <radialGradient id="fill" cx="50%" cy="40%" r="80%">
      <stop offset="0%" stop-color="hsl(${h1} 82% 64%)"/>
      <stop offset="60%" stop-color="hsl(${h2} 62% 42%)"/>
      <stop offset="100%" stop-color="hsl(${h3} 55% 24%)"/>
    </radialGradient>
  </defs>
  <image href="${escapeXml(image)}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none"/>
  <rect width="100%" height="100%" fill="url(#fill)" mask="url(#edit)"/>
</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

/**
 * Built-in offline provider. Fully implements {@link ImageProvider} so the
 * end-to-end generate→layer loop works with zero keys and zero network — real
 * cloud/local providers are drop-in replacements behind the same interface.
 */
export const mockProvider: ImageProvider = {
  id: "mock",
  label: "Mock",
  kind: "local",
  requiresKey: false,
  // Inpaint honored via SVG mask compositing (see edit()), so the whole
  // edit-area flow verifies offline on the default provider. img2img still
  // emits a fresh placeholder.
  capabilities: { ...noCapabilities(), txt2img: true, img2img: true, inpaint: true },

  async listModels(): Promise<ModelInfo[]> {
    return [{ id: "mock-diffusion", label: "Mock Diffusion" }];
  },

  async generate(
    req: GenerateRequest,
    ctx: ProviderContext,
    signal?: AbortSignal,
  ): Promise<GenResult> {
    const totalSteps = 24;
    const seed = req.seed ?? hash(req.prompt) % 100000;

    // Simulate a diffusion run so the progress + cancel paths are exercised.
    for (let step = 1; step <= totalSteps; step++) {
      await delay(70, signal);
      ctx.onProgress?.(Math.round((step / totalSteps) * 100), {
        step,
        totalSteps,
      });
    }

    return {
      id: crypto.randomUUID(),
      images: [
        {
          dataUrl: placeholderSvg(req.prompt, req.width, req.height, seed),
          width: req.width,
          height: req.height,
        },
      ],
      provider: "mock",
      model: req.model ?? "mock-diffusion",
      seed,
      createdAt: Date.now(),
    };
  },

  /**
   * Mock edit. img2img emits a fresh placeholder (strength shifts the palette so
   * remix similarity stops stay distinguishable offline); inpaint composites a
   * gradient fill over the source through the mask, so only the painted region
   * changes — a faithful offline stand-in for a real inpaint.
   */
  async edit(req: EditRequest, ctx: ProviderContext, signal?: AbortSignal): Promise<GenResult> {
    const totalSteps = 24;
    const strength = req.strength ?? 0.5;
    const seed = (req.seed ?? hash(req.prompt) % 100000) + Math.round(strength * 360);
    const width = req.width ?? 1024;
    const height = req.height ?? 1024;

    for (let step = 1; step <= totalSteps; step++) {
      await delay(70, signal);
      ctx.onProgress?.(Math.round((step / totalSteps) * 100), {
        step,
        totalSteps,
      });
    }

    const inpaint = req.mode === "inpaint" && !!req.mask && req.image.startsWith("data:");
    const dataUrl = inpaint
      ? inpaintSvg(req.prompt, req.image, req.mask!, width, height, seed)
      : placeholderSvg(`edit · ${req.prompt}`, width, height, seed);

    return {
      id: crypto.randomUUID(),
      images: [{ dataUrl, width, height }],
      provider: "mock",
      model: req.model ?? "mock-diffusion",
      seed,
      createdAt: Date.now(),
    };
  },
};
