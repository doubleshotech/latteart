import { create } from "zustand";
import type { ProjectDoc, ProjectLayer, ProjectSummary } from "@latteart/shared";
import { makeLayer, useDocument } from "./documentStore";
import { SIZE_PRESETS, useSession } from "./sessionStore";
import { useViewport } from "./viewportStore";
import { resetHistory } from "./history";
import { useGeneration } from "./generationStore";
import { renderThumbnail } from "../lib/thumbnail";

/**
 * Projects + autosave. There is no save button: `initProjectSync()` opens the
 * last project from the backend on boot, then subscribes to the document,
 * viewport, and session stores and PUTs the whole document to
 * `/api/projects/<id>`, debounced. The only passive UI is the "Saving… /
 * Saved ✓" whisper in the topbar, driven by this store's `status`; the topbar's
 * project menu drives the switching and CRUD below.
 */

export type SaveStatus = "idle" | "saving" | "saved" | "error";

interface ProjectState {
  /** The open project. Empty only before the first load resolves. */
  id: string;
  name: string;
  createdAt: number;
  status: SaveStatus;
  savedAt: number | null;
  /** Every project on disk, newest-edited first — the switcher's list. */
  projects: ProjectSummary[];
  /** True while a switch/create/duplicate is swapping the document. */
  switching: boolean;
}

export const useProject = create<ProjectState>(() => ({
  id: "",
  name: "Untitled",
  createdAt: Date.now(),
  status: "idle",
  savedAt: null,
  projects: [],
  switching: false,
}));

/** Remembers the open project across reloads; falls back to most-recent. */
const LAST_PROJECT_KEY = "latteart.projectId";

function rememberProject(id: string) {
  try {
    window.localStorage.setItem(LAST_PROJECT_KEY, id);
  } catch {
    // Private mode / storage disabled — we just lose the "reopen last" nicety.
  }
}

function lastProjectId(): string | null {
  try {
    return window.localStorage.getItem(LAST_PROJECT_KEY);
  } catch {
    return null;
  }
}

const DEBOUNCE_MS = 1500;
const RETRY_MS = 5000;

/** The document as it goes over the wire. Transient state (generating
 * placeholders, progress, selection) is stripped; `updatedAt` is stamped by
 * the server and held at 0 here so snapshots of identical content compare
 * equal as strings. */
function snapshot(): ProjectDoc {
  const layers: ProjectLayer[] = useDocument
    .getState()
    .layers.filter((l) => l.status === "ready")
    .map((l) => ({
      id: l.id,
      name: l.name,
      visible: l.visible,
      opacity: l.opacity,
      x: l.x,
      y: l.y,
      width: l.width,
      height: l.height,
      rotation: l.rotation,
      src: l.src,
      prompt: l.prompt,
      derivedFrom: l.derivedFrom,
    }));
  const vp = useViewport.getState();
  const s = useSession.getState();
  const meta = useProject.getState();
  return {
    version: 1,
    id: meta.id,
    name: meta.name,
    createdAt: meta.createdAt,
    updatedAt: 0,
    layers,
    viewport: { scale: vp.scale, x: vp.x, y: vp.y },
    session: {
      providerId: s.providerId,
      model: s.model,
      size: { w: s.size.w, h: s.size.h, label: s.size.label },
      styleId: s.styleId,
      isolate: s.isolate,
      llmProviderId: s.llmProviderId,
    },
  };
}

let started = false;
let armed = false;
let timer: number | null = null;
/** changeKey() of what's persisted on disk (or the just-loaded doc). */
let savedKey = "";
let inFlight = false;
let pendingAgain = false;

/**
 * A cheap structural fingerprint of the saveable document — every persisted
 * field, but each layer's pixels represented by a short fingerprint instead of
 * the full base64. Change detection runs this on every store mutation, so it
 * must not stringify megabytes: a generation's progress ticks don't alter any
 * saveable field, so they produce an identical key and never reschedule the
 * debounce (which would otherwise postpone a pending save indefinitely).
 */
function changeKey(): string {
  const vp = useViewport.getState();
  const s = useSession.getState();
  const meta = useProject.getState();
  const parts: string[] = [
    `m:${meta.name}`,
    `v:${vp.scale}:${vp.x}:${vp.y}`,
    `s:${s.providerId}:${s.model}:${s.size.w}x${s.size.h}:${s.size.label}:${s.styleId}:${s.isolate}:${s.llmProviderId}`,
  ];
  for (const l of useDocument.getState().layers) {
    if (l.status !== "ready") continue;
    const src = l.src === null ? "0" : `${l.src.length}:${l.src.slice(-24)}`;
    parts.push(
      [
        l.id,
        l.name,
        l.visible ? 1 : 0,
        l.opacity,
        l.x,
        l.y,
        l.width,
        l.height,
        l.rotation,
        l.prompt ?? "",
        l.derivedFrom?.id ?? "",
        src,
      ].join("|"),
    );
  }
  return parts.join("\n");
}

