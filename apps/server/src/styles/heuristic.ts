import type { PaletteHint } from "@latteart/shared";

/**
 * Offline fallback for style distillation: compose a plain style descriptor from
 * a client-computed {@link PaletteHint} (dominant colors + mean brightness and
 * saturation). No network, no vision model — this is what keeps custom-style
 * creation working offline, mirroring the mock image/LLM providers. A reachable
 * vision model produces a far richer descriptor and supersedes this.
 */
export function heuristicDescriptor(hint?: PaletteHint): {
  prompt: string;
  negativePrompt?: string;
} {
  const colors = (hint?.colors ?? []).filter((c) => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 5);
  const parts: string[] = [];

  if (colors.length) {
    parts.push(`a color palette of ${colors.join(", ")}`);
  }

  const brightness = clamp01(hint?.brightness);
  if (brightness !== null) {
    if (brightness < 0.33) parts.push("dark, low-key tones");
    else if (brightness > 0.66) parts.push("bright, high-key tones");
    else parts.push("balanced mid-tones");
  }

  const saturation = clamp01(hint?.saturation);
  if (saturation !== null) {
    if (saturation < 0.25) parts.push("muted, desaturated");
    else if (saturation > 0.6) parts.push("vivid, saturated color");
    else parts.push("moderately saturated color");
  }

  // Nothing usable came through — a neutral, harmless descriptor still lets the
  // style exist rather than failing creation.
  const prompt = parts.length
    ? `matching this visual style: ${parts.join("; ")}`
    : "matching a cohesive, consistent visual style";

  return { prompt };
}

/** A finite 0..1 number, else null (so a missing/NaN stat is simply skipped). */
function clamp01(n: number | undefined): number | null {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return Math.min(1, Math.max(0, n));
}
