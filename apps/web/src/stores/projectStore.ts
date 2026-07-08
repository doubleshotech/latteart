import { create } from "zustand";
import type { ProjectDoc, ProjectLayer } from "@latteart/shared";
import { makeLayer, useDocument } from "./documentStore";
import { SIZE_PRESETS, useSession } from "./sessionStore";
import { useViewport } from "./viewportStore";

/**
 * Project autosave. There is no save button: `initProjectSync()` hydrates the
 * last-open project from the backend on boot, then subscribes to the document,
 * viewport, and session stores and PUTs the whole document to `/api/project`,
 * debounced. The only UI is the "Saving… / Saved ✓" whisper in the topbar,
 * driven by this store's `status`.
 */

export type SaveStatus = "idle" | "saving" | "saved" | "error";

interface ProjectState {
  /** v1: single implicit project — name has no UI yet, but survives on disk. */
  name: string;
  createdAt: number;
  status: SaveStatus;
  savedAt: number | null;
}

export const useProject = create<ProjectState>(() => ({
  name: "Untitled",
  createdAt: Date.now(),
  status: "idle",
  savedAt: null,
}));

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
    id: "default",
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
    `s:${s.providerId}:${s.model}:${s.size.w}x${s.size.h}:${s.size.label}:${s.styleId}:${s.isolate}`,
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

  inFlight = true;
  useProject.setState({ status: "saving" });
  try {
    const res = await fetch("/api/project", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(snapshot()),
    });
    if (!res.ok) throw new Error(`save failed (${res.status})`);
    savedKey = key;
    useProject.setState({ status: "saved", savedAt: Date.now() });
  } catch {
    // Backend unreachable or write failed — keep the dirty state and retry.
    useProject.setState({ status: "error" });
    schedule(RETRY_MS);
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
  void fetch("/api/project", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(snapshot()),
    keepalive: true,
  }).catch(() => {});
}

function hydrate(doc: ProjectDoc) {
  // The load is async; if the user already started editing during the window,
  // don't clobber their live work with the saved project.
  if (useDocument.getState().layers.length > 0) return;

  useProject.setState({ name: doc.name, createdAt: doc.createdAt });
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

async function loadThenArm(): Promise<void> {
  let loaded = false;
  try {
    const res = await fetch("/api/project");
    if (res.ok) {
      const doc = (await res.json()) as ProjectDoc | null;
      if (doc) hydrate(doc);
      loaded = true; // authoritative read — a null body means "no project yet"
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
