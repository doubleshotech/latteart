import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Sparkles, X } from "lucide-react";
import type { UpdateStyleApiRequest } from "@latteart/shared";
import { fetchStyleDetail, styleRefUrl } from "../api/styles";
import { makeThumbnail } from "../lib/palette";
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
 * Rename a custom style, edit its distilled descriptor, and add or remove the
 * reference images it was derived from. The descriptor and the reference list
 * are fetched per-style on open (the list payload stays descriptor-free).
 *
 * The images are the style's identity, so changing them keeps the id (every
 * saved session that selects this style keeps working) and the scope. Two
 * things follow the list: the picker thumbnail, rebuilt from whichever image
 * ends up first, and — only when the user asks — the descriptor, re-distilled
 * by "Re-describe" from the images the server has stored. That button reads
 * disk, so it waits until pending image edits are saved.
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
  const describe = useStyles((s) => s.describe);
  const projectId = useProject((s) => s.id);
  const [label, setLabel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  // Scope row. The picker only lists global styles and the open project's own,
  // so "checked" simply means scoped-to-this-project vs global.
  const [scopeToProject, setScopeToProject] = useState(false);
  // Reference images. A kept one carries its storage ref as `key` (that token
  // goes straight back to the server); an added one carries a local key and a
  // data: URL. `savedRefs` is the list on disk, for change detection.
  const [refs, setRefs] = useState<RefImageItem[]>([]);
  const [savedRefs, setSavedRefs] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [describing, setDescribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextId = useRef(0);

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
    setRefs([]);
    setSavedRefs([]);
    setLoading(true);
    setError(null);
    fetchStyleDetail(styleId)
      .then((d) => {
        if (cancelled) return;
        setLabel(d.label);
        setPrompt(d.prompt);
        setNegativePrompt(d.negativePrompt ?? "");
        setScopeToProject(!!d.projectId && d.projectId === useProject.getState().id);
        setSavedRefs(d.refs);
        setRefs(
          d.refs.map((ref, i) => ({
            key: ref,
            url: styleRefUrl(styleId, ref),
            name: `Reference ${i + 1}`,
          })),
        );
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

  // A style is derived from images, so it keeps at least one — the same rule
  // create enforces.
  const refsChanged =
    refs.length !== savedRefs.length || refs.some((r, i) => r.key !== savedRefs[i]);
  const busyAtAll = busy || describing;
  const canSave =
    !loading && !busyAtAll && label.trim() !== "" && prompt.trim() !== "" && refs.length > 0;

  const save = async () => {
    if (!styleId || !canSave) return;
    setBusy(true);
    setError(null);
    try {
      const patch: UpdateStyleApiRequest = {
        label: label.trim(),
        prompt: prompt.trim(),
        negativePrompt: negativePrompt.trim(),
        // Three-way on the wire, two states here: the open project's id or
        // global (null). Guarded on a known project id so a not-yet-hydrated
        // boot can never silently re-scope a style.
        ...(projectId ? { projectId: scopeToProject ? projectId : null } : {}),
      };
      if (refsChanged) {
        // A kept image travels as its storage token, an added one as its data:
        // URL — the server resolves both against this style's current refs.
        const kept = new Set(savedRefs);
        patch.refs = refs.map((r) => (kept.has(r.key) ? r.key : r.url));
        // The thumbnail follows the first image. Only rebuilt when that image
        // changed, and omitted when it can't be decoded — a missing preview
        // must not replace a good one.
        if (refs[0]?.key !== savedRefs[0]) {
          const thumbnail = await makeThumbnail(refs[0]!.url);
          if (thumbnail) patch.thumbnail = thumbnail;
        }
      }
      await update(styleId, patch);
      onOpenChange(false);
    } catch (err) {
      setError((err as Error).message || "Couldn't save the style.");
    } finally {
      setBusy(false);
    }
  };

  /** Re-distill the descriptor from the images the server has on disk. */
  const redescribe = async () => {
    if (!styleId || loading || busyAtAll || refsChanged) return;
    setDescribing(true);
    setError(null);
    try {
      const detail = await describe(styleId);
      setPrompt(detail.prompt);
      setNegativePrompt(detail.negativePrompt ?? "");
    } catch (err) {
      setError((err as Error).message || "Couldn't read the reference images.");
    } finally {
      setDescribing(false);
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
                The description composes into your prompts. The images condition providers that read
                them.
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
              <label style={fieldLabel}>Reference images</label>
              <RefImagePicker
                items={refs}
                disabled={loading || busyAtAll}
                hint="The style keeps its name and where it applies · at least one image"
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
            </div>

            <div style={{ marginTop: 14 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  marginBottom: 6,
                }}
              >
                <label style={{ ...fieldLabel, marginBottom: 0 }}>Style description</label>
                <button
                  type="button"
                  onClick={redescribe}
                  disabled={loading || busyAtAll || refsChanged}
                  title={
                    refsChanged
                      ? "Save the image changes first — this reads the stored images."
                      : "Write the description again from the reference images."
                  }
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    height: 24,
                    padding: "0 9px",
                    borderRadius: 7,
                    background: "var(--surface-2)",
                    border: "1px solid var(--border)",
                    color: "var(--text-muted)",
                    fontFamily: "inherit",
                    fontSize: 11,
                    fontWeight: 500,
                    cursor: loading || busyAtAll || refsChanged ? "not-allowed" : "pointer",
                    opacity: loading || busyAtAll || refsChanged ? 0.5 : 1,
                  }}
                >
                  <Sparkles size={12} strokeWidth={1.9} />
                  {describing ? "Reading…" : "Re-describe"}
                </button>
              </div>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                disabled={loading || describing}
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
                disabled={loading || describing}
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
              flex: "none",
            }}
          >
            <Dialog.Close asChild>
              <button type="button" style={ghostBtn} disabled={busyAtAll}>
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
