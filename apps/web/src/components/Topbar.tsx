import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, Download, Settings, Sparkles } from "lucide-react";
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
  const setProvider = useSession((s) => s.setProvider);
  const openSettings = useSession((s) => s.openSettings);
  const layers = useDocument((s) => s.layers);
  const merge = useGeneration((s) => s.merge);
  const busy = useGeneration((s) => s.busy);
  const saveStatus = useProject((s) => s.status);

  const active = providers.find((p) => p.id === providerId);
  const activeModelLabel =
    active?.models.find((m) => m.id === model)?.label ?? active?.models[0]?.label ?? "";
  const pickerLabel = active
    ? `${active.label}${activeModelLabel ? ` · ${activeModelLabel}` : ""}`
    : "Select provider";

  const hasImages = layers.some((l) => l.visible && l.src);
  // Merge stays clickable mid-run — it queues, and flattens whatever the
  // canvas holds when its turn comes (including results of jobs ahead of it).
  const canMerge = hasImages && !!active?.available && active.capabilities.img2img;

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
    merge({ providerId: active.id, model: model ?? undefined });
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
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              title="Provider & model used for generations"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                height: 30,
                padding: "0 11px",
                borderRadius: 8,
                background: "var(--surface-2)",
                border: "1px solid var(--border)",
                color: "var(--text)",
                fontSize: 12,
                fontWeight: 500,
                fontFamily: "inherit",
                cursor: "pointer",
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 9,
                  background: active?.available ? "var(--ok)" : "#8a8f98",
                  boxShadow: active?.available ? "0 0 8px rgba(62,207,142,.7)" : "none",
                }}
              />
              {pickerLabel}
              <ChevronDown size={13} strokeWidth={1.9} color="var(--text-faint)" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="dd-content" sideOffset={8} align="end">
              {providers.map((p) => (
                <DropdownMenu.Item
                  key={p.id}
                  className="dd-item"
                  onSelect={() =>
                    p.available ? setProvider(p.id, p.models[0]?.id ?? null) : openSettings()
                  }
                >
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: 9,
                      flex: "none",
                      background: p.available ? "var(--ok)" : "var(--text-faint)",
                    }}
                  />
                  <span style={{ flex: 1 }}>
                    {p.label}
                    <span style={{ color: "var(--text-faint)" }}>
                      {p.models[0] ? ` · ${p.models[0].label}` : ""}
                    </span>
                  </span>
                  {!p.available && (
                    <span style={{ fontSize: 10.5, color: "var(--text-faint)" }}>
                      {p.requiresKey ? "needs key" : "connect"}
                    </span>
                  )}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>

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
          disabled={!hasImages || busy}
          title={
            busy
              ? "Wait for the current generation — export would omit the in-progress layer"
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
            cursor: hasImages && !busy ? "pointer" : "not-allowed",
            opacity: hasImages && !busy ? 1 : 0.5,
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
