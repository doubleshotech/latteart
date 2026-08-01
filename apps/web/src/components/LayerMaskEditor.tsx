import { useCallback, useEffect, useRef, useState } from "react";
import { Contrast, Eraser, Layers, Paintbrush, Sparkles } from "lucide-react";
import { maskFromMatte, type MaskTarget } from "../lib/autoMask";
import { checkerBackground } from "../lib/checkerboard";
import { invertMask, luma, masksAnything } from "../lib/layerMask";
import { loadImage, naturalSize } from "../lib/loadImage";
import { foregroundMatte } from "../lib/removeBackgroundAI";
import { renderStroke, type Stroke } from "../lib/strokes";
import { useDocument, type Layer } from "../stores/documentStore";
import { useGeneration } from "../stores/generationStore";
import { useSession } from "../stores/sessionStore";
import { MaskOverlay, PaintStage, fitBox, spinner } from "./MaskOverlay";

/**
 * The scrim drawn over hidden regions, painted *opaque* into the overlay canvas
 * with the see-through coming from CSS opacity. That matters: a stroke is
 * re-rendered on every pointer move, and re-compositing a translucent colour
 * over itself would darken with each frame, while an opaque one is idempotent.
 */
const SCRIM = "#0a0b0e";
const SCRIM_RGB = [10, 11, 14];
const SCRIM_OPACITY = 0.76;

