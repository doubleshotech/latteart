import {
  Copy,
  Download,
  Eraser,
  Image as ImageIcon,
  LayoutGrid,
  Repeat2,
  SquareDashed,
  X,
} from "lucide-react";
import { useDocument, type Layer } from "../stores/documentStore";
import { useGeneration } from "../stores/generationStore";
import { useProviders } from "../stores/providersStore";
import { useSession } from "../stores/sessionStore";

/** Rasterize a layer's image (any data: URL, SVG included) and download as PNG. */
async function exportLayerPng(layer: Layer) {
  if (!layer.src) return;
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("image failed to load"));
    img.src = layer.src!;
  });
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth || Math.max(1, Math.round(layer.width));
  canvas.height = img.naturalHeight || Math.max(1, Math.round(layer.height));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable for export");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const a = document.createElement("a");
  a.href = canvas.toDataURL("image/png");
  a.download = `${layer.name.replace(/[^\w\- ]+/g, "").trim() || "layer"}.png`;
  a.click();
}

const iconBox = (active: boolean): React.CSSProperties => ({
  width: 26,
  height: 26,
  flex: "none",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 6,
  background: active ? "color-mix(in srgb, var(--accent) 16%, transparent)" : "var(--surface-2)",
  color: active ? "var(--accent)" : "var(--text-muted)",
});

const monoTag: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 9.5,
  color: "var(--text-faint)",
};

function ActionRow({
  icon,
  label,
  tag,
  drillIn,
  accent,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  tag?: string;
  drillIn?: boolean;
  accent?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className="action-row"
      disabled={disabled}
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        height: 38,
        padding: drillIn ? "0 8px 0 7px" : "0 10px 0 7px",
        borderRadius: 8,
        background: "transparent",
        border: "1px solid transparent",
        color: "var(--text)",
        fontFamily: "inherit",
        cursor: disabled ? "not-allowed" : "pointer",
        textAlign: "left",
        opacity: disabled ? 0.55 : 1,
        width: "100%",
      }}
    >
      <span style={iconBox(!!accent)}>{icon}</span>
      <span style={{ flex: 1, fontSize: 12.5, fontWeight: 500 }}>{label}</span>
      {tag && <span style={monoTag}>{tag}</span>}
      {drillIn && (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--text-faint)"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
      )}
    </button>
  );
}

/**
 * The actions dock — appears at the top of the layer panel when a ready layer
 * is selected (mockup screen 3). Every action is non-destructive: the result
 * always lands as a new layer above the source.
 */
