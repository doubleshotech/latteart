import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { fetchStyleDetail } from "../api/styles";
import { useProject } from "../stores/projectStore";
import { useStyles } from "../stores/stylesStore";

const accentBtn: React.CSSProperties = {
  height: 34,
  padding: "0 15px",
  borderRadius: 8,
  background: "var(--accent)",
  border: "none",
  color: "var(--accent-fg)",
  fontSize: 12,
  fontWeight: 600,
  fontFamily: "inherit",
  cursor: "pointer",
  flex: "none",
};

const ghostBtn: React.CSSProperties = {
  height: 34,
  padding: "0 14px",
  borderRadius: 8,
  background: "transparent",
  border: "1px solid var(--border-strong)",
  color: "var(--text-muted)",
  fontSize: 12,
  fontWeight: 500,
  fontFamily: "inherit",
  cursor: "pointer",
  flex: "none",
};

const fieldLabel: React.CSSProperties = {
  display: "block",
  fontSize: 11.5,
  color: "var(--text-muted)",
  marginBottom: 6,
};

const textField: React.CSSProperties = {
  width: "100%",
  padding: "8px 11px",
  background: "var(--surface-2)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--text)",
  fontFamily: "inherit",
  fontSize: 12.5,
  outline: "none",
  resize: "vertical",
};

/**
 * Rename a custom style and edit its distilled descriptor. The descriptor is
 * fetched per-style on open (the list payload stays descriptor-free); saving
 * PATCHes only the fields, never the reference images or thumbnail.
 */
export function EditStyleDialog({
  styleId,
  onOpenChange,
}: {
  /** The style being edited; null keeps the dialog closed. */
  styleId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const update = useStyles((s) => s.update);
  const projectId = useProject((s) => s.id);
  const [label, setLabel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  // Scope row. The picker only lists global styles and the open project's own,
  // so "checked" simply means scoped-to-this-project vs global.
  const [scopeToProject, setScopeToProject] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prefill from the server whenever a style is opened. The fields are cleared
  // first — the component stays mounted across opens, and stale values from a
  // previous style must never be saveable onto this one (canSave requires a
  // non-empty name and description, so a failed fetch leaves Save disabled).
  // The cancelled flag keeps a stale response from filling a dialog that moved
  // on to another id.
  useEffect(() => {
    if (!styleId) return;
    let cancelled = false;
    setLabel("");
    setPrompt("");
    setNegativePrompt("");
    setScopeToProject(false);
    setLoading(true);
    setError(null);
    fetchStyleDetail(styleId)
      .then((d) => {
        if (cancelled) return;
        setLabel(d.label);
        setPrompt(d.prompt);
        setNegativePrompt(d.negativePrompt ?? "");
        setScopeToProject(!!d.projectId && d.projectId === useProject.getState().id);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message || "Couldn't load the style.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [styleId]);

  const canSave = !loading && !busy && label.trim() !== "" && prompt.trim() !== "";

  const save = async () => {
    if (!styleId || !canSave) return;
    setBusy(true);
    setError(null);
    try {
      await update(styleId, {
        label: label.trim(),
        prompt: prompt.trim(),
        negativePrompt: negativePrompt.trim(),
        // Three-way on the wire, two states here: the open project's id or
        // global (null). Guarded on a known project id so a not-yet-hydrated
        // boot can never silently re-scope a style.
        ...(projectId ? { projectId: scopeToProject ? projectId : null } : {}),
      });
      onOpenChange(false);
    } catch (err) {
      setError((err as Error).message || "Couldn't save the style.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open={styleId !== null} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dlg-overlay" />
        <Dialog.Content
          className="dlg-content"
          aria-describedby={undefined}
          style={{ maxWidth: 480 }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              padding: "18px 18px 0 20px",
            }}
          >
            <div>
              <Dialog.Title
                style={{ fontSize: 16, fontWeight: 600, letterSpacing: "-.01em", margin: 0 }}
              >
                Edit style
              </Dialog.Title>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                The description is what gets composed into your prompts.
              </div>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                style={{
                  width: 30,
                  height: 30,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 8,
                  background: "var(--surface-2)",
                  border: "1px solid var(--border)",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                }}
              >
                <X size={15} strokeWidth={1.9} />
              </button>
            </Dialog.Close>
          </div>

          <div style={{ padding: "16px 20px 4px" }}>
            <div>
              <label style={fieldLabel}>Name</label>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                disabled={loading}
                style={{ ...textField, height: 34, padding: "0 11px" }}
              />
            </div>

            <div style={{ marginTop: 14 }}>
              <label style={fieldLabel}>Style description</label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                disabled={loading}
                rows={5}
                placeholder={loading ? "Loading…" : undefined}
                style={textField}
              />
            </div>

            <div style={{ marginTop: 14 }}>
              <label style={fieldLabel}>
                Avoid <span style={{ color: "var(--text-faint)" }}>(optional)</span>
              </label>
              <textarea
                value={negativePrompt}
                onChange={(e) => setNegativePrompt(e.target.value)}
                disabled={loading}
                rows={2}
                placeholder="e.g. photo, watermark"
                style={textField}
              />
            </div>

            {/* scope */}
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                width: "fit-content",
                marginTop: 14,
                fontSize: 12,
                color: "var(--text-muted)",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={scopeToProject}
                onChange={(e) => setScopeToProject(e.target.checked)}
                disabled={loading}
                style={{ accentColor: "var(--accent)", margin: 0 }}
              />
              Only in this project
            </label>

            {error && (
              <div style={{ fontSize: 11.5, color: "var(--danger, #e5484d)", marginTop: 10 }}>
                {error}
              </div>
            )}
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              gap: 9,
              padding: "14px 20px",
              marginTop: 6,
              borderTop: "1px solid var(--border)",
            }}
          >
            <Dialog.Close asChild>
              <button type="button" style={ghostBtn} disabled={busy}>
                Cancel
              </button>
            </Dialog.Close>
            <button
              type="button"
              onClick={save}
              disabled={!canSave}
              style={{
                ...accentBtn,
                opacity: canSave ? 1 : 0.5,
                cursor: canSave ? "pointer" : "not-allowed",
              }}
            >
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
