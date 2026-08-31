import { create } from "zustand";
import type { CustomStyleInfo, UpdateStyleApiRequest } from "@latteart/shared";
import { createStyle, deleteStyle, fetchStyles, updateStyle } from "../api/styles";
import { extractPaletteHint, makeThumbnail } from "../lib/palette";
import { useProject } from "./projectStore";

/**
 * The user's custom style library — image-derived styles that compose into
 * generation prompts exactly like a built-in preset. Palette extraction and the
 * picker thumbnail are computed client-side (see ../lib/palette) and sent with
 * the create request; the descriptor itself is distilled server-side. The store
 * holds the FULL library, project-scoped styles included — visibility filtering
 * is the picker's job (see visibleStyles), so a project switch needs no refetch.
 */
interface StylesState {
  customStyles: CustomStyleInfo[];
  loaded: boolean;
  refresh: () => Promise<void>;
  /** Distill a new style from reference image data: URLs; returns its info so the
   * caller (the dialog) can select it. Throws with a user-facing message.
   * `scopeToProject` scopes it to the open project; false = global. */
  create: (
    images: string[],
    label: string | undefined,
    scopeToProject: boolean,
  ) => Promise<CustomStyleInfo>;
  /** Rename and/or edit a style's descriptor; replaces the entry in place.
   * Throws with a user-facing message. */
  update: (id: string, patch: UpdateStyleApiRequest) => Promise<CustomStyleInfo>;
  remove: (id: string) => Promise<void>;
}

export const useStyles = create<StylesState>((set) => ({
  customStyles: [],
  loaded: false,

  refresh: async () => {
    const list = await fetchStyles();
    set({ customStyles: list, loaded: true });
  },

  create: async (images, label, scopeToProject) => {
    const [paletteHint, thumbnail] = await Promise.all([
      extractPaletteHint(images),
      images[0] ? makeThumbnail(images[0]) : Promise.resolve(undefined),
    ]);
    const projectId = scopeToProject ? useProject.getState().id || undefined : undefined;
    const info = await createStyle({ images, paletteHint, label, thumbnail, projectId });
    set((s) => ({ customStyles: [info, ...s.customStyles] }));
    return info;
  },

  update: async (id, patch) => {
    const info = await updateStyle(id, patch);
    set((s) => ({ customStyles: s.customStyles.map((x) => (x.id === id ? info : x)) }));
    return info;
  },

  remove: async (id) => {
    await deleteStyle(id);
    set((s) => ({ customStyles: s.customStyles.filter((x) => x.id !== id) }));
  },
}));

/**
 * The styles one project's picker shows: every global style plus the ones
 * scoped to that project. The single visibility rule — every surface that lists
 * or resolves custom styles client-side goes through here, so "in the library
 * but not in this project" can't drift between the menu and the selection.
 */
export function visibleStyles(styles: CustomStyleInfo[], projectId: string): CustomStyleInfo[] {
  return styles.filter((s) => !s.projectId || s.projectId === projectId);
}
