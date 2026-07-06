import { create } from "zustand";

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

/** Cross-cutting UI/session state: active provider+model, size, style, settings modal. */
interface SessionState {
  providerId: string;
  model: string | null;
  size: SizePreset;
  styleId: string;
  settingsOpen: boolean;
  setProvider: (id: string, model?: string | null) => void;
  setModel: (model: string) => void;
  setSize: (s: SizePreset) => void;
  setStyle: (styleId: string) => void;
  openSettings: () => void;
  closeSettings: () => void;
}

export const useSession = create<SessionState>((set) => ({
  providerId: "mock",
  model: "mock-diffusion",
  size: SIZE_PRESETS[0]!,
  styleId: "none",
  settingsOpen: false,
  setProvider: (id, model) => set({ providerId: id, model: model ?? null }),
  setModel: (model) => set({ model }),
  setSize: (size) => set({ size }),
  setStyle: (styleId) => set({ styleId }),
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
}));
