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
    },
  };
}

let started = false;
let timer: number | null = null;
let lastSent = "";
let inFlight = false;
let pendingAgain = false;

function schedule(delay = DEBOUNCE_MS) {
  if (timer !== null) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    timer = null;
    void flush();
  }, delay);
}

async function flush() {
  const body = JSON.stringify(snapshot());
  if (body === lastSent) return;
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
      body,
    });
    if (!res.ok) throw new Error(`save failed (${res.status})`);
    lastSent = body;
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

function hydrate(doc: ProjectDoc) {
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
}

/**
 * Boot the project layer: load the saved project into the stores, then start
 * autosaving. Idempotent (StrictMode mounts effects twice in dev).
 */
export async function initProjectSync(): Promise<void> {
  if (started) return;
  started = true;

  try {
    const res = await fetch("/api/project");
    if (res.ok) {
      const doc = (await res.json()) as ProjectDoc | null;
      if (doc) hydrate(doc);
    }
  } catch {
    // Backend not up yet — start empty; the first change will save (with retry).
  }

  // Hydration itself must not trigger a save of what we just loaded.
  lastSent = JSON.stringify(snapshot());

  const onChange = () => schedule();
  useDocument.subscribe(onChange);
  useViewport.subscribe(onChange);
  useSession.subscribe(onChange);

  // Flush pending changes when the tab goes to the background or away — the
  // payload usually exceeds the keepalive/sendBeacon limit, so a plain fetch
  // on hide (which normally completes) is the best effort available.
  const flushNow = () => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
    void flush();
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushNow();
  });
  window.addEventListener("pagehide", flushNow);
}
