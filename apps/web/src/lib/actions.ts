import {
  Eraser,
  Expand,
  Image as ImageIcon,
  LayoutGrid,
  Maximize2,
  Repeat2,
  SquareDashed,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import type { Provider } from "../api/client";

/** Editor actions that run against a single source layer (img2img, inpaint for
 * edit-area / smart-edit, an outpaint expand, or a prompt-less resolution
 * upscale). */
export type ActionKind =
  | "remix"
  | "remove-bg"
  | "change-bg"
  | "variations"
  | "edit-area"
  | "smart-edit"
  | "outpaint"
  | "upscale";

/** Actions that inpaint (a mask + `mode:"inpaint"`) rather than whole-image
 * img2img: the result overlays the source exactly and only the masked region
 * regenerates. `edit-area` paints its mask; `smart-edit` derives it from the
 * RMBG matte. */
export function isInpaintKind(kind: ActionKind): boolean {
  return kind === "edit-area" || kind === "smart-edit";
}

/** Why inpaint is unavailable for `active`, or null when it can inpaint. Shared
 * by every inpaint entry point (Edit area, Smart edit) so the copy lives once. */
export function inpaintBlockedNote(active: Provider | undefined): string | null {
  if (!active?.available) return "Connect a provider in Settings";
  if (!active.capabilities.inpaint) return `${active.label} can't inpaint — try ComfyUI or OpenAI`;
  return null;
}

/** Why upscale is unavailable for `active`, or null when it can upscale. */
export function upscaleBlockedNote(active: Provider | undefined): string | null {
  if (!active?.available) return "Connect a provider in Settings";
  if (!active.capabilities.upscale) return `${active.label} can't upscale — try Fal.ai`;
  return null;
}

/** Why outpaint (Expand) is unavailable for `active`, or null when it can. */
export function outpaintBlockedNote(active: Provider | undefined): string | null {
  if (!active?.available) return "Connect a provider in Settings";
  if (!active.capabilities.outpaint) return `${active.label} can't expand — try OpenAI or Mock`;
  return null;
}

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
  "edit-area": {
    icon: SquareDashed,
    label: "Edit area",
    title: ({ sourceName }) => `Editing area of “${sourceName}”…`,
    canvasLabel: "EDITING AREA",
    // Inpaint: the composed prompt describes what fills the masked region.
    prompt: (userPrompt) => userPrompt,
    layerName: (sourceName) => `${sourceName} — edited area`,
  },
  "smart-edit": {
    icon: Wand2,
    label: "Smart edit",
    title: ({ sourceName }) => `Smart-editing “${sourceName}”…`,
    canvasLabel: "SMART EDIT",
    // Inpaint with an auto-derived mask; the prompt describes the region fill.
    prompt: (userPrompt) => userPrompt,
    layerName: (sourceName) => `${sourceName} — smart edit`,
  },
  outpaint: {
    icon: Expand,
    label: "Outpaint",
    title: ({ sourceName }) => `Expanding “${sourceName}”…`,
    canvasLabel: "EXPANDING",
    // Masked fill of the new border region. The user prompt (optional) describes
    // what to add; otherwise steer the model to extend the existing scene.
    prompt: (userPrompt) =>
      userPrompt
        ? `Extend this image outward into the surrounding empty area with: ${userPrompt}. ` +
          "Continue the scene seamlessly — match the perspective, lighting, colors, and " +
          "style of the original so the new border blends invisibly."
        : "Extend this image outward to fill the surrounding empty area. Continue the existing " +
          "scene seamlessly in every direction — match the perspective, lighting, colors, and " +
          "style so the new border blends invisibly with the original.",
    layerName: (sourceName) => `${sourceName} — expanded`,
  },
  upscale: {
    icon: Maximize2,
    label: "Upscale",
    title: ({ sourceName }) => `Upscaling “${sourceName}”…`,
    canvasLabel: "UPSCALING",
    // Prompt-less: upscale runs through /api/upscale, not the edit prompt path.
    prompt: () => "",
    layerName: (sourceName) => `${sourceName} — upscaled`,
  },
};
