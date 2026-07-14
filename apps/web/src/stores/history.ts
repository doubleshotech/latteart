import { create } from "zustand";
import { useDocument, type Layer } from "./documentStore";
import { useGeneration } from "./generationStore";

/**
 * Undo/redo over the document store. Layers are plain immutable data, so a
 * history entry is just the `layers` array reference plus the selection —
 * unchanged layer objects (and their data-URL strings) are shared across
 * entries, which keeps 50 snapshots cheap.
 *
 * documentStore calls {@link record} at the top of each user mutation; undo/
 * redo restore via setState, which doesn't re-enter record. Generation is
 * undone as a unit: the placeholder-add entry is the "before generation"
 * state, progress/src updates are never recorded, and restoring resolves any
 * generating layer in a snapshot to its live counterpart (or drops it), so a
 * finished image survives undo of unrelated edits.
 */

interface Entry {
  layers: Layer[];
  selectedId: string | null;
}

const LIMIT = 50;
const COALESCE_MS = 1000;

let past: Entry[] = [];
let future: Entry[] = [];
let lastKey: string | null = null;
let lastAt = 0;

/** Reactive undo/redo availability for toolbar buttons. */
export const useHistory = create<{ canUndo: boolean; canRedo: boolean }>(() => ({
  canUndo: false,
  canRedo: false,
}));

function syncFlags() {
  useHistory.setState({ canUndo: past.length > 0, canRedo: future.length > 0 });
}

function snap(): Entry {
  const s = useDocument.getState();
  return { layers: s.layers, selectedId: s.selectedId };
}

/**
 * Push the current state as an undo point. A repeated `coalesceKey` within
 * the window folds continuous gestures (opacity slider) into one entry — the
 * first event's snapshot, holding the pre-gesture state, stays on the stack.
 */
export function record(coalesceKey?: string): void {
  const now = Date.now();
  const fold =
    coalesceKey !== undefined &&
    coalesceKey === lastKey &&
    now - lastAt < COALESCE_MS &&
    past.length > 0;
  if (!fold) {
    past.push(snap());
    if (past.length > LIMIT) past.shift();
  }
  lastKey = coalesceKey ?? null;
  lastAt = now;
  future = [];
  syncFlags();
}

/**
 * Snapshots taken mid-generation contain the placeholder; the job's outcome
 * shouldn't be un/redone by unrelated steps. Resolve each generating layer to
 * its live counterpart, or drop it if the job is gone.
 */
function sanitize(entry: Entry): Entry {
  const current = useDocument.getState().layers;
  const layers = entry.layers.flatMap((l) => {
    if (l.status !== "generating") return [l];
    const live = current.find((c) => c.id === l.id);
    return live ? [live] : [];
  });
  const selectedId =
    entry.selectedId && layers.some((l) => l.id === entry.selectedId) ? entry.selectedId : null;
  return { layers, selectedId };
}

/** Cheap deep-enough equality: unchanged layers share references, so field
 * compares hit the string-identity fast path. */
function equal(a: Entry, b: Entry): boolean {
  if (a.selectedId !== b.selectedId || a.layers.length !== b.layers.length) return false;
  return a.layers.every((la, i) => {
    const lb = b.layers[i]!;
    if (la === lb) return true;
    return (
      la.id === lb.id &&
      la.name === lb.name &&
      la.visible === lb.visible &&
      la.opacity === lb.opacity &&
      la.x === lb.x &&
      la.y === lb.y &&
      la.width === lb.width &&
      la.height === lb.height &&
      la.rotation === lb.rotation &&
      la.src === lb.src &&
      la.status === lb.status &&
      la.prompt === lb.prompt &&
      la.derivedFrom === lb.derivedFrom
    );
  });
}

/** Undo/redo is held while a job executes — a placeholder's add entry must not
 * be popped out from under a live stream. Jobs merely waiting in the queue
 * don't block: they re-resolve their source when they run and fail cleanly if
 * an undo removed it. */
function blocked(): boolean {
  return useGeneration.getState().busy;
}

/** Pop entries until one actually differs (failed-generation add/remove pairs
 * sanitize to no-ops), restore it, and stage the pre-step state for the
 * opposite direction. */
function step(from: Entry[], to: Entry[]): void {
  if (blocked()) return;
  const cur = snap();
  while (from.length > 0) {
    const entry = sanitize(from.pop()!);
    if (equal(entry, cur)) continue;
    to.push(cur);
    if (to.length > LIMIT) to.shift();
    useDocument.setState({ layers: entry.layers, selectedId: entry.selectedId });
    break;
  }
  lastKey = null; // an edit after undo/redo must start a fresh entry
  syncFlags();
}

export function undo(): void {
  step(past, future);
}

export function redo(): void {
  step(future, past);
}
