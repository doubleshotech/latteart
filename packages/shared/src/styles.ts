/**
 * Image style presets — prompt-modifier data applied at generation time.
 *
 * Extensibility contract: adding a style = appending one StylePreset to
 * STYLE_PRESETS below. The web picker, the server-side prompt composition,
 * and request validation all derive from this array; nothing else changes.
 *
 * Styles are pure data (no runtime behavior), so they live in shared and are
 * imported by both the web UI (picker) and the server (composition). A future
 * provider with a native style parameter can map `GenerateRequest.styleId`
 * directly instead of relying on the composed prompt.
 */

export interface StylePreset {
  id: string;
  label: string;
  /** Short subtitle shown under the label in the picker. */
  blurb?: string;
  /** Fragment composed into the prompt. Empty = passthrough. */
  prompt: string;
  /** Fragment comma-merged into the request's negativePrompt. */
  negativePrompt?: string;
}

export const STYLE_PRESETS: StylePreset[] = [
  {
    id: "none",
    label: "None",
    blurb: "Prompt goes through untouched",
    prompt: "",
  },
  {
    id: "photoreal",
    label: "Photorealistic",
    blurb: "Natural light, camera-real detail",
    prompt:
      "photorealistic, natural lighting, shot on a full-frame camera, sharp focus, fine detail",
    negativePrompt: "illustration, painting, cartoon, 3d render",
  },
  {
    id: "cinematic",
    label: "Cinematic",
    blurb: "Film still, moody color grade",
    prompt: "cinematic film still, dramatic lighting, shallow depth of field, moody color grade",
    negativePrompt: "flat lighting, cartoon",
  },
  {
    id: "anime",
    label: "Anime",
    blurb: "Cel shading, clean line art",
    prompt: "anime illustration, clean line art, cel shading, vibrant colors, detailed background",
    negativePrompt: "photorealistic, 3d render",
  },
  {
    id: "watercolor",
    label: "Watercolor",
    blurb: "Soft washes, paper texture",
    prompt:
      "soft watercolor painting, wet-on-wet washes, visible paper texture, delicate pigment blooms",
    negativePrompt: "photo, hard edges",
  },
  {
    id: "oil",
    label: "Oil painting",
    blurb: "Visible brushstrokes, impasto",
    prompt: "classical oil painting, visible brushstrokes, impasto texture, rich color depth",
    negativePrompt: "photo, digital, flat",
  },
  {
    id: "render3d",
    label: "3D render",
    blurb: "PBR materials, studio light",
    prompt:
      "polished 3D render, physically based materials, soft studio lighting, subtle depth of field",
    negativePrompt: "photo, 2d, flat illustration",
  },
  {
    id: "pixel",
    label: "Pixel art",
    blurb: "16-bit palette, crisp pixels",
    prompt: "retro pixel art, 16-bit palette, crisp pixels, no anti-aliasing",
    negativePrompt: "blurry, smooth gradients, photorealistic",
  },
  {
    id: "lineart",
    label: "Line art",
    blurb: "Ink strokes on white",
    prompt: "black ink line art, clean confident pen strokes, minimal shading, white background",
    negativePrompt: "color, photo, shading",
  },
  {
    id: "flat",
    label: "Flat illustration",
    blurb: "Vector shapes, bold color",
    prompt: "flat vector illustration, geometric shapes, bold solid colors, minimal detail",
    negativePrompt: "photo, texture, gradients, 3d",
  },
  {
    id: "isometric",
    label: "Isometric",
    blurb: "Clean 3D at a tilt",
    prompt: "isometric 3D illustration, clean geometry, soft ambient shadows, uniform perspective",
    negativePrompt: "photo, fisheye, flat front view",
  },
];

export function stylePreset(id: string): StylePreset | undefined {
  return STYLE_PRESETS.find((s) => s.id === id);
}

/** The minimal shape a style contributes to composition: a prompt fragment and
 * an optional negative fragment. Both {@link StylePreset} and a user's custom
 * style (resolved server-side) satisfy it, so both compose through one path. */
export interface StyleFragment {
  prompt: string;
  negativePrompt?: string;
}

/**
 * Compose a resolved style fragment into a prompt + negativePrompt pair. A
 * missing or empty fragment passes both through untouched. This is the single
 * composition primitive — presets and custom styles both flow through it; only
 * how the fragment is *resolved* (constant array vs. server store) differs.
 */
export function composeStyle(
  prompt: string,
  fragment?: StyleFragment,
  negativePrompt?: string,
): { prompt: string; negativePrompt?: string } {
  if (!fragment?.prompt) return { prompt, negativePrompt };
  const styled = `${prompt.replace(/[.\s]+$/, "")}. Style: ${fragment.prompt}.`;
  const negative =
    [negativePrompt, fragment.negativePrompt].filter(Boolean).join(", ") || undefined;
  return { prompt: styled, negativePrompt: negative };
}

/**
 * Compose a style *preset* into a prompt + negativePrompt pair. Unknown or
 * empty styles pass both through untouched. Thin wrapper over
 * {@link composeStyle} that resolves the id against {@link STYLE_PRESETS}.
 */
export function applyStyle(
  prompt: string,
  styleId?: string,
  negativePrompt?: string,
): { prompt: string; negativePrompt?: string } {
  return composeStyle(prompt, styleId ? stylePreset(styleId) : undefined, negativePrompt);
}
