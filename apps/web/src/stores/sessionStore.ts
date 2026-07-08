import { create } from "zustand";
import type { ActionKind } from "../lib/actions";

export interface SizePreset {
  w: number;
  h: number;
  label: string;
}

export const SIZE_PRESETS: SizePreset[] = [
  { w: 1024, h: 1024, label: "1024²" },
  { w: 1536, h: 1024, label: "1536×1024" },
  { w: 1024, h: 1536, label: "1024×1536" },
  { w: 768, h: 768, label: "768²" },
  { w: 512, h: 512, label: "512²" },
];

/** Editor actions that open a drill-in panel over the layer panel. */
export type ActionViewKind = Exclude<ActionKind, "remove-bg">;

export interface ActionView {
  kind: ActionViewKind;
  sourceId: string;
}

/** Cross-cutting UI/session state: active provider+model, size, style, settings modal. */
interface SessionState {
  providerId: string;
  model: string | null;
  size: SizePreset;
  styleId: string;
  /** "Cutout" toggle: generate the subject on a flat background and auto-remove
   * it, so the layer lands transparent and stacks cleanly. */
  isolate: boolean;
  settingsOpen: boolean;
  /** Open drill-in in the layer panel (Remix / Change background / Variations). */
  actionView: ActionView | null;
  /** Edit-area (inpaint) mask editor over the canvas, for a given source layer. */
  maskEdit: { sourceId: string } | null;
  setProvider: (id: string, model?: string | null) => void;
  setModel: (model: string) => void;
  setSize: (s: SizePreset) => void;
  setStyle: (styleId: string) => void;
  setIsolate: (isolate: boolean) => void;
  openSettings: () => void;
  closeSettings: () => void;
  openAction: (kind: ActionViewKind, sourceId: string) => void;
  closeAction: () => void;
  openMaskEdit: (sourceId: string) => void;
  closeMaskEdit: () => void;
}

export const useSession = create<SessionState>((set) => ({
  providerId: "mock",
  model: "mock-diffusion",
  size: SIZE_PRESETS[0]!,
  styleId: "none",
  isolate: false,
  settingsOpen: false,
  actionView: null,
  maskEdit: null,
  setProvider: (id, model) => set({ providerId: id, model: model ?? null }),
  setModel: (model) => set({ model }),
  setSize: (size) => set({ size }),
  setStyle: (styleId) => set({ styleId }),
  setIsolate: (isolate) => set({ isolate }),
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  openAction: (kind, sourceId) => set({ actionView: { kind, sourceId }, maskEdit: null }),
  closeAction: () => set({ actionView: null }),
  openMaskEdit: (sourceId) => set({ maskEdit: { sourceId }, actionView: null }),
  closeMaskEdit: () => set({ maskEdit: null }),
}));