function Editor({ layer }: { layer: Layer }) {
  const close = useSession((s) => s.closeLayerMaskEdit);
  const updateLayer = useDocument((s) => s.updateLayer);
  const setError = useGeneration((s) => s.setError);

  /** The authoritative mask: a grayscale canvas at the source's native
   * resolution, white = reveal. Everything else on screen is derived from it,
   * and Apply is just its data URL. */
  const maskRef = useRef<HTMLCanvasElement | null>(null);
  /** What the user sees: opaque scrim where the mask hides. Kept in step with
   * the mask rather than recomputed from it on every stroke. */
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const strokeRef = useRef<Stroke | null>(null);
  const autoCtl = useRef<AbortController | null>(null);

  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [brush, setBrush] = useState(56);
  const [paint, setPaint] = useState<"hide" | "reveal">("hide");
  const [auto, setAuto] = useState(false);
  /** Whether the mask currently hides anything — measured from the mask itself
   * (never inferred from "the user painted something"), because a mask that
   * reveals everything is stored as no mask at all. Drives the copy and Reset
   * too, so what the footer claims and what Apply does can't disagree. */
  const [hides, setHides] = useState(!!layer.mask);

  const disp = nat ? fitBox(nat.w, nat.h) : null;

  /** Re-measure coverage from the mask. Cheap (downsampled scan), so it runs at
   * the end of every gesture and after every whole-mask operation. */
  const syncHides = useCallback(() => {
    const mask = maskRef.current;
    if (mask) setHides(masksAnything(mask));
  }, []);

  /** Repaint the overlay from the mask — a full pixel pass, so it runs only on
   * the whole-mask operations (load, auto, invert, clear), never per stroke. */
  const syncOverlay = useCallback(() => {
    const mask = maskRef.current;
    const overlay = overlayRef.current;
    const mctx = mask?.getContext("2d", { willReadFrequently: true });
    const octx = overlay?.getContext("2d");
    if (!mask || !overlay || !mctx || !octx) return;

    const src = mctx.getImageData(0, 0, mask.width, mask.height);
    const out = octx.createImageData(mask.width, mask.height);
    const sp = src.data;
    const op = out.data;
    const [r, g, b] = SCRIM_RGB;
    // Scrim alpha is the mask's darkness, so a soft (anti-aliased or matte-
    // derived) edge previews as a soft edge rather than a hard cut.
    for (let i = 0; i < sp.length; i += 4) {
      op[i] = r!;
      op[i + 1] = g!;
      op[i + 2] = b!;
      op[i + 3] = 255 - luma(sp[i]!, sp[i + 1]!, sp[i + 2]!);
    }
    octx.putImageData(out, 0, 0);
  }, []);

  // Build the mask canvas from the layer's current mask (or fully revealed).
  useEffect(() => {
    if (!layer.src) return;
    let alive = true;
    void (async () => {
      const img = await loadImage(layer.src!);
      if (!alive || !img) return;
      const size = naturalSize(img) ?? {
        w: Math.round(layer.width),
        h: Math.round(layer.height),
      };

      const canvas = document.createElement("canvas");
      canvas.width = size.w;
      canvas.height = size.h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, size.w, size.h);
      if (layer.mask) {
        // Stretched to native, the same way it will be stretched to the layer's
        // box at render time — so what's painted here is what composites there.
        const existing = await loadImage(layer.mask);
        if (!alive) return;
        if (existing) ctx.drawImage(existing, 0, 0, size.w, size.h);
      }
      maskRef.current = canvas;
      setNat(size);
    })();
    return () => {
      alive = false;
    };
  }, [layer.src, layer.mask, layer.width, layer.height]);

  // Size the overlay to native resolution once known, then draw the mask into it.
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay || !nat) return;
    overlay.width = nat.w;
    overlay.height = nat.h;
    syncOverlay();
    syncHides();
  }, [nat, syncOverlay, syncHides]);

  // Close on Escape; abort a running segmentation on unmount.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  useEffect(() => () => autoCtl.current?.abort(), []);

  /** Paint the in-progress stroke into both canvases. Re-rendering the whole
   * stroke each move (rather than the newest segment) keeps a fast drag from
   * leaving gaps; both paints are idempotent, so repeats cost nothing. */
  const renderCurrent = () => {
    const stroke = strokeRef.current;
    const mask = maskRef.current;
    const mctx = mask?.getContext("2d");
    const octx = overlayRef.current?.getContext("2d");
    if (!stroke || !mctx || !octx) return;

    mctx.globalCompositeOperation = "source-over";
    mctx.strokeStyle = mctx.fillStyle = paint === "hide" ? "#000" : "#fff";
    renderStroke(mctx, stroke);

    // Hiding adds scrim; revealing erases it — the overlay's alpha channel is
    // the inverse of the mask's luminance, so the two stay in step.
    octx.globalCompositeOperation = paint === "hide" ? "source-over" : "destination-out";
    octx.strokeStyle = octx.fillStyle = SCRIM;
    renderStroke(octx, stroke);
    octx.globalCompositeOperation = "source-over";
  };

  /** Map a pointer event to native mask coordinates and the brush size there. */
  const toNative = (e: React.PointerEvent) => {
    const overlay = overlayRef.current!;
    const rect = overlay.getBoundingClientRect();
    const sx = overlay.width / rect.width;
    const sy = overlay.height / rect.height;
    return {
      x: (e.clientX - rect.left) * sx,
      y: (e.clientY - rect.top) * sy,
      size: brush * sx,
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || auto || !maskRef.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toNative(e);
    strokeRef.current = { size: p.size, points: [{ x: p.x, y: p.y }] };
    renderCurrent();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!strokeRef.current) return;
    const p = toNative(e);
    strokeRef.current.points.push({ x: p.x, y: p.y });
    renderCurrent();
  };

  // pointerup, and also pointercancel / lost-capture (touch interruption, a
  // gesture stealing the pointer) — otherwise the next move extends a stray stroke.
  const endStroke = () => {
    if (!strokeRef.current) return;
    strokeRef.current = null;
    syncHides();
  };

  const clear = () => {
    const mask = maskRef.current;
    const mctx = mask?.getContext("2d");
    if (!mask || !mctx) return;
    mctx.globalCompositeOperation = "source-over";
    mctx.fillStyle = "#fff";
    mctx.fillRect(0, 0, mask.width, mask.height);
    syncOverlay();
    setHides(false);
  };

  /** Replace the whole mask with `next`, drawn to fit. The tail every
   * whole-mask operation shares. */
  const replaceMask = (mask: HTMLCanvasElement, next: CanvasImageSource) => {
    const mctx = mask.getContext("2d");
    if (!mctx) return;
    mctx.globalCompositeOperation = "source-over";
    mctx.drawImage(next, 0, 0, mask.width, mask.height);
    syncOverlay();
    syncHides();
  };

  const invert = async () => {
    const mask = maskRef.current;
    if (!mask) return;
    const flipped = await loadImage(await invertMask(mask.toDataURL("image/png")));
    if (!flipped || maskRef.current !== mask) return;
    replaceMask(mask, flipped);
  };

  /**
   * Derive the mask from the RMBG foreground matte — the same segmentation
   * Cutout and Smart edit run. `maskFromMatte` produces white where the target
   * is, which as a layer mask means "keep that and hide the rest".
   */
  const autoMask = async (target: MaskTarget) => {
    const mask = maskRef.current;
    if (!mask || !layer.src || auto) return;
    autoCtl.current?.abort();
    const ctl = new AbortController();
    autoCtl.current = ctl;
    setAuto(true);
    try {
      const matte = await foregroundMatte(layer.src, ctl.signal);
      if (ctl.signal.aborted) return;
      const derived = await loadImage(maskFromMatte(matte, target));
      if (ctl.signal.aborted || !derived || maskRef.current !== mask) return;
      replaceMask(mask, derived);
    } catch (err) {
      if (!ctl.signal.aborted) setError((err as Error).message || "Couldn't separate the subject.");
    } finally {
      if (autoCtl.current === ctl) autoCtl.current = null;
      setAuto(false);
    }
  };

  const apply = () => {
    const mask = maskRef.current;
    if (!mask) return;
    // Measured here rather than trusted from `hides`: this is the decision that
    // reaches disk, and a mask hiding nothing must land as null — otherwise it
    // costs an asset, a composite per render, and the whole masked-layer
    // treatment (checkerboard, badge) for no visible effect.
    updateLayer(layer.id, { mask: masksAnything(mask) ? mask.toDataURL("image/png") : null });
    close();
  };

  return (
    <MaskOverlay
      icon={Layers}
      title="Layer mask"
      subtitle={`Hide parts of the layer without touching its pixels · ${layer.name}`}
      closeTitle="Close without applying"
      onClose={close}
    >
      <>
        {/* checkerboard reads as "this is what gets cut away" */}
        <PaintStage width={disp?.w} height={disp?.h} background={checkerBackground}>
          <>
            {layer.src && (
              <img
                src={layer.src}
                alt=""
                draggable={false}
                style={{ width: "100%", height: "100%", display: "block", objectFit: "fill" }}
              />
            )}
            <canvas
              ref={overlayRef}
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
                opacity: SCRIM_OPACITY,
                cursor: auto ? "progress" : "crosshair",
                touchAction: "none",
              }}
            />
            {auto && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 9,
                  background: "rgba(6,7,9,.55)",
                  color: "#fff",
                  fontSize: 12,
                }}
              >
                <span style={spinner} />
                Separating the subject…
              </div>
            )}
          </>
        </PaintStage>

        {/* brush */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "0 14px 10px" }}>
          <div style={{ display: "flex", gap: 3, flex: "none" }}>
            {(["hide", "reveal"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setPaint(mode)}
                title={
                  mode === "hide" ? "Paint to hide the layer here" : "Paint to bring the layer back"
                }
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  height: 30,
                  padding: "0 11px",
                  borderRadius: 8,
                  background:
                    paint === mode
                      ? "color-mix(in srgb, var(--accent) 18%, transparent)"
                      : "var(--surface-2)",
                  border: `1px solid ${paint === mode ? "color-mix(in srgb, var(--accent) 55%, transparent)" : "var(--border)"}`,
                  color: paint === mode ? "var(--accent)" : "var(--text-muted)",
                  fontSize: 11.5,
                  fontFamily: "inherit",
                  cursor: "pointer",
                  textTransform: "capitalize",
                }}
              >
                {mode === "hide" ? (
                  <Eraser size={13} strokeWidth={1.7} />
                ) : (
                  <Paintbrush size={13} strokeWidth={1.7} />
                )}
                {mode}
              </button>
            ))}
          </div>
          <input
            type="range"
            min={8}
            max={160}
            value={brush}
            onChange={(e) => setBrush(Number(e.target.value))}
            style={{ flex: 1, accentColor: "var(--accent)" }}
          />
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              color: "var(--text-faint)",
              width: 40,
              textAlign: "right",
            }}
          >
            {brush}px
          </span>
        </div>

        {/* whole-mask operations */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "0 14px 12px",
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: 11.5, color: "var(--text-muted)", flex: "none" }}>Auto</span>
          <button
            type="button"
            onClick={() => void autoMask("subject")}
            disabled={auto}
            style={chip(auto)}
          >
            <Sparkles size={12} strokeWidth={1.8} />
            Keep subject
          </button>
          <button
            type="button"
            onClick={() => void autoMask("background")}
            disabled={auto}
            style={chip(auto)}
          >
            <Sparkles size={12} strokeWidth={1.8} />
            Keep background
          </button>
          <div style={{ flex: 1 }} />
          <button type="button" onClick={() => void invert()} disabled={auto} style={chip(auto)}>
            <Contrast size={12} strokeWidth={1.8} />
            Invert
          </button>
          <button
            type="button"
            onClick={clear}
            disabled={auto || !hides}
            style={chip(auto || !hides)}
          >
            <Eraser size={12} strokeWidth={1.8} />
            Reset
          </button>
        </div>

        {/* footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: 12,
            borderTop: "1px solid var(--border)",
          }}
        >
          <span style={{ flex: 1, fontSize: 11, color: "var(--text-faint)" }}>
            {hides
              ? "Non-destructive — the layer's pixels are untouched."
              : "Nothing hidden yet. Paint over the parts to remove."}
          </span>
          <button
            type="button"
            onClick={close}
            style={{
              height: 36,
              padding: "0 14px",
              borderRadius: 9,
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              color: "var(--text)",
              fontSize: 12.5,
              fontFamily: "inherit",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={apply}
            disabled={auto}
            title={hides ? "Apply the mask to this layer" : "Apply — removes the layer's mask"}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              height: 36,
              padding: "0 16px",
              borderRadius: 9,
              background: "var(--accent)",
              border: "none",
              color: "var(--accent-fg)",
              fontSize: 13,
              fontWeight: 600,
              fontFamily: "inherit",
              cursor: auto ? "not-allowed" : "pointer",
              opacity: auto ? 0.5 : 1,
              whiteSpace: "nowrap",
              boxShadow: "0 3px 12px -2px color-mix(in srgb, var(--accent) 60%, transparent)",
            }}
          >
            <Layers size={15} strokeWidth={1.8} />
            {hides ? "Apply mask" : layer.mask ? "Remove mask" : "Done"}
          </button>
        </div>
      </>
    </MaskOverlay>
  );
}

/** Small pill button shared by the auto/invert/reset row. */
function chip(disabled: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 6,
    height: 28,
    padding: "0 10px",
    borderRadius: 8,
    background: "var(--surface-2)",
    border: "1px solid var(--border)",
    color: "var(--text)",
    fontSize: 11.5,
    fontFamily: "inherit",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    flex: "none",
  };
}

/**
 * Layer-mask editor: paint (or auto-derive) the alpha mask that decides which
 * parts of a layer show. Distinct from the Edit-area overlay, which paints a
 * throwaway region for a provider to regenerate — nothing here calls a provider,
 * and the layer's own pixels are never rewritten.
 *
 * Edits live on a scratch canvas until Apply, so Cancel/Escape genuinely
 * discards them and the undo stack gets one entry per applied mask.
 */
export function LayerMaskEditor() {
  const edit = useSession((s) => s.layerMaskEdit);
  const layer = useDocument((s) => s.layers.find((l) => l.id === edit?.layerId) ?? null);

  if (!edit || !layer || !layer.src) return null;
  // Keyed on the layer so a fresh scratch mask mounts per layer.
  return <Editor key={layer.id} layer={layer} />;
}
