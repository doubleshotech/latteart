import { Maximize, Minus, Plus } from "lucide-react";
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

export function ZoomControl() {
  const scale = useViewport((s) => s.scale);
  const setZoom = useViewport((s) => s.setZoom);
  const reset = useViewport((s) => s.reset);

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
        title="Reset view"
        onClick={reset}
      >
        <Maximize size={15} strokeWidth={1.7} />
        Fit
      </button>
    </div>
  );
}
