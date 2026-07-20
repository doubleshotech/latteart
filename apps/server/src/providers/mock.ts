import { noCapabilities } from "@latteart/shared";
import type {
  EditRequest,
  GenResult,
  GenerateRequest,
  ImageProvider,
  ModelInfo,
  ProviderContext,
  UpscaleRequest,
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

/**
 * Inset "style ref" swatch — the offline tell that native style-reference pixels
 * (custom styles v2) reached the provider. A real styleRef provider (Gemini)
 * conditions the whole output on the reference; the mock can't diffuse, so it
 * pins the first reference into the corner instead, proving the pixels made it
 * through the route. Empty string when there's no ref, so it drops out.
 */
function styleRefSwatch(styleRef: string | undefined, width: number): string {
  if (!styleRef) return "";
  const sw = Math.round(width * 0.22);
  const pad = Math.round(width * 0.035);
  const x = width - sw - pad;
  const cap = Math.round(width * 0.022);
  return `<g>
    <rect x="${x - 3}" y="${pad - 3}" width="${sw + 6}" height="${sw + cap + 9}" rx="7" fill="#000" fill-opacity="0.4"/>
    <image href="${escapeXml(styleRef)}" x="${x}" y="${pad}" width="${sw}" height="${sw}" preserveAspectRatio="xMidYMid slice"/>
    <rect x="${x}" y="${pad}" width="${sw}" height="${sw}" rx="4" fill="none" stroke="#fff" stroke-opacity="0.85" stroke-width="2"/>
    <text x="${x + sw / 2}" y="${pad + sw + cap + 1}" text-anchor="middle" font-family="ui-monospace, monospace" font-size="${cap}" fill="#fff" fill-opacity="0.8">style ref</text>
  </g>`;
}

/** A neon-gradient placeholder, colored from the prompt — no network, no model.
 * `styleRef` (optional) is a native style-reference image pinned into the corner
 * so the styleRef path verifies offline. */
function placeholderSvg(
  prompt: string,
  width: number,
  height: number,
  seed: number,
  styleRef?: string,
): string {
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
  ${styleRefSwatch(styleRef, width)}
</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

/**
 * Masked-fill placeholder: the original image with only the masked region
 * replaced by a bright gradient. An SVG luminance mask (white in the PNG =
 * regenerate) composites the fill over the source, so the mock genuinely honors
 * the mask — letting inpaint *and* outpaint verify offline without a raster
 * library. For outpaint the "source" is the original padded onto a larger
 * transparent canvas and the mask marks that new padding, so the gradient fills
 * the expansion while the original pixels show through untouched. A native style
 * ref (custom styles v2) is pinned in as a swatch, same as the plain path.
 */
function inpaintSvg(
  prompt: string,
  image: string,
  mask: string,
  width: number,
  height: number,
  seed: number,
  styleRef?: string,
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
  ${styleRefSwatch(styleRef, width)}
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
  // Inpaint & outpaint are honored via SVG mask compositing (see edit()), so the
  // whole edit-area / expand flow verifies offline on the default provider.
  // img2img still emits a fresh placeholder. Upscale (see upscale()) echoes the
  // source so the Upscale action runs end-to-end offline too.
  capabilities: {
    ...noCapabilities(),
    txt2img: true,
    img2img: true,
    inpaint: true,
    outpaint: true,
    upscale: true,
    // Native style refs are pinned into the output as a swatch (see
    // placeholderSvg), so custom styles v2 verifies offline on the default provider.
    styleRef: true,
  },

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
          dataUrl: placeholderSvg(req.prompt, req.width, req.height, seed, req.styleRefs?.[0]),
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
   * remix similarity stops stay distinguishable offline); inpaint and outpaint
   * composite a gradient fill over the source through the mask, so only the
   * masked region changes — a faithful offline stand-in. Outpaint's source is
   * the original padded onto the expanded canvas, so the fill lands in the new
   * area and the original pixels show through untouched.
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

    const masked =
      (req.mode === "inpaint" || req.mode === "outpaint") &&
      !!req.mask &&
      req.image.startsWith("data:");
    const dataUrl = masked
      ? inpaintSvg(req.prompt, req.image, req.mask!, width, height, seed, req.styleRefs?.[0])
      : placeholderSvg(`edit · ${req.prompt}`, width, height, seed, req.styleRefs?.[0]);

    return {
      id: crypto.randomUUID(),
      images: [{ dataUrl, width, height }],
      provider: "mock",
      model: req.model ?? "mock-diffusion",
      seed,
      createdAt: Date.now(),
    };
  },

  /**
   * Mock upscale. A real upscaler adds pixels while the image looks the same at
   * display size, so the honest offline stand-in echoes the source back — the
   * whole Upscale action (progress, cancel, new derived layer) still exercises
   * end-to-end with no key and no raster library. `width`/`height` are reported
   * as 0: the source's true pixel size isn't known without decoding the data
   * URL, and it doesn't matter — the caller keeps the layer's on-canvas footprint.
   */
  async upscale(
    req: UpscaleRequest,
    ctx: ProviderContext,
    signal?: AbortSignal,
  ): Promise<GenResult> {
    const totalSteps = 12;
    for (let step = 1; step <= totalSteps; step++) {
      await delay(60, signal);
      ctx.onProgress?.(Math.round((step / totalSteps) * 100), { step, totalSteps });
    }
    return {
      id: crypto.randomUUID(),
      images: [{ dataUrl: req.image, width: 0, height: 0 }],
      provider: "mock",
      model: req.model ?? "mock-upscale",
      createdAt: Date.now(),
    };
  },
};
