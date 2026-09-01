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
  /** Re-fetch the library. Never rejects: a failure sets {@link refreshFailed},
   * keeps the current list, and arms a retry loop, since every caller treats it
   * as best-effort. */
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
  /** Delete a style. Throws with a user-facing message. */
  remove: (id: string) => Promise<void>;
}

/** Same cadence as projectStore's boot and save retries. Defined locally, not
 * imported: projectStore imports this store for its CRUD cascades, so the
 * dependency runs projectStore → stylesStore and importing back is a cycle. */
const RETRY_MS = 5000;
/** The pending refresh retry; one at a time, however many refreshes fail. */
let retryTimer: number | null = null;
/** Bumped by every local mutation (create/update/remove). A refresh whose
 * request predates the bump resolves against a list that no longer reflects
 * the library; replacing the list with it would drop the mutation — and for a
 * create whose style is selected, PromptBar's fallback would read the vanished
 * entry as deleted and persist a reset to "none". A stale success is discarded
 * and the refresh re-runs itself, so callers that await it still settle only
 * fresh-or-failed and the retry loop can't die on the discard path. */
let mutationSeq = 0;

export const useStyles = create<StylesState>((set, get) => ({
  customStyles: [],
  loaded: false,
  refreshFailed: false,

  refresh: async () => {
    const seq = mutationSeq;
    try {
      const list = await fetchStyles();
      // Stale — a mutation landed mid-flight. Re-run against the new seq
      // rather than bare-return: this settle path must still end fresh (set
      // below) or failed (catch), or an awaited guard refresh reads the old
      // list as current and a pending retry timer is never re-armed.
      if (seq !== mutationSeq) return get().refresh();
      // Any successful refresh — the online transition, a cascade's guard, this
      // loop itself — makes a pending retry redundant; cancelling it here is
      // deliberate, not a race.
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
        retryTimer = null;
      }
      set({ customStyles: list, loaded: true, refreshFailed: false });
    } catch {
      // Keep the current list and retry on a loop. Without the loop, a boot
      // fetch that fails while the backend is otherwise reachable left
      // `loaded: false` for the whole session — custom styles invisible in the
      // picker while a persisted selection kept composing server-side.
      set({ refreshFailed: true });
      if (retryTimer === null) {
        retryTimer = window.setTimeout(() => {
          retryTimer = null;
          void get().refresh();
        }, RETRY_MS);
      }
    }
  },

  create: async (images, label, projectId) => {
    const [paletteHint, thumbnail] = await Promise.all([
      extractPaletteHint(images),
      images[0] ? makeThumbnail(images[0]) : Promise.resolve(undefined),
    ]);
    const info = await createStyle({ images, paletteHint, label, thumbnail, projectId });
    mutationSeq++;
    set((s) => ({ customStyles: [info, ...s.customStyles] }));
    return info;
  },

  update: async (id, patch) => {
    const info = await updateStyle(id, patch);
    mutationSeq++;
    set((s) => ({ customStyles: s.customStyles.map((x) => (x.id === id ? info : x)) }));
    return info;
  },

  remove: async (id) => {
    await deleteStyle(id);
    mutationSeq++;
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