function schedule(delay = DEBOUNCE_MS) {
  if (timer !== null) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    timer = null;
    void flush();
  }, delay);
}

async function flush() {
  const key = changeKey();
  if (key === savedKey) return; // nothing saveable changed
  if (inFlight) {
    // A save is already on the wire — run again when it settles.
    pendingAgain = true;
    return;
  }

  const doc = snapshot();
  // Pin the target: `await`s below let a switch land mid-save, and the id in
  // the store would then point at the *new* project. Everything after this
  // line refers to the project this body actually serialized.
  const id = doc.id;
  if (!id) return;

  inFlight = true;
  useProject.setState({ status: "saving" });
  try {
    doc.thumbnail = await renderThumbnail(doc.layers);
    const res = await fetch(`/api/projects/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(doc),
    });
    if (!res.ok) throw new Error(`save failed (${res.status})`);
    // Only claim "saved" if we're still on the project we saved — otherwise the
    // switch already reset savedKey for the newly opened document, and stamping
    // this key over it would mark the new project clean before it's been read.
    if (useProject.getState().id === id) {
      savedKey = key;
      useProject.setState({ status: "saved", savedAt: Date.now() });
    }
  } catch {
    // Backend unreachable or write failed — keep the dirty state and retry.
    if (useProject.getState().id === id) {
      useProject.setState({ status: "error" });
      schedule(RETRY_MS);
    }
  } finally {
    inFlight = false;
    if (pendingAgain) {
      pendingAgain = false;
      schedule();
    }
  }
}

/**
 * Best-effort save when the tab is hidden or unloading. Uses keepalive so the
 * request can outlive the page — unlike the normal path it does NOT defer when
 * a save is in flight (that deferral relies on a debounce timer that never
 * fires during unload, silently dropping the latest edits). Large image
 * payloads may exceed the browser's keepalive cap and be dropped; that's a
 * platform limit, but this is still strictly better than losing them to a
 * timer that won't run.
 */
function flushOnUnload() {
  if (timer !== null) {
    window.clearTimeout(timer);
    timer = null;
  }
  if (changeKey() === savedKey) return;
  const doc = snapshot();
  if (!doc.id) return;
  // No thumbnail on this path: rendering one is async, and awaiting it during
  // unload is exactly when the page stops running. The pixels matter more than
  // the preview, and the next normal save refreshes it.
  void fetch(`/api/projects/${doc.id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(doc),
    keepalive: true,
  }).catch(() => {});
}

function hydrate(doc: ProjectDoc, opts: { force?: boolean } = {}) {
  // The boot load is async; if the user already started editing during the
  // window, don't clobber their live work with the saved project. An explicit
  // switch forces through — replacing the document IS the intent there.
  if (!opts.force && useDocument.getState().layers.length > 0) return;

  useProject.setState({ id: doc.id, name: doc.name, createdAt: doc.createdAt });
  useDocument.setState({
    layers: doc.layers.map((l) => makeLayer({ ...l, status: "ready", progress: 100 })),
    selectedId: null,
  });
  useViewport.getState().setView(doc.viewport);

  const s = useSession.getState();
  s.setProvider(doc.session.providerId, doc.session.model);
  // Prefer the canonical preset object so the size picker shows it as active.
  const preset = SIZE_PRESETS.find((p) => p.w === doc.session.size.w && p.h === doc.session.size.h);
  s.setSize(preset ?? doc.session.size);
  s.setStyle(doc.session.styleId);
  s.setIsolate(doc.session.isolate ?? false);
  s.setLLMProvider(doc.session.llmProviderId ?? "auto");
}

/**
 * Boot the project layer: load the saved project into the stores, then start
 * autosaving. Idempotent (StrictMode mounts effects twice in dev).
 *
 * Autosave is armed ONLY after an authoritative read of the server's state. If
 * the boot load fails (backend restarting, network error), arming anyway would
 * let the first edit PUT a near-empty document over the real project and prune
 * its assets — so instead we retry the *load* and stay read-only until it
 * succeeds.
 */
export async function initProjectSync(): Promise<void> {
  if (started) return;
  started = true;
  await loadThenArm();
}

/**
 * Which project to open on boot: the one this browser had open, else the most
 * recently edited, else a fresh one. The stored id is only a hint — a project
 * deleted from another tab (or a wiped .data dir) falls through to the list.
 */
async function resolveBootProject(): Promise<ProjectDoc | null> {
  const list = await fetchProjects();

  const wanted = lastProjectId();
  const candidates = [
    ...(wanted && list.some((p) => p.id === wanted) ? [wanted] : []),
    ...(list[0] ? [list[0].id] : []),
  ];
  for (const id of candidates) {
    const res = await fetch(`/api/projects/${id}`);
    if (!res.ok) continue;
    const doc = (await res.json()) as ProjectDoc | null;
    if (doc) return doc;
  }

  // Nothing on disk yet — first run.
  if (list.length === 0) {
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Untitled" }),
    });
    if (res.ok) return (await res.json()) as ProjectDoc;
  }
  return null;
}

