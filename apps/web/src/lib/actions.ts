import { Eraser, Image as ImageIcon, LayoutGrid, Repeat2, type LucideIcon } from "lucide-react";

/** Editor actions that run img2img against a single source layer. */
export type ActionKind = "remix" | "remove-bg" | "change-bg" | "variations";

/** Single source of truth for per-action copy, icons, and prompt composition. */
export interface ActionMeta {
  icon: LucideIcon;
  /** Static action name for the drill-in header (e.g. "Remix"). */
  label: string;
  /** Progress-toast title while the action runs (e.g. `Remixing “Cat”…`). */
  title: (a: { sourceName: string; index: number; count: number }) => string;
  /** Uppercase label on the on-canvas working ring. */
  canvasLabel: string;
  /** Compose the img2img instruction from the (optional) user prompt. */
  prompt: (userPrompt: string) => string;
  /** Name for the produced layer. */
  layerName: (sourceName: string, index: number, count: number) => string;
}

export const ACTIONS: Record<ActionKind, ActionMeta> = {
  remix: {
    icon: Repeat2,
    label: "Remix",
    title: ({ sourceName }) => `Remixing “${sourceName}”…`,
    canvasLabel: "REMIXING",
    prompt: (userPrompt) => userPrompt,
    layerName: (sourceName) => `Remix of ${sourceName}`,
  },
  "remove-bg": {
    icon: Eraser,
    label: "Remove background",
    title: ({ sourceName }) => `Removing background of “${sourceName}”…`,
    canvasLabel: "REMOVING BG",
    prompt: () =>
      "Remove the background completely. Keep only the main subject, cleanly cut out, " +
      "on a fully transparent background (plain white if transparency is not possible). " +
      "Do not alter the subject.",
    layerName: (sourceName) => `${sourceName} — no background`,
  },
  "change-bg": {
    icon: ImageIcon,
    label: "Change background",
    title: ({ sourceName }) => `New background for “${sourceName}”…`,
    canvasLabel: "NEW BACKGROUND",
    prompt: (userPrompt) =>
      `Replace the background of this image with: ${userPrompt}. ` +
      "Keep the subject exactly as it is — same pose, lighting on the subject, and scale.",
    layerName: (sourceName) => `${sourceName} — new background`,
  },
  variations: {
    icon: LayoutGrid,
    label: "Variations",
    title: ({ sourceName, index, count }) =>
      count > 1
        ? `Variations of “${sourceName}”… (${index + 1}/${count})`
        : `Variation of “${sourceName}”…`,
    canvasLabel: "VARIATIONS",
    prompt: () =>
      "Create a variation of this image: keep the same subject, style, and overall " +
      "composition, but reinterpret the details so it reads as a fresh take.",
    layerName: (sourceName, index, count) =>
      count > 1 ? `Variation ${index + 1} of ${sourceName}` : `Variation of ${sourceName}`,
  },
};
