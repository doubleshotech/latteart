import { create } from "zustand";
import type { CustomStyleInfo } from "@latteart/shared";
import { createStyle, deleteStyle, fetchStyles } from "../api/styles";
import { extractPaletteHint, makeThumbnail } from "../lib/palette";

/**
 * The user's custom style library — image-derived styles that compose into
 * generation prompts exactly like a built-in preset. Palette extraction and the
 * picker thumbnail are computed client-side (see ../lib/palette) and sent with
 * the create request; the descriptor itself is distilled server-side.
 */
interface StylesState {
  customStyles: CustomStyleInfo[];
  loaded: boolean;
  refresh: () => Promise<void>;
  /** Distill a new style from reference image data: URLs; returns its info so the
   * caller (the dialog) can select it. Throws with a user-facing message. */
  create: (images: string[], label?: string) => Promise<CustomStyleInfo>;
  remove: (id: string) => Promise<void>;
}

export const useStyles = create<StylesState>((set) => ({
  customStyles: [],
  loaded: false,

  refresh: async () => {
    const list = await fetchStyles();
    set({ customStyles: list, loaded: true });
  },

  create: async (images, label) => {
    const [paletteHint, thumbnail] = await Promise.all([
      extractPaletteHint(images),
      images[0] ? makeThumbnail(images[0]) : Promise.resolve(undefined),
    ]);
    const info = await createStyle({ images, paletteHint, label, thumbnail });
    set((s) => ({ customStyles: [info, ...s.customStyles] }));
    return info;
  },

  remove: async (id) => {
    await deleteStyle(id);
    set((s) => ({ customStyles: s.customStyles.filter((x) => x.id !== id) }));
  },
}));