export function ActionsDock({ layer }: { layer: Layer }) {
  const select = useDocument((s) => s.select);
  const addLayer = useDocument((s) => s.addLayer);

  const providers = useProviders((s) => s.providers);
  const providerId = useSession((s) => s.providerId);
  const model = useSession((s) => s.model);
  const openAction = useSession((s) => s.openAction);
  const openSettings = useSession((s) => s.openSettings);

  const running = useGeneration((s) => s.running);
  const runAction = useGeneration((s) => s.runAction);

  const openMaskEdit = useSession((s) => s.openMaskEdit);

  const active = providers.find((p) => p.id === providerId);
  const canEdit = !!active?.available && active.capabilities.img2img && !running;
  // Provider is keyed but can't do img2img — disable the actions (guard still
  // redirects unkeyed providers to Settings); the wrapper title explains why.
  const noImg2img = !!active?.available && !active.capabilities.img2img;
  // Edit area needs a mask-capable (inpaint) provider — a separate capability
  // from img2img, so it must NOT be gated on canEdit/guard() below.
  const canInpaint = !!active?.available && !!active.capabilities.inpaint && !running;
  const noInpaint = !!active?.available && !active.capabilities.inpaint;
  const inpaintTitle = !active?.available
    ? "Connect a provider in Settings"
    : !active.capabilities.inpaint
      ? `${active.label} can't inpaint — try ComfyUI`
      : undefined;
  const editBlockedTitle = !active?.available
    ? "Connect a provider with a key in Settings"
    : !active.capabilities.img2img
      ? `${active.label} can't do image-to-image`
      : undefined;

  /** Route to the drill-in / action when possible; to Settings when not keyed. */
  const guard = (fn: () => void) => () => {
    if (!active?.available) {
      openSettings();
      return;
    }
    if (!canEdit) return;
    fn();
  };

  const duplicate = () => {
    // A plain copy — not derived from anything, and not mid-generation.
    const { id: _id, ...rest } = layer;
    addLayer({
      ...rest,
      name: `${layer.name} copy`,
      x: layer.x + 20,
      y: layer.y + 20,
      derivedFrom: null,
      progress: 0,
    });
  };

  return (
    <div
      style={{
        flex: "none",
        padding: 8,
        borderBottom: "1px solid var(--border)",
        background: "color-mix(in srgb, var(--accent) 4%, transparent)",
      }}
    >
      {/* selected-layer header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 4px 8px" }}>
        {layer.src ? (
          <img
            src={layer.src}
            alt=""
            draggable={false}
            style={{
              width: 26,
              height: 26,
              borderRadius: 6,
              flex: "none",
              border: "1px solid var(--border-strong)",
              objectFit: "cover",
            }}
          />
        ) : (
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: 6,
              flex: "none",
              border: "1px solid var(--border-strong)",
              background: "var(--surface-2)",
            }}
          />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9.5,
              color: "var(--accent)",
              letterSpacing: ".08em",
            }}
          >
            EDITING LAYER
          </div>
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "#fff",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {layer.name}
          </div>
        </div>
        <button
          type="button"
          title="Deselect"
          onClick={() => select(null)}
          style={{
            width: 22,
            height: 22,
            flex: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 6,
            background: "transparent",
            border: "none",
            color: "var(--text-faint)",
            cursor: "pointer",
          }}
        >
          <X size={13} strokeWidth={1.9} />
        </button>
      </div>

      {/* action list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }} title={editBlockedTitle}>
        <ActionRow
          icon={<Repeat2 size={15} strokeWidth={1.8} />}
          label="Remix"
          tag="img2img"
          drillIn
          accent
          disabled={running || noImg2img}
          onClick={guard(() => openAction("remix", layer.id))}
        />
        <ActionRow
          icon={<Eraser size={15} strokeWidth={1.7} />}
          label="Remove background"
          tag="1-click"
          disabled={running || noImg2img}
          onClick={guard(
            () =>
              void runAction({
                providerId: active!.id,
                model: model ?? undefined,
                kind: "remove-bg",
                sourceId: layer.id,
                detail: `img2img · ${active!.label}`,
              }),
          )}
        />
        <ActionRow
          icon={<ImageIcon size={15} strokeWidth={1.7} />}
          label="Change background"
          drillIn
          disabled={running || noImg2img}
          onClick={guard(() => openAction("change-bg", layer.id))}
        />
        <ActionRow
          icon={<LayoutGrid size={15} strokeWidth={1.7} />}
          label="Variations"
          drillIn
          disabled={running || noImg2img}
          onClick={guard(() => openAction("variations", layer.id))}
        />
        {/* Edit area — inpaint; needs a mask-capable provider. Enabled when no
            provider is connected so it can route to Settings like its siblings;
            disabled only when a connected provider can't inpaint. */}
        <div title={inpaintTitle}>
          <ActionRow
            icon={<SquareDashed size={15} strokeWidth={1.6} />}
            label="Edit area"
            tag="inpaint"
            drillIn
            disabled={running || noInpaint}
            onClick={() => {
              if (!active?.available) {
                openSettings();
                return;
              }
              if (canInpaint) openMaskEdit(layer.id);
            }}
          />
        </div>
      </div>

      {/* utilities */}
      <div
        style={{
          display: "flex",
          gap: 6,
          marginTop: 8,
          paddingTop: 8,
          borderTop: "1px solid var(--border)",
        }}
      >
        <button type="button" className="util-btn" onClick={duplicate}>
          <Copy size={13} strokeWidth={1.7} />
          Duplicate
        </button>
        <button
          type="button"
          className="util-btn"
          disabled={!layer.src}
          onClick={() => {
            exportLayerPng(layer).catch((e: Error) =>
              useGeneration.setState({ error: `Export failed: ${e.message}` }),
            );
          }}
        >
          <Download size={13} strokeWidth={1.7} />
          Export PNG
        </button>
      </div>
    </div>
  );
}
