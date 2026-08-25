import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, Download, Settings, Sparkles } from "lucide-react";
import { useState } from "react";
import { LogoMark } from "./LogoMark";
import { ProjectMenu } from "./ProjectMenu";
import { downloadBlob, safeFilename } from "../lib/download";
import { exportOraOffThread, exportPngOffThread } from "../lib/exporter";
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

const exportItem: React.CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  gap: 2,
  maxWidth: 260,
};

const exportNote: React.CSSProperties = {
  color: "var(--text-faint)",
  fontSize: 11,
  lineHeight: 1.35,
  whiteSpace: "normal",
};

export function Topbar() {
  const providers = useProviders((s) => s.providers);
  const providerId = useSession((s) => s.providerId);
  const model = useSession((s) => s.model);
  const setProvider = useSession((s) => s.setProvider);
  const openSettings = useSession((s) => s.openSettings);
  const layers = useDocument((s) => s.layers);
  const merge = useGeneration((s) => s.merge);
  const busy = useGeneration((s) => s.busy);
  const setError = useGeneration((s) => s.setError);
  const saveStatus = useProject((s) => s.status);
  const projectName = useProject((s) => s.name);
  const [exporting, setExporting] = useState(false);
  // Step progress from the worker, null until the first report. Component
  // state, not a store — the button label is the only consumer.
  const [exportPct, setExportPct] = useState<number | null>(null);

  const active = providers.find((p) => p.id === providerId);
  const activeModelLabel =
    active?.models.find((m) => m.id === model)?.label ?? active?.models[0]?.label ?? "";
  const pickerLabel = active
    ? `${active.label}${activeModelLabel ? ` · ${activeModelLabel}` : ""}`
    : "Select provider";

  const hasImages = layers.some((l) => l.visible && l.src);
  // An .ora keeps hidden layers, so it has something to export when a PNG
  // wouldn't — a document whose every layer is hidden is still a document.
  const hasLayers = layers.some((l) => l.src);
  // Merge stays clickable mid-run — it queues, and flattens whatever the
  // canvas holds when its turn comes (including results of jobs ahead of it).
  const canMerge = hasImages && !!active?.available && active.capabilities.img2img;
  const canExport = hasLayers && !busy && !exporting;

  // Both throw rather than returning quietly when there is nothing to save:
  // the button has already flipped to "Exporting…", so a silent return reads
  // as a download that vanished. `runExport` turns it into a toast. The work
  // itself runs in lib/export.worker — the canvas stays live while it encodes.
  const onExportPng = async () => {
    const blob = await exportPngOffThread(useDocument.getState().layers, (done, total) =>
      setExportPct(Math.round((done / total) * 100)),
    );
    if (!blob) throw new Error("Export failed: nothing visible to flatten");
    downloadBlob(blob, safeFilename(projectName, "png", "latteart"));
  };

  const onExportOra = async () => {
    const blob = await exportOraOffThread(useDocument.getState().layers, (done, total) =>
      setExportPct(Math.round((done / total) * 100)),
    );
    if (!blob) throw new Error("Export failed: no layer has pixels yet");
    downloadBlob(blob, safeFilename(projectName, "ora", "latteart"));
  };

  const runExport = (job: () => Promise<void>) => {
    setExporting(true);
    setExportPct(null);
    void job()
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Export failed"))
      .finally(() => {
        setExporting(false);
        setExportPct(null);
      });
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
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        <LogoMark />
        <span style={{ fontSize: 13.5, fontWeight: 600, letterSpacing: "-.01em" }}>latteart</span>
        <span style={{ color: "var(--text-faint)", fontSize: 13 }}>/</span>
        <ProjectMenu />
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

        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild disabled={!canExport}>
            <button
              type="button"
              title={
                busy
                  ? "Wait for the current generation — export would omit the in-progress layer"
                  : hasLayers
                    ? "Export the canvas"
                    : "Nothing to export yet"
              }
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                height: 30,
                padding: "0 10px 0 12px",
                borderRadius: 8,
                background: "var(--surface-2)",
                border: "1px solid var(--border)",
                color: "var(--text)",
                fontSize: 12,
                fontWeight: 500,
                fontFamily: "inherit",
                cursor: canExport ? "pointer" : "not-allowed",
                opacity: canExport ? 1 : 0.5,
              }}
            >
              <Download size={15} strokeWidth={1.7} />
              {!exporting
                ? "Export"
                : exportPct === null
                  ? "Exporting…"
                  : `Exporting · ${exportPct}%`}
              <ChevronDown size={13} strokeWidth={1.9} color="var(--text-faint)" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="dd-content" sideOffset={8} align="end">
              <DropdownMenu.Item
                className="dd-item"
                disabled={!hasImages}
                onSelect={() => runExport(onExportPng)}
              >
                <span style={exportItem}>
                  PNG
                  <span style={exportNote}>One flattened image</span>
                </span>
              </DropdownMenu.Item>
              <DropdownMenu.Item className="dd-item" onSelect={() => runExport(onExportOra)}>
                <span style={exportItem}>
                  OpenRaster · .ora
                  <span style={exportNote}>
                    Opens in Krita &amp; GIMP. Layers, opacity and blend modes stay editable; masks
                    and rotation bake into the pixels.
                  </span>
                </span>
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>

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
