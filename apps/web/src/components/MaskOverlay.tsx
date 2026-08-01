import type { CSSProperties, ReactNode } from "react";
import { X, type LucideIcon } from "lucide-react";

/**
 * The chrome shared by the two mask painters — the Edit-area (inpaint) overlay
 * and the layer-mask editor. Both are "a framed picture you paint on, over a
 * dimmed canvas, with controls underneath"; only what the painting *means*
 * differs, so the shell lives here and the meaning stays in each editor.
 */

/** Largest on-screen paint area. Both editors fit their source into this box,
 * so a mask painted in one reads at the same scale in the other. */
const MAX_BOX = { w: 640, h: 460 };

/** Fit natural dims into the paint box, preserving aspect (never upscaling). */
export function fitBox(nw: number, nh: number): { w: number; h: number } {
  const r = Math.min(MAX_BOX.w / nw, MAX_BOX.h / nh, 1);
  return { w: Math.round(nw * r), h: Math.round(nh * r) };
}

/** Indeterminate spinner for work with no measurable progress (an LLM rewrite,
 * a segmentation pass). */
export const spinner: CSSProperties = {
  width: 15,
  height: 15,
  borderRadius: "50%",
  border: "2.4px solid rgba(255,255,255,0.12)",
  borderTopColor: "var(--accent)",
  animation: "latte-spin 0.9s linear infinite",
};

/** Square icon affordance in an editor's control rows (rewrite, undo). */
export const iconBtn: CSSProperties = {
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

/**
 * The framed paint area: a source image with an interactive canvas over it.
 * `background` is what shows through where the source doesn't cover — the plain
 * canvas surface for inpaint, a checkerboard where transparency is the point.
 */
export function PaintStage({
  width,
  height,
  background,
  children,
}: {
  width: number | undefined;
  height: number | undefined;
  background?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div style={{ padding: 14, display: "flex", justifyContent: "center" }}>
      <div
        style={{
          position: "relative",
          width,
          height,
          borderRadius: 8,
          overflow: "hidden",
          border: "1px solid var(--border-strong)",
          background: "var(--surface-canvas)",
          ...background,
        }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Modal shell: backdrop (click-outside closes), card, and titled header with a
 * close button. Children are the editor's own stage and controls.
 */
export function MaskOverlay({
  icon: Icon,
  title,
  subtitle,
  closeTitle = "Close",
  onClose,
  children,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  closeTitle?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
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
            <Icon size={14} strokeWidth={1.8} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600 }}>{title}</div>
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
              {subtitle}
            </div>
          </div>
          <button
            type="button"
            title={closeTitle}
            onClick={onClose}
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
        {children}
      </div>
    </div>
  );
}
