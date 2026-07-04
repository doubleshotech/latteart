import { useEffect } from "react";
import { TriangleAlert, X } from "lucide-react";
import { useGeneration } from "../stores/generationStore";

/** Transient banner for provider/generation errors (bad key, quota, refusal). */
export function ErrorToast() {
  const error = useGeneration((s) => s.error);
  const clearError = useGeneration((s) => s.clearError);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(clearError, 7000);
    return () => clearTimeout(t);
  }, [error, clearError]);

  if (!error) return null;

  return (
    <div
      role="alert"
      style={{
        position: "fixed",
        top: 64,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 60,
        display: "flex",
        alignItems: "center",
        gap: 10,
        maxWidth: 540,
        padding: "10px 10px 10px 14px",
        borderRadius: 10,
        background: "var(--surface-float)",
        border: "1px solid color-mix(in srgb, #f0616d 50%, var(--border-strong))",
        boxShadow: "0 18px 44px -14px rgba(0,0,0,.7)",
      }}
    >
      <TriangleAlert size={16} color="#f0616d" strokeWidth={1.9} style={{ flex: "none" }} />
      <span style={{ fontSize: 12.5, color: "var(--text)", lineHeight: 1.4 }}>{error}</span>
      <button
        type="button"
        onClick={clearError}
        aria-label="Dismiss"
        style={{
          width: 22,
          height: 22,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 6,
          background: "transparent",
          border: "none",
          color: "var(--text-muted)",
          cursor: "pointer",
          flex: "none",
        }}
      >
        <X size={14} strokeWidth={1.9} />
      </button>
    </div>
  );
}
