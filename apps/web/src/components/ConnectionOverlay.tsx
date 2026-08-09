import { useEffect, useState } from "react";
import { PlugZap, RotateCw } from "lucide-react";
import { retryConnection, useProject } from "../stores/projectStore";

/**
 * What the studio shows before the backend has ever answered.
 *
 * Without it the failure is invisible and reads as data loss: the stores hold
 * their defaults, so a backend that is down renders a blank "Untitled" project
 * with an empty switcher — the exact picture of "my work is gone", while the
 * projects sit untouched on disk and the boot loader quietly retries.
 *
 * This covers boot only. A backend that dies mid-session leaves a real document
 * on screen, and blanking that behind a modal would be worse than the outage;
 * there the topbar's red "Save failed — retrying" whisper is the signal.
 */

/** A healthy local backend answers in milliseconds. Waiting a beat before
 * saying anything keeps the normal boot silent instead of flashing a card. */
const GRACE_MS = 1200;

const card: React.CSSProperties = {
  width: 420,
  padding: 22,
  borderRadius: "var(--radius-lg)",
  background: "var(--surface-float)",
  border: "1px solid var(--border-strong)",
  boxShadow: "0 24px 60px rgb(0 0 0 / 0.55)",
};

const codeChip: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 11.5,
  padding: "3px 7px",
  borderRadius: "var(--radius-sm)",
  background: "var(--surface-2)",
  border: "1px solid var(--border)",
  color: "var(--text)",
};

export function ConnectionOverlay() {
  const connection = useProject((s) => s.connection);
  const connecting = useProject((s) => s.connecting);
  const detail = useProject((s) => s.connectionError);
  const [waited, setWaited] = useState(false);

  useEffect(() => {
    if (connection !== "unknown") return;
    const t = window.setTimeout(() => setWaited(true), GRACE_MS);
    return () => window.clearTimeout(t);
  }, [connection]);

  if (connection === "online") return null;
  if (connection === "unknown" && !waited) return null;

  const offline = connection === "offline";
  const tone = offline ? "var(--danger)" : "var(--text-muted)";

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="conn-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgb(10 11 13 / 0.86)",
        backdropFilter: "blur(3px)",
      }}
    >
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 13 }}>
          <span
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 34,
              height: 34,
              flex: "none",
              borderRadius: "var(--radius-md)",
              background: `color-mix(in srgb, ${tone} 14%, transparent)`,
              color: tone,
            }}
          >
            <PlugZap size={18} strokeWidth={1.7} />
          </span>
          <h2 id="conn-title" style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-.01em" }}>
            {offline ? "Can’t reach the latteart backend" : "Connecting to the backend…"}
          </h2>
        </div>

        <p style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--text-muted)" }}>
          {offline ? (
            <>
              Your projects are safe on disk. latteart keeps them in the local server, and it can’t
              open or save them until that server answers.
            </>
          ) : (
            <>The local server hasn’t answered yet. Waiting for it before opening your project.</>
          )}
        </p>

        {offline && (
          <>
            <p
              style={{
                marginTop: 12,
                fontSize: 12.5,
                lineHeight: 1.5,
                color: "var(--text-muted)",
              }}
            >
              Start it with <span style={codeChip}>pnpm dev</span> in the project folder, then this
              goes away on its own.
            </p>
            {detail && (
              <p
                style={{
                  marginTop: 12,
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  lineHeight: 1.45,
                  color: "var(--text-faint)",
                  wordBreak: "break-word",
                }}
              >
                {detail}
              </p>
            )}
          </>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 18 }}>
          <button
            type="button"
            onClick={retryConnection}
            disabled={connecting}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              height: 32,
              padding: "0 13px",
              borderRadius: "var(--radius-md)",
              background: "var(--accent)",
              border: "1px solid var(--accent)",
              color: "var(--accent-fg)",
              fontSize: 12,
              fontWeight: 600,
              fontFamily: "inherit",
              cursor: connecting ? "default" : "pointer",
              opacity: connecting ? 0.6 : 1,
            }}
          >
            <RotateCw
              size={14}
              strokeWidth={2}
              style={connecting ? { animation: "latte-spin 0.9s linear infinite" } : undefined}
            />
            {connecting ? "Trying…" : "Try again"}
          </button>
          <span style={{ fontSize: 11.5, color: "var(--text-faint)" }}>
            {offline ? "Retrying every 5 seconds." : "This usually takes a moment."}
          </span>
        </div>
      </div>
    </div>
  );
}
