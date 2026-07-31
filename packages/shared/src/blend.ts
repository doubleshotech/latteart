/**
 * Layer blend modes — how a layer composites onto the layers beneath it.
 *
 * Ids are canvas/CSS blend-mode names, so one value drives every surface that
 * composites: Konva's `globalCompositeOperation` on the editor canvas, and
 * `ctx.globalCompositeOperation` in the flatten/thumbnail compositors. "Normal"
 * is the one mode surfaces treat specially — it maps to canvas's "source-over"
 * and it's the case where compositing chrome stays on — so both halves of that
 * rule live here, in {@link compositeOperation} and {@link isBlended}, rather
 * than being re-spelled at each call site.
 *
 * Extensibility contract: adding a mode = appending one entry to BLEND_MODES —
 * the `BlendMode` type, the picker and the label lookup all derive from it.
 */

export interface BlendModeOption {
  id: string;
  label: string;
  /** Picker section header; entries sharing a group must be adjacent. */
  group: string;
}

export const BLEND_MODES = [
  { id: "normal", label: "Normal", group: "Normal" },

  { id: "multiply", label: "Multiply", group: "Darken" },
  { id: "darken", label: "Darken", group: "Darken" },
  { id: "color-burn", label: "Color burn", group: "Darken" },

  { id: "screen", label: "Screen", group: "Lighten" },
  { id: "lighten", label: "Lighten", group: "Lighten" },
  { id: "color-dodge", label: "Color dodge", group: "Lighten" },

  { id: "overlay", label: "Overlay", group: "Contrast" },
  { id: "soft-light", label: "Soft light", group: "Contrast" },
  { id: "hard-light", label: "Hard light", group: "Contrast" },

  { id: "difference", label: "Difference", group: "Comparative" },
  { id: "exclusion", label: "Exclusion", group: "Comparative" },

  { id: "hue", label: "Hue", group: "Component" },
  { id: "saturation", label: "Saturation", group: "Component" },
  { id: "color", label: "Color", group: "Component" },
  { id: "luminosity", label: "Luminosity", group: "Component" },
] as const satisfies readonly BlendModeOption[];

export type BlendMode = (typeof BLEND_MODES)[number]["id"];

export const DEFAULT_BLEND_MODE: BlendMode = "normal";

/**
 * The canvas `globalCompositeOperation` for a blend mode. Absent/unset means
 * normal, so layers saved before blend modes existed composite as they always
 * did. Every literal here is a member of the DOM's GlobalCompositeOperation
 * union, so the result assigns straight onto a 2D context or a Konva node.
 */
export function compositeOperation(
  mode: BlendMode | null | undefined,
): Exclude<BlendMode, "normal"> | "source-over" {
  return !mode || mode === "normal" ? "source-over" : mode;
}

/**
 * Whether a layer composites through the stack rather than painting straight
 * over it. Canvas chrome that would sit between a layer and its backdrop (the
 * transparency checkerboard, the drop shadow) has to step aside when this is
 * true, or the blend resolves against the chrome instead of the real stack.
 */
export function isBlended(mode: BlendMode | null | undefined): boolean {
  return compositeOperation(mode) !== "source-over";
}

/** Guards a value read from disk — an unknown id must not reach a surface. */
export function isBlendMode(value: unknown): value is BlendMode {
  return BLEND_MODES.some((b) => b.id === value);
}

const LABELS: Record<BlendMode, string> = Object.fromEntries(
  BLEND_MODES.map((b) => [b.id, b.label]),
) as Record<BlendMode, string>;

/** Display label for a mode id. Ids are validated on load, so this is total. */
export function blendLabel(mode: BlendMode | null | undefined): string {
  return LABELS[mode ?? DEFAULT_BLEND_MODE];
}
