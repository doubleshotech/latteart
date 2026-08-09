import * as Dialog from "@radix-ui/react-dialog";
import { PlugZap, RotateCw } from "lucide-react";
import { retryConnection, useProject } from "../stores/projectStore";

/**
 * What the studio shows when the backend has never answered.
 *
 * Without it the failure is invisible and reads as data loss: the stores hold
 * their defaults, so a backend that is down renders a blank "Untitled" project
 * with an empty switcher — the exact picture of "my work is gone", while the
 * projects sit untouched on disk and the boot loader quietly retries.
 *
 * It renders only once the boot load has actually failed, never while one is
 * still running: every boot request is timed, so an unreachable backend
 * resolves to `offline` within seconds, and blocking a *healthy* boot that is
 * merely slow (a big project is megabytes of inline base64) would be its own
 * bug.
 *
 * This covers boot only. A backend that dies mid-session leaves a real document
 * on screen, and blanking that behind a modal would be worse than the outage;
 * there the topbar's red "Save failed — retrying" whisper is the signal.
 */

const accentBtn: React.CSSProperties = {
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
  cursor: "pointer",
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
  const retrying = useProject((s) => s.retrying);
  const detail = useProject((s) => s.connectionError);

  if (connection !== "offline") return null;

  return (
    <Dialog.Root open>
      <Dialog.Portal>
        <Dialog.Overlay className="dlg-overlay" />
        {/* Not dismissible: there is no studio to go back to until the backend
            answers, so Escape and click-outside would only hide the reason. */}
        <Dialog.Content
          className="dlg-content"
          style={{ width: 420, padding: 22 }}
          onEscapeKeyDown={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
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
                background: "color-mix(in srgb, var(--danger) 14%, transparent)",
                color: "var(--danger)",
              }}
            >
              <PlugZap size={18} strokeWidth={1.7} />
            </span>
            <Dialog.Title style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-.01em" }}>
              Can’t reach the latteart backend
            </Dialog.Title>
          </div>

          <Dialog.Description
            style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--text-muted)" }}
          >
            Your projects are safe on disk. latteart keeps them in the local server, and it can’t
            open or save them until that server answers.
          </Dialog.Description>

          <p style={{ marginTop: 12, fontSize: 12.5, lineHeight: 1.5, color: "var(--text-muted)" }}>
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

          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 18 }}>
            <button
              type="button"
              onClick={retryConnection}
              disabled={retrying}
              style={{
                ...accentBtn,
                cursor: retrying ? "default" : "pointer",
                opacity: retrying ? 0.6 : 1,
              }}
            >
              <RotateCw
                size={14}
                strokeWidth={2}
                style={retrying ? { animation: "latte-spin 0.9s linear infinite" } : undefined}
              />
              {retrying ? "Trying…" : "Try again"}
            </button>
            <span style={{ fontSize: 11.5, color: "var(--text-faint)" }}>
              Retrying every 5 seconds.
            </span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
