import { Download, Settings, Sparkles } from "lucide-react";
import { LogoMark } from "./LogoMark";
import { flattenLayers } from "../lib/flatten";
import { useDocument } from "../stores/documentStore";
import { useGeneration } from "../stores/generationStore";
import { useProject } from "../stores/projectStore";
import { useProviders } from "../stores/providersStore";
import { useSession } from "../stores/sessionStore";

const SAVE_LABELS = {
  idle: null,
  saving: "Saving…",
  saved: "Saved ✓",
  error: "Save failed — retrying",
} as const;

export function Topbar() {
  const providers = useProviders((s) => s.providers);
  const providerId = useSession((s) => s.providerId);
  const model = useSession((s) => s.model);
  const openSettings = useSession((s) => s.openSettings);
  const layers = useDocument((s) => s.layers);
  const running = useGeneration((s) => s.running);
  const merge = useGeneration((s) => s.merge);
  const saveStatus = useProject((s) => s.status);

  const active = providers.find((p) => p.id === providerId);
  const keyed = active?.kind === "cloud" && active.hasKey;
  const statusLabel = active
    ? `${active.label}${active.kind === "local" ? " · local" : keyed ? " · key set" : ""}`
    : "No provider";

  const hasImages = layers.some((l) => l.visible && l.src);
  const canMerge = hasImages && !running && !!active?.available && active.capabilities.img2img;

  const onExport = async () => {
    const flat = await flattenLayers(useDocument.getState().layers, { pixelRatio: 2 });
    if (!flat) return;
    const a = document.createElement("a");
    a.href = flat.dataUrl;
    a.download = "latteart.png";
    a.click();
  };

  const onMerge = () => {
    if (!active) return;
    void merge({ providerId: active.id, model: model ?? undefined });
  };

  return (
    <header
      style={{
        height: 52,
        flex: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 12px 0 14px",
        borderBottom: "1px solid var(--border)",
        background: "var(--surface-1)",
        position: "relative",
        zIndex: 6,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <LogoMark />
        <span style={{ fontSize: 13.5, fontWeight: 600, letterSpacing: "-.01em" }}>latteart</span>
        {SAVE_LABELS[saveStatus] && (
          <span
            style={{
              fontSize: 11,
              color: saveStatus === "error" ? "#f0616d" : "var(--text-faint)",
              marginTop: 1,
            }}
          >
            {SAVE_LABELS[saveStatus]}
          </span>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            height: 30,
            padding: "0 11px",
            borderRadius: 8,
            background: "var(--surface-2)",
            border: "1px solid var(--border)",
            fontSize: 12,
            color: "var(--text-muted)",
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 9,
              background: keyed ? "var(--ok)" : "#8a8f98",
              boxShadow: keyed ? "0 0 8px rgba(62,207,142,.7)" : "none",
            }}
          />
          <span style={{ color: "var(--text)", fontWeight: 500 }}>{statusLabel}</span>
        </div>

        <button
          type="button"
          onClick={onMerge}
          disabled={!canMerge}
          title={
            !hasImages
              ? "Add or generate a layer first"
              : !active?.available
                ? "Connect a provider with a key in Settings"
                : !active.capabilities.img2img
                  ? `${active.label} can't do image-to-image`
                  : "AI Merge — blend all visible layers into one image"
          }
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            height: 30,
            padding: "0 12px",
            borderRadius: 8,
            background: "var(--surface-2)",
            border: "1px solid var(--border)",
            color: "var(--text)",
            fontSize: 12,
            fontWeight: 500,
            fontFamily: "inherit",
            cursor: canMerge ? "pointer" : "not-allowed",
            opacity: canMerge ? 1 : 0.5,
          }}
        >
          <Sparkles size={15} strokeWidth={1.7} />
          AI Merge
        </button>

        <button
          type="button"
          onClick={onExport}
          disabled={!hasImages || running}
          title={
            running
              ? "Wait for the current generation to finish"
              : hasImages
                ? "Export — flatten visible layers to PNG"
                : "Nothing to export yet"
          }
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            height: 30,
            padding: "0 12px",
            borderRadius: 8,
            background: "var(--surface-2)",
            border: "1px solid var(--border)",
            color: "var(--text)",
            fontSize: 12,
            fontWeight: 500,
            fontFamily: "inherit",
            cursor: hasImages && !running ? "pointer" : "not-allowed",
            opacity: hasImages && !running ? 1 : 0.5,
          }}
        >
          <Download size={15} strokeWidth={1.7} />
          Export
        </button>

        <button
          type="button"
          onClick={openSettings}
          title="Settings"
          style={{
            width: 30,
            height: 30,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 8,
            background: "transparent",
            border: "1px solid transparent",
            color: "var(--text-muted)",
            cursor: "pointer",
          }}
        >
          <Settings size={17} strokeWidth={1.6} />
        </button>
      </div>
    </header>
  );
}