async function loadThenArm(): Promise<void> {
  let loaded = false;
  try {
    const doc = await resolveBootProject();
    if (doc) {
      hydrate(doc);
      rememberProject(doc.id);
      loaded = true;
    }
  } catch {
    // Backend not up yet.
  }

  if (!loaded) {
    // Unknown server state — do NOT arm autosave (a save could clobber a project
    // we merely failed to read). Retry the load; stay read-only until it lands.
    window.setTimeout(() => void loadThenArm(), RETRY_MS);
    return;
  }

  if (armed) return; // idempotent
  armed = true;

  // Don't save back what we just loaded.
  savedKey = changeKey();

  const onChange = () => {
    if (changeKey() !== savedKey) schedule();
  };
  useDocument.subscribe(onChange);
  useViewport.subscribe(onChange);
  useSession.subscribe(onChange);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushOnUnload();
  });
  window.addEventListener("pagehide", flushOnUnload);
}

/** Refresh the switcher's list. Failures leave the previous list in place. */
export async function fetchProjects(): Promise<ProjectSummary[]> {
  try {
    const res = await fetch("/api/projects");
    if (!res.ok) return useProject.getState().projects;
    const list = (await res.json()) as ProjectSummary[];
    useProject.setState({ projects: list });
    return list;
  } catch {
    return useProject.getState().projects;
  }
}

/**
 * Open another project.
 *
 * Order matters: save what's open *first* (autosave is debounced, so there is
 * almost always an unsaved edit sitting in the timer), then swap. The undo
 * stack and the change-detection baseline both belong to the outgoing document
 * and are reset, or the first edit in the new project would either resurrect
 * the old one's layers or be mistaken for "nothing changed".
 */
export async function switchProject(id: string): Promise<void> {
  const current = useProject.getState();
  if (id === current.id || current.switching) return;
  // A running job owns the document — it will drop its result onto whatever
  // layers exist when it lands. Same reason `busy` gates undo/redo. The menu
  // disables switching too; this is the backstop.
  if (useGeneration.getState().busy) return;

  useProject.setState({ switching: true });
  try {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
    await flush(); // persist the outgoing project before letting go of it

    const res = await fetch(`/api/projects/${id}`);
    if (!res.ok) throw new Error(`could not open project (${res.status})`);
    const doc = (await res.json()) as ProjectDoc | null;
    if (!doc) throw new Error("project not found");

    resetHistory();
    hydrate(doc, { force: true });
    rememberProject(doc.id);
    savedKey = changeKey(); // the freshly loaded doc is by definition clean
    useProject.setState({ status: "saved", savedAt: Date.now() });
    void fetchProjects();
  } finally {
    useProject.setState({ switching: false });
  }
}

/** Create a project and open it. */
export async function createProject(name?: string): Promise<void> {
  const res = await fetch("/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error("could not create the project");
  const doc = (await res.json()) as ProjectDoc;
  await switchProject(doc.id);
}

/** Rename a project. Renaming the open one updates the topbar in place. */
export async function renameProject(id: string, name: string): Promise<void> {
  const res = await fetch(`/api/projects/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error("could not rename the project");
  const doc = (await res.json()) as ProjectDoc;
  if (useProject.getState().id === id) {
    useProject.setState({ name: doc.name });
    // The name is part of changeKey(), so re-baseline: this rename is already
    // persisted, and leaving it dirty would trigger a redundant save.
    savedKey = changeKey();
  }
  await fetchProjects();
}

/** Copy a project (pixels and all) and open the copy. */
export async function duplicateProject(id: string): Promise<void> {
  if (id === useProject.getState().id) await flush(); // copy the latest state
  const res = await fetch(`/api/projects/${id}/duplicate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error("could not duplicate the project");
  const doc = (await res.json()) as ProjectDoc;
  await switchProject(doc.id);
}

/**
 * Delete a project. Deleting the open one moves to the next most recent, or to
 * a fresh project when it was the last one — the studio always has a document.
 */
export async function deleteProject(id: string): Promise<void> {
  const wasOpen = useProject.getState().id === id;
  const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("could not delete the project");

  if (!wasOpen) {
    await fetchProjects();
    return;
  }

  // The open project is gone; nothing left to save from it.
  if (timer !== null) {
    window.clearTimeout(timer);
    timer = null;
  }
  savedKey = changeKey();

  const list = await fetchProjects();
  const next = list.find((p) => p.id !== id);
  if (next) {
    // switchProject would try to save the deleted project first, so clear the
    // id to make the pending-save check a no-op before handing over.
    useProject.setState({ id: "" });
    await switchProject(next.id);
  } else {
    useProject.setState({ id: "" });
    await createProject("Untitled");
  }
}
