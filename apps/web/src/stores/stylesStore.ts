import { create } from "zustand";
import type { CustomStyleInfo, UpdateStyleApiRequest } from "@latteart/shared";
import { createStyle, deleteStyle, fetchStyles, updateStyle } from "../api/styles";
import { extractPaletteHint, makeThumbnail } from "../lib/palette";

/**
 * The user's custom style library — image-derived styles that compose into
 * generation prompts exactly like a built-in preset. Palette extraction and the
 * picker thumbnail are computed client-side (see ../lib/palette) and sent with
 * the create request; the descriptor itself is distilled server-side. The store
 * holds the FULL library, project-scoped styles included — visibility filtering
 * is the picker's job (see visibleStyles), so a project switch needs no refetch.
 * The list can still go stale when the library changes outside this store —
 * the duplicate/delete cascades rewrite it server-side, and a second tab can
 * add to it — so projectStore refreshes around duplicate, delete, and any
 * open whose incoming session selects a custom id this store doesn't know.
 */
interface StylesState {
  customStyles: CustomStyleInfo[];
  loaded: boolean;
  /** True while the LAST refresh attempt failed — the list may be stale, so
   * absence from it must not be read as deletion (see PromptBar's fallback).
   * Cleared by the next successful refresh. */
  refreshFailed: boolean;
  /** Re-fetch the library. Never rejects: a failure sets {@link refreshFailed}
   * and keeps the current list, since every caller treats it as best-effort. */
  refresh: () => Promise<void>;
  /** Distill a new style from reference image data: URLs; returns its info so the
   * caller (the dialog) can select it. Throws with a user-facing message.
   * `projectId` scopes it to that project; undefined = global. The caller passes
   * the id (not this store reading projectStore) so projectStore can import
   * this store for its duplicate/delete cascades without a cycle. */
  create: (
    images: string[],
    label: string | undefined,
    projectId: string | undefined,
  ) => Promise<CustomStyleInfo>;
  /** Rename and/or edit a style's descriptor; replaces the entry in place.
   * Throws with a user-facing message. */
  update: (id: string, patch: UpdateStyleApiRequest) => Promise<CustomStyleInfo>;
  remove: (id: string) => Promise<void>;
}

export const useStyles = create<StylesState>((set) => ({
  customStyles: [],
  loaded: false,
  refreshFailed: false,

  refresh: async () => {
    try {
      const list = await fetchStyles();
      set({ customStyles: list, loaded: true, refreshFailed: false });
    } catch {
      set({ refreshFailed: true });
    }
  },

  create: async (images, label, projectId) => {
    const [paletteHint, thumbnail] = await Promise.all([
      extractPaletteHint(images),
      images[0] ? makeThumbnail(images[0]) : Promise.resolve(undefined),
    ]);
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
 * scoped to that project. The single visibility rule — every surface that
 * DISPLAYS or selects custom styles goes through here, so "in the library but
 * not in this project" can't drift between the menu and the selection. One
 * deliberate non-consumer: openProject's staleness guard checks the FULL list,
 * because it asks "does the client know this id at all", not "is it visible".
 */
export function visibleStyles(styles: CustomStyleInfo[], projectId: string): CustomStyleInfo[] {
  return styles.filter((s) => !s.projectId || s.projectId === projectId);
}
