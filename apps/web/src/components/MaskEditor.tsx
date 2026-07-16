import { useEffect, useRef, useState } from "react";
import { Eraser, SquareDashed, Undo2, Wand2, X } from "lucide-react";
import { rewriteInpaintInstruction } from "../api/inpaintPrompt";
import type { Layer } from "../stores/documentStore";
import { useDocument } from "../stores/documentStore";
import { useGeneration } from "../stores/generationStore";
import { useProviders } from "../stores/providersStore";
import { useSession } from "../stores/sessionStore";

/** A brush stroke in the source image's native pixel coordinates. */
export interface Stroke {
  size: number;
  points: { x: number; y: number }[];
}

/** Paint every stroke into `ctx` in `color` (round caps; single points = dots). */
function renderStrokes(ctx: CanvasRenderingContext2D, strokes: Stroke[], color: string): void {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  for (const s of strokes) {
    if (s.points.length === 1) {
      const p = s.points[0]!;
      ctx.beginPath();
      ctx.arc(p.x, p.y, s.size / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.lineWidth = s.size;
    ctx.beginPath();
    ctx.moveTo(s.points[0]!.x, s.points[0]!.y);
    for (const p of s.points.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }
}

/**
 * Render strokes to a white-on-black PNG data URL at native resolution — the
 * inpaint mask convention (white = regenerate). Pure and deterministic, so the
 * masking logic is verifiable without a DOM harness driving pointer events.
 */
export function strokesToMaskDataUrl(strokes: Stroke[], width: number, height: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);
  renderStrokes(ctx, strokes, "#fff");
  return canvas.toDataURL("image/png");
}

const MASK_TINT = "rgba(238,161,69,0.55)";
const MAX_BOX = { w: 640, h: 460 };

/** Square icon affordance beside the fill input (rewrite / undo). */
const iconBtn: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 40,
  height: 40,
  borderRadius: 10,
  background: "var(--surface-2)",
  border: "1px solid var(--border)",
  color: "var(--text-muted)",
  cursor: "pointer",
  flex: "none",
};

const spinner: React.CSSProperties = {
  width: 15,
  height: 15,
  borderRadius: "50%",
  border: "2.4px solid rgba(255,255,255,0.12)",
  borderTopColor: "var(--accent)",
  animation: "latte-spin 0.9s linear infinite",
};

/** Fit natural dims into MAX_BOX, preserving aspect. */
function fit(nw: number, nh: number): { w: number; h: number } {
  const r = Math.min(MAX_BOX.w / nw, MAX_BOX.h / nh, 1);
  return { w: Math.round(nw * r), h: Math.round(nh * r) };
}

function Editor({ source }: { source: Layer }) {
  const closeMaskEdit = useSession((s) => s.closeMaskEdit);
  const providerId = useSession((s) => s.providerId);
  const model = useSession((s) => s.model);
  const llmProviderId = useSession((s) => s.llmProviderId);
  const providers = useProviders((s) => s.providers);
  const runAction = useGeneration((s) => s.runAction);
  const setError = useGeneration((s) => s.setError);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const drawingRef = useRef(false);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [brush, setBrush] = useState(36);
  const [prompt, setPrompt] = useState("");
  const [rewriting, setRewriting] = useState(false);
  // The pre-rewrite instruction, so a single tap reverts. Cleared once edited.
  const [preRewrite, setPreRewrite] = useState<string | null>(null);
  const rewriteCtl = useRef<AbortController | null>(null);
  const [, force] = useState(0);
  const rerender = () => force((n) => n + 1);

  const active = providers.find((p) => p.id === providerId);
  const disp = nat ? fit(nat.w, nat.h) : null;
  const hasStrokes = strokesRef.current.length > 0;
  // Not gated on a running job — submitting mid-run queues the inpaint (the
  // mask is captured now, so later canvas changes can't skew it).
  const canGenerate =
    !!active?.available && !!active.capabilities.inpaint && hasStrokes && !!prompt.trim();
  const canRewrite = prompt.trim().length > 0 && !rewriting;

  // Load the source to learn its native pixel size (the mask's resolution).
  useEffect(() => {
    if (!source.src) return;
    let alive = true;
    const img = new Image();
    img.onload = () => {
      if (alive)
        setNat({ w: img.naturalWidth || source.width, h: img.naturalHeight || source.height });
    };
    img.src = source.src;
    return () => {
      alive = false;
    };
  }, [source.src, source.width, source.height]);

  // Size the paint canvas backing store to native resolution once known.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !nat) return;
    canvas.width = nat.w;
    canvas.height = nat.h;
    redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nat]);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMaskEdit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeMaskEdit]);

  // Abort an in-flight rewrite if the editor closes.
  useEffect(() => () => rewriteCtl.current?.abort(), []);

  const redraw = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    renderStrokes(ctx, strokesRef.current, MASK_TINT);
  };

  /** Map a pointer event to native image coordinates and the brush size there. */
  const toNative = (e: React.PointerEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * sx,
      y: (e.clientY - rect.top) * sy,
      size: brush * sx,
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toNative(e);
    strokesRef.current.push({ size: p.size, points: [{ x: p.x, y: p.y }] });
    drawingRef.current = true;
    redraw();
    rerender(); // reflect hasStrokes for the Generate button
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drawingRef.current) return;
    const cur = strokesRef.current.at(-1);
    // The active stroke can vanish if Clear ran mid-gesture (e.g. after a
    // pointercancel left drawing armed) — end the gesture instead of throwing.
    if (!cur) {
      drawingRef.current = false;
      return;
    }
    const p = toNative(e);
    cur.points.push({ x: p.x, y: p.y });
    redraw();
  };

  // pointerup, and also pointercancel / lost-capture (touch interruption, a
  // gesture stealing the pointer) — otherwise drawingRef stays armed and the
  // next move extends a stray stroke.
  const endStroke = () => {
    drawingRef.current = false;
  };

  const clear = () => {
    strokesRef.current = [];
    redraw();
    rerender();
  };

  /** Type in the fill field. A manual edit supersedes any in-flight rewrite (so
   * its result can't clobber what the user just typed) and, once applied,
   * invalidates the revert target. */
  const editPrompt = (value: string) => {
    setPrompt(value);
    rewriteCtl.current?.abort();
    if (preRewrite !== null) setPreRewrite(null);
  };

  /** Rewrite the terse instruction into a detailed inpaint fill-prompt via the
   * local LLM, passing the source layer's own prompt as context for coherence. */
  const runRewrite = async () => {
    const text = prompt.trim();
    if (!text || rewriting) return;
    rewriteCtl.current?.abort();
    const ctl = new AbortController();
    rewriteCtl.current = ctl;
    setRewriting(true);
    try {
      const { prompt: rewritten } = await rewriteInpaintInstruction(
        text,
        llmProviderId,
        source.prompt || undefined,
        ctl.signal,
      );
      if (ctl.signal.aborted) return;
      setPreRewrite(prompt);
      setPrompt(rewritten);
    } catch (err) {
      if (!ctl.signal.aborted)
        setError((err as Error).message || "Couldn't rewrite the instruction.");
    } finally {
      if (rewriteCtl.current === ctl) rewriteCtl.current = null;
      setRewriting(false);
    }
  };

  const revertRewrite = () => {
    if (preRewrite === null) return;
    setPrompt(preRewrite);
    setPreRewrite(null);
  };

  const generate = () => {
    if (!canGenerate || !active || !nat) return;
    const mask = strokesToMaskDataUrl(strokesRef.current, nat.w, nat.h);
    runAction({
      providerId: active.id,
      model: model ?? undefined,
      kind: "edit-area",
      sourceId: source.id,
      prompt,
      mask,
      detail: `inpaint · ${active.label}`,
    });
    closeMaskEdit();
  };

  const blockedNote = !active?.available
    ? "Connect a provider in Settings"
    : !active.capabilities.inpaint
      ? `${active.label} can't inpaint — try ComfyUI`
      : null;

  return (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeMaskEdit();
      }}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 8,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(6,7,9,.62)",
        backdropFilter: "blur(3px)",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          maxWidth: "min(92%, 700px)",
          background: "var(--surface-1)",
          border: "1px solid var(--border-strong)",
          borderRadius: 14,
          boxShadow: "0 30px 80px -20px rgba(0,0,0,.8)",
          overflow: "hidden",
        }}
      >
        {/* header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            padding: "12px 12px 12px 14px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <span
            style={{
              width: 24,
              height: 24,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 6,
              background: "color-mix(in srgb, var(--accent) 16%, transparent)",
              color: "var(--accent)",
            }}
          >
            <SquareDashed size={14} strokeWidth={1.8} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600 }}>Edit area</div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                color: "var(--text-faint)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              Paint over what to regenerate · {source.name}
            </div>
          </div>
          <button
            type="button"
            title="Close"
            onClick={closeMaskEdit}
            style={{
              width: 26,
              height: 26,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 7,
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              color: "var(--text)",
              cursor: "pointer",
            }}
          >
            <X size={14} strokeWidth={1.9} />
          </button>
        </div>

        {/* paint stage */}
        <div style={{ padding: 14, display: "flex", justifyContent: "center" }}>
          <div
            style={{
              position: "relative",
              width: disp?.w,
              height: disp?.h,
              borderRadius: 8,
              overflow: "hidden",
              border: "1px solid var(--border-strong)",
              background: "var(--surface-canvas)",
            }}
          >
            {source.src && (
              <img
                src={source.src}
                alt=""
                draggable={false}
                style={{ width: "100%", height: "100%", display: "block", objectFit: "fill" }}
              />
            )}
            <canvas
              ref={canvasRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endStroke}
              onPointerCancel={endStroke}
              onLostPointerCapture={endStroke}
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                cursor: "crosshair",
                touchAction: "none",
              }}
            />
          </div>
        </div>

        {/* controls */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "0 14px 12px",
          }}
        >
          <span style={{ fontSize: 11.5, color: "var(--text-muted)", flex: "none" }}>Brush</span>
          <input
            type="range"
            min={8}
            max={96}
            value={brush}
            onChange={(e) => setBrush(Number(e.target.value))}
            style={{ flex: 1, accentColor: "var(--accent)" }}
          />
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              color: "var(--text-faint)",
              width: 34,
              textAlign: "right",
            }}
          >
            {brush}px
          </span>
          <button
            type="button"
            onClick={clear}
            disabled={!hasStrokes}
            title="Clear mask"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              height: 30,
              padding: "0 11px",
              borderRadius: 8,
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              color: "var(--text)",
              fontSize: 11.5,
              fontFamily: "inherit",
              cursor: hasStrokes ? "pointer" : "not-allowed",
              opacity: hasStrokes ? 1 : 0.5,
            }}
          >
            <Eraser size={13} strokeWidth={1.7} />
            Clear
          </button>
        </div>

        {/* prompt + generate */}
        <div
          style={{
            display: "flex",
            gap: 10,
            padding: 12,
            borderTop: "1px solid var(--border)",
            background: "var(--surface-1)",
          }}
        >
          <input
            value={prompt}
            onChange={(e) => editPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") generate();
            }}
            placeholder="Describe the change in plain words…"
            style={{
              flex: 1,
              height: 40,
              padding: "0 12px",
              borderRadius: 10,
              background: "var(--surface-canvas)",
              border: "1px solid var(--border-strong)",
              color: "var(--text)",
              fontSize: 12.5,
              fontFamily: "inherit",
              outline: "none",
            }}
          />

          {/* revert to the pre-rewrite instruction — only right after a rewrite */}
          {preRewrite !== null && (
            <button
              type="button"
              onClick={revertRewrite}
              title="Undo rewrite — restore your instruction"
              aria-label="Undo rewrite"
              style={{ ...iconBtn, color: "var(--text-faint)" }}
            >
              <Undo2 size={15} strokeWidth={1.9} />
            </button>
          )}

          {/* ✨ rewrite the terse instruction into a detailed fill prompt */}
          <button
            type="button"
            onClick={runRewrite}
            disabled={!canRewrite}
            title="Rewrite — expand your instruction into a detailed fill prompt via a local LLM"
            aria-label="Rewrite instruction"
            style={{
              ...iconBtn,
              color: canRewrite ? "var(--accent)" : "var(--text-faint)",
              cursor: canRewrite ? "pointer" : "not-allowed",
              opacity: prompt.trim().length > 0 ? 1 : 0.5,
            }}
          >
            {rewriting ? <span style={spinner} /> : <Wand2 size={16} strokeWidth={1.8} />}
          </button>

          <button
            type="button"
            disabled={!canGenerate}
            onClick={generate}
            title={blockedNote ?? (!hasStrokes ? "Paint a mask first" : "Generate the edit")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              height: 40,
              padding: "0 16px",
              borderRadius: 10,
              background: "var(--accent)",
              border: "none",
              color: "var(--accent-fg)",
              fontSize: 13,
              fontWeight: 600,
              fontFamily: "inherit",
              cursor: canGenerate ? "pointer" : "not-allowed",
              opacity: canGenerate ? 1 : 0.5,
              whiteSpace: "nowrap",
              boxShadow: "0 3px 12px -2px color-mix(in srgb, var(--accent) 60%, transparent)",
            }}
          >
            <SquareDashed size={15} strokeWidth={1.8} />
            Generate edit
          </button>
        </div>
        {blockedNote && (
          <div
            style={{
              padding: "0 12px 12px",
              fontSize: 11,
              color: "var(--text-faint)",
              textAlign: "center",
            }}
          >
            {blockedNote}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Edit-area (inpaint) overlay: paint a mask over the selected layer's image,
 * describe the fill, and regenerate only that region. Mounts over the canvas
 * when a mask-edit session is open; the mask is built at the source's native
 * resolution so it lines up with the pixels sent to the provider.
 */
export function MaskEditor() {
  const maskEdit = useSession((s) => s.maskEdit);
  const source = useDocument((s) => s.layers.find((l) => l.id === maskEdit?.sourceId) ?? null);

  if (!maskEdit || !source || !source.src) return null;
  // Keyed on source id so a fresh editor (strokes, prompt) mounts per layer.
  return <Editor key={source.id} source={source} />;
}
