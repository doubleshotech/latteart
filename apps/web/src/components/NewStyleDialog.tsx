import { useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ImagePlus, Sparkles, X } from "lucide-react";
import type { CustomStyleInfo } from "@latteart/shared";
import { fileToDataUrl } from "../lib/palette";
import { useStyles } from "../stores/stylesStore";

interface Ref {
  id: number;
  name: string;
  dataUrl: string;
}

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
  const [refs, setRefs] = useState<Ref[]>([]);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const nextId = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);

  const reset = () => {
    setRefs([]);
    setLabel("");
    setError(null);
    setBusy(false);
    setDragging(false);
  };

  const addFiles = async (files: FileList | File[]) => {
    const images = [...files].filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) return;
    setError(null);
    const added = await Promise.all(
      images.map(async (f) => ({
        id: nextId.current++,
        name: f.name,
        dataUrl: await fileToDataUrl(f),
      })),
    );
    setRefs((prev) => [...prev, ...added]);
  };

  const create = async () => {
    if (refs.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const info = await createStyle(
        refs.map((r) => r.dataUrl),
        label.trim() || undefined,
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

          <div style={{ padding: "16px 20px 4px" }}>
            {/* drop zone / picker */}
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                void addFiles(e.dataTransfer.files);
              }}
              style={{
                width: "100%",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 8,
                padding: "22px 16px",
                borderRadius: 12,
                border: `1.5px dashed ${dragging ? "var(--accent)" : "var(--border-strong)"}`,
                background: dragging
                  ? "color-mix(in srgb, var(--accent) 8%, transparent)"
                  : "var(--surface-2)",
                color: "var(--text-muted)",
                fontFamily: "inherit",
                fontSize: 12.5,
                cursor: "pointer",
              }}
            >
              <ImagePlus size={22} strokeWidth={1.6} color="var(--text-faint)" />
              <span>
                <span style={{ color: "var(--accent)", fontWeight: 600 }}>Click to choose</span> or
                drop images here
              </span>
              <span style={{ fontSize: 11, color: "var(--text-faint)" }}>
                1–5 references work best · PNG, JPG, WebP
              </span>
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files) void addFiles(e.target.files);
                e.target.value = "";
              }}
            />

            {/* thumbnails */}
            {refs.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
                {refs.map((r) => (
                  <div
                    key={r.id}
                    style={{
                      position: "relative",
                      width: 64,
                      height: 64,
                      borderRadius: 8,
                      overflow: "hidden",
                      border: "1px solid var(--border)",
                    }}
                  >
                    <img
                      src={r.dataUrl}
                      alt={r.name}
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                    <button
                      type="button"
                      aria-label={`Remove ${r.name}`}
                      onClick={() => setRefs((prev) => prev.filter((x) => x.id !== r.id))}
                      style={{
                        position: "absolute",
                        top: 3,
                        right: 3,
                        width: 18,
                        height: 18,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: "50%",
                        background: "rgba(0,0,0,.6)",
                        border: "none",
                        color: "#fff",
                        cursor: "pointer",
                        padding: 0,
                      }}
                    >
                      <X size={11} strokeWidth={2.4} />
                    </button>
                  </div>
                ))}
              </div>
            )}

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
