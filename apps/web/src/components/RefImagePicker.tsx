import { useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { fileToDataUrl } from "../lib/palette";

/**
 * One reference image in the picker. `url` is whatever an `<img>` can load: a
 * data: URL for a file the user just added, or the server's refs URL for one
 * the style already stores (see api/styles.styleRefUrl) — so editing a style's
 * references never pulls a full-size image through base64.
 */
export interface RefImageItem {
  /** Stable identity for React and for removal. */
  key: string;
  url: string;
  name: string;
}

/** A file the user added, ready to become a {@link RefImageItem}. */
export interface AddedRefImage {
  name: string;
  dataUrl: string;
}

/**
 * Drop zone plus thumbnail grid for a custom style's reference images. Shared by
 * the create and edit dialogs so the two lists look and behave the same; the
 * caller owns the list itself (create sends the data URLs, edit sends a mix of
 * kept refs and new ones).
 */
export function RefImagePicker({
  items,
  onAdd,
  onRemove,
  disabled = false,
  hint = "1–5 references work best · PNG, JPG, WebP",
}: {
  items: RefImageItem[];
  onAdd: (added: AddedRefImage[]) => void;
  onRemove: (key: string) => void;
  disabled?: boolean;
  hint?: string;
}) {
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const addFiles = async (files: FileList | File[]) => {
    const images = [...files].filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) return;
    onAdd(
      await Promise.all(
        images.map(async (f) => ({ name: f.name, dataUrl: await fileToDataUrl(f) })),
      ),
    );
  };

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => fileInput.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!disabled) void addFiles(e.dataTransfer.files);
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
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <ImagePlus size={22} strokeWidth={1.6} color="var(--text-faint)" />
        <span>
          <span style={{ color: "var(--accent)", fontWeight: 600 }}>Click to choose</span> or drop
          images here
        </span>
        <span style={{ fontSize: 11, color: "var(--text-faint)" }}>{hint}</span>
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

      {items.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
          {items.map((item) => (
            <div
              key={item.key}
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
                src={item.url}
                alt={item.name}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
              <button
                type="button"
                aria-label={`Remove ${item.name}`}
                disabled={disabled}
                onClick={() => onRemove(item.key)}
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
                  cursor: disabled ? "not-allowed" : "pointer",
                  padding: 0,
                }}
              >
                <X size={11} strokeWidth={2.4} />
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
