import { useEffect } from "react";
import { Redo2, Undo2 } from "lucide-react";
import { redo, undo, useHistory } from "../stores/history";
import { useGeneration } from "../stores/generationStore";

const isMac = navigator.platform.startsWith("Mac");
const MOD = isMac ? "⌘" : "Ctrl+";

/** Floating undo/redo pill above the zoom control, plus the ⌘Z/⇧⌘Z keys. */
export function UndoRedo() {
  const canUndo = useHistory((s) => s.canUndo);
  const canRedo = useHistory((s) => s.canRedo);
  const running = useGeneration((s) => s.running || s.action !== null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      if (key === "y" || e.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const btn = (enabled: boolean): React.CSSProperties => ({
    width: 28,
    height: 28,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 7,
    background: "transparent",
    border: "none",
    color: "var(--text-muted)",
    cursor: enabled ? "pointer" : "not-allowed",
    opacity: enabled ? 1 : 0.35,
  });

  return (
    <div
      style={{
        position: "absolute",
        left: 16,
        bottom: 62,
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
      <button
        type="button"
        style={btn(canUndo && !running)}
        disabled={!canUndo || running}
        title={running ? "Wait for the current generation" : `Undo (${MOD}Z)`}
        onClick={undo}
      >
        <Undo2 size={16} strokeWidth={1.8} />
      </button>
      <button
        type="button"
        style={btn(canRedo && !running)}
        disabled={!canRedo || running}
        title={running ? "Wait for the current generation" : `Redo (${MOD}⇧Z)`}
        onClick={redo}
      >
        <Redo2 size={16} strokeWidth={1.8} />
      </button>
    </div>
  );
}
