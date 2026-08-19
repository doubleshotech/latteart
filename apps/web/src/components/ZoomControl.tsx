import { Maximize, Minus, Plus } from "lucide-react";
import { boundsOf } from "../lib/bounds";
import { useDocument, type Layer } from "../stores/documentStore";
import { useViewport } from "../stores/viewportStore";

const iconBtn: React.CSSProperties = {
  width: 28,
  height: 28,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 7,
  background: "transparent",
  border: "none",
  color: "var(--text-muted)",
  cursor: "pointer",
};

/**
 * What the canvas actually shows, and so what "fit" frames: a hidden or fully
 * transparent layer is not framed, a still-generating one is — its placeholder
 * occupies that space already. Deliberately looser than `lib/thumbnail`'s and
 * `lib/flatten`'s predicates, which also demand pixels; framing is about where a
 * layer sits, not what it has drawn yet.
 */
const shows = (l: Layer) => l.visible && l.opacity > 0;

export function ZoomControl() {
  const scale = useViewport((s) => s.scale);
  const setZoom = useViewport((s) => s.setZoom);
  // Subscribe to the answer, not the array: `layers` is replaced on every
  // progress tick of a running generation, and this button only needs to know
  // whether anything is there to frame.
  const hasContent = useDocument((s) => s.layers.some(shows));

  // With nothing to frame the button falls back to resetting the view, which is
  // what "fit" degenerates to on an empty canvas.
  const fit = () => {
    const box = boundsOf(useDocument.getState().layers.filter(shows));
    const vp = useViewport.getState();
    if (box) vp.fitTo(box);
    else vp.reset();
  };

  return (
    <div
      style={{
        position: "absolute",
        left: 16,
        bottom: 16,
        display: "flex",
        alignItems: "center",
        gap: 2,
        background: "var(--surface-float)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: 3,
        boxShadow: "0 8px 22px -8px rgba(0,0,0,.6)",
        zIndex: 4,
      }}
    >
      <button type="button" style={iconBtn} title="Zoom out" onClick={() => setZoom(scale * 0.9)}>
        <Minus size={16} strokeWidth={1.8} />
      </button>
      <div
        style={{
          minWidth: 52,
          textAlign: "center",
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          color: "var(--text)",
          fontWeight: 500,
        }}
      >
        {Math.round(scale * 100)}%
      </div>
      <button type="button" style={iconBtn} title="Zoom in" onClick={() => setZoom(scale * 1.1)}>
        <Plus size={16} strokeWidth={1.8} />
      </button>
      <div style={{ width: 1, height: 18, background: "var(--border)", margin: "0 3px" }} />
      <button
        type="button"
        style={{
          ...iconBtn,
          width: "auto",
          gap: 6,
          padding: "0 10px",
          fontSize: 12,
          fontFamily: "inherit",
        }}
        title={hasContent ? "Fit to content" : "Reset view"}
        onClick={fit}
      >
        <Maximize size={15} strokeWidth={1.7} />
        Fit
      </button>
    </div>
  );
}
