import { useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Sparkles, X } from "lucide-react";
import type { CustomStyleInfo } from "@latteart/shared";
import { useProject } from "../stores/projectStore";
import { useStyles } from "../stores/stylesStore";
import { RefImagePicker, type RefImageItem } from "./RefImagePicker";

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
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
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

/**
 * Create a custom style from reference image(s). The user drops or picks images
 * and (optionally) names the style; the backend distills them into a reusable
 * descriptor. On success the new style is selected (`onCreated`).
 */
export function NewStyleDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (info: CustomStyleInfo) => void;
}) {
  const createStyle = useStyles((s) => s.create);
  const projectId = useProject((s) => s.id);
  const [refs, setRefs] = useState<RefImageItem[]>([]);
  const [label, setLabel] = useState("");
  // Default scope = the open project (chosen with the user); untick for global.
  const [scopeToProject, setScopeToProject] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextId = useRef(0);

  const reset = () => {
    setRefs([]);
    setLabel("");
    setScopeToProject(true);
    setError(null);
    setBusy(false);
  };

  const create = async () => {
    if (refs.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const info = await createStyle(
        refs.map((r) => r.url),
        label.trim() || undefined,
        // An empty id (the brief pre-hydration window while the connection is
        // still resolving) deliberately falls back to global rather than
        // scoping to a project that doesn't exist.
        scopeToProject ? projectId || undefined : undefined,
      );
      onCreated(info);
      onOpenChange(false);
      reset();
    } catch (err) {
      setError((err as Error).message || "Couldn't create the style.");
      setBusy(false);
    }
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
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
                New style from images
              </Dialog.Title>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                Reference images become a reusable style you can apply to any prompt.
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

          {/* The reference grid grows with the list, so the fields scroll and
              the footer stays reachable — .dlg-content caps the height and
              clips, it does not scroll. */}
          <div style={{ padding: "16px 20px 4px", overflowY: "auto", flex: "1 1 auto" }}>
            <RefImagePicker
              items={refs}
              disabled={busy}
              onAdd={(added) => {
                setError(null);
                setRefs((prev) => [
                  ...prev,
                  ...added.map((a) => ({
                    key: `new-${nextId.current++}`,
                    url: a.dataUrl,
                    name: a.name,
                  })),
                ]);
              }}
              onRemove={(key) => setRefs((prev) => prev.filter((x) => x.key !== key))}
            />

            {/* name */}
            <div style={{ marginTop: 14 }}>
              <label
                style={{
                  display: "block",
                  fontSize: 11.5,
                  color: "var(--text-muted)",
                  marginBottom: 6,
                }}
              >
                Name <span style={{ color: "var(--text-faint)" }}>(optional)</span>
              </label>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Neon noir"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void create();
                }}
                style={{
                  width: "100%",
                  height: 34,
                  padding: "0 11px",
                  background: "var(--surface-2)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  color: "var(--text)",
                  fontFamily: "inherit",
                  fontSize: 12.5,
                  outline: "none",
                }}
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
              flex: "none",
            }}
          >
            <Dialog.Close asChild>
              <button type="button" style={ghostBtn} disabled={busy}>
                Cancel
              </button>
            </Dialog.Close>
            <button
              type="button"
              onClick={create}
              disabled={refs.length === 0 || busy}
              style={{
                ...accentBtn,
                opacity: refs.length === 0 || busy ? 0.5 : 1,
                cursor: refs.length === 0 || busy ? "not-allowed" : "pointer",
              }}
            >
              <Sparkles size={14} strokeWidth={1.9} />
              {busy ? "Distilling…" : "Create style"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
