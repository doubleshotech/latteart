import { useEffect, useState } from "react";
import * as Slider from "@radix-ui/react-slider";
import { Eye, EyeOff, GitBranch, GripVertical, Plus, Sparkles, Trash2 } from "lucide-react";
import { cn } from "../lib/utils";
import { useDocument, type Layer } from "../stores/documentStore";
import { useGeneration } from "../stores/generationStore";
import { useSession } from "../stores/sessionStore";
import { ActionDrillIn } from "./ActionDrillIn";
import { ActionsDock } from "./ActionsDock";
import { OutpaintDrillIn } from "./OutpaintDrillIn";
import { SmartEditPanel } from "./SmartEditPanel";

function Thumb({ layer }: { layer: Layer }) {
  const base: React.CSSProperties = {
    width: 38,
    height: 38,
    borderRadius: 6,
    flex: "none",
    border: "1px solid var(--border)",
    overflow: "hidden",
  };
  if (layer.status === "generating") {
    return (
      <div
        style={{
          ...base,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--surface-2)",
          backgroundImage:
            "linear-gradient(100deg, transparent 30%, rgba(255,255,255,.07) 50%, transparent 70%)",
          backgroundSize: "220% 100%",
          animation: "latte-sheen 1.4s linear infinite",
        }}
      >
        <span
          style={{
            width: 15,
            height: 15,
            borderRadius: "50%",
            border: "2.4px solid rgba(255,255,255,0.15)",
            borderTopColor: "var(--accent)",
            animation: "latte-spin 0.9s linear infinite",
          }}
        />
      </div>
    );
  }
  if (layer.src) {
    return (
      <img
        src={layer.src}
        alt={layer.name}
        style={{ ...base, objectFit: "cover" }}
        draggable={false}
      />
    );
  }
  return <div style={{ ...base, background: "linear-gradient(150deg,#3b1f42,#1b2338)" }} />;
}

function LayerRow({ layer }: { layer: Layer }) {
  const selectedId = useDocument((s) => s.selectedId);
  const select = useDocument((s) => s.select);
  const updateLayer = useDocument((s) => s.updateLayer);
  const removeLayer = useDocument((s) => s.removeLayer);
  const reorder = useDocument((s) => s.reorder);
  const layers = useDocument((s) => s.layers);
  const action = useGeneration((s) => s.action);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(layer.name);

  const selected = layer.id === selectedId;
  const generating = layer.status === "generating";
  /** Working row for an editor action (mockup screen 5): accent tint + provenance. */
  const workingAction = generating && !!layer.derivedFrom;
  /** The layer an action is currently reading from. */
  const isActionSource = action?.sourceId === layer.id;

  const commit = () => {
    const name = draft.trim();
    if (name) updateLayer(layer.id, { name });
    else setDraft(layer.name);
    setEditing(false);
  };

  return (
    <div
      className={cn("layer-row", selected && "is-selected")}
      style={{
        opacity: !layer.visible ? 0.55 : isActionSource ? 0.7 : 1,
        ...(workingAction && {
          background: "color-mix(in srgb, var(--accent) 9%, transparent)",
          border: "1px solid color-mix(in srgb, var(--accent) 30%, transparent)",
        }),
      }}
      onMouseDown={() => select(layer.id)}
      draggable={!editing}
      onDragStart={(e) => e.dataTransfer.setData("text/layer", layer.id)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const from = e.dataTransfer.getData("text/layer");
        if (from && from !== layer.id) {
          reorder(
            from,
            layers.findIndex((l) => l.id === layer.id),
          );
        }
      }}
    >
      {selected && (
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 8,
            bottom: 8,
            width: 2,
            borderRadius: 2,
            background: "var(--accent)",
          }}
        />
      )}
      <GripVertical
        size={14}
        color="var(--text-faint)"
        style={{ flex: "none", marginLeft: 2, cursor: "grab", opacity: 0.6 }}
      />
      <Thumb layer={layer} />

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 5 }}>
        <div
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}
        >
          {editing ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit();
                if (e.key === "Escape") {
                  setDraft(layer.name);
                  setEditing(false);
                }
              }}
              onMouseDown={(e) => e.stopPropagation()}
              style={{
                flex: 1,
                minWidth: 0,
                background: "var(--surface-canvas)",
                border: "1px solid var(--border-strong)",
                borderRadius: 5,
                color: "var(--text)",
                fontSize: 12.5,
                fontFamily: "inherit",
                padding: "1px 5px",
                outline: "none",
              }}
            />
          ) : (
            <span
              onDoubleClick={() => {
                setDraft(layer.name);
                setEditing(true);
              }}
              style={{
                fontSize: 12.5,
                fontWeight: selected ? 500 : 400,
                color: selected ? "#fff" : "var(--text)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {generating && !layer.derivedFrom ? "Generating…" : layer.name}
            </span>
          )}
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: generating || !isActionSource ? 10.5 : 9.5,
              color: generating || isActionSource ? "var(--accent)" : "var(--text-muted)",
              flex: "none",
            }}
          >
            {generating
              ? `${Math.round(layer.progress)}%`
              : isActionSource
                ? "source"
                : `${Math.round(layer.opacity * 100)}%`}
          </span>
        </div>

        {workingAction && layer.derivedFrom && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              fontFamily: "var(--font-mono)",
              fontSize: 9,
              color: "var(--text-faint)",
            }}
          >
            <GitBranch size={10} strokeWidth={2.2} style={{ flex: "none" }} />
            <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              derived from {layer.derivedFrom.name}
            </span>
          </div>
        )}

        {generating ? (
          <div
            style={{
              position: "relative",
              height: 4,
              borderRadius: 3,
              background: "var(--surface-canvas)",
            }}
          >
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                width: `${layer.progress}%`,
                borderRadius: 3,
                background: "var(--accent)",
              }}
            />
          </div>
        ) : (
          <Slider.Root
            className="op-slider"
            min={0}
            max={100}
            step={1}
            value={[Math.round(layer.opacity * 100)]}
            onValueChange={([v]) => updateLayer(layer.id, { opacity: (v ?? 100) / 100 })}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <Slider.Track className="op-track">
              <Slider.Range className="op-range" />
            </Slider.Track>
            <Slider.Thumb className="op-thumb" aria-label="Opacity" />
          </Slider.Root>
        )}
      </div>

      {!generating && (
        <div style={{ display: "flex", gap: 2, flex: "none" }}>
          <button
            type="button"
            title={layer.visible ? "Hide" : "Show"}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => updateLayer(layer.id, { visible: !layer.visible })}
            style={iconBtn}
          >
            {layer.visible ? (
              <Eye size={15} strokeWidth={1.7} />
            ) : (
              <EyeOff size={15} strokeWidth={1.7} />
            )}
          </button>
          <button
            type="button"
            title="Delete"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => removeLayer(layer.id)}
            style={{ ...iconBtn, color: "var(--text-faint)" }}
          >
            <Trash2 size={14} strokeWidth={1.7} />
          </button>
        </div>
      )}
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  width: 24,
  height: 24,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 6,
  background: "transparent",
  border: "none",
  color: "var(--text-muted)",
  cursor: "pointer",
};

export function LayerPanel() {
  const layers = useDocument((s) => s.layers);
  const selectedId = useDocument((s) => s.selectedId);
  const actionView = useSession((s) => s.actionView);
  const closeAction = useSession((s) => s.closeAction);
  const reversed = [...layers].reverse();

  const selected = layers.find((l) => l.id === selectedId);
  const drillSource = actionView
    ? layers.find((l) => l.id === actionView.sourceId && l.status === "ready")
    : undefined;

  // The drill-in is anchored to one source layer — close it only when that
  // source is gone or no longer "ready". Selection changes (stray canvas clicks,
  // a PromptBar generation auto-selecting its placeholder) leave it open so the
  // user's typed prompt survives; they return via the drill-in's back button.
  useEffect(() => {
    if (actionView && !drillSource) closeAction();
  }, [actionView, drillSource, closeAction]);

  const aside: React.CSSProperties = {
    width: 288,
    flex: "none",
    background: "var(--surface-1)",
    borderLeft: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column",
  };

  if (actionView && drillSource) {
    return (
      <aside style={aside}>
        {actionView.kind === "smart-edit" ? (
          <SmartEditPanel source={drillSource} />
        ) : actionView.kind === "outpaint" ? (
          <OutpaintDrillIn source={drillSource} />
        ) : (
          <ActionDrillIn view={actionView} source={drillSource} />
        )}
      </aside>
    );
  }

  return (
    <aside style={aside}>
      <div
        style={{
          height: 44,
          flex: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 10px 0 14px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: ".02em" }}>Layers</span>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              color: "var(--text-faint)",
              background: "var(--surface-2)",
              padding: "1px 6px",
              borderRadius: 5,
            }}
          >
            {layers.length}
          </span>
        </div>
        <button
          type="button"
          title="Layers are added by generating"
          style={{
            width: 26,
            height: 26,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 7,
            background: "transparent",
            border: "1px solid var(--border)",
            color: "var(--text-muted)",
            cursor: "pointer",
          }}
        >
          <Plus size={15} strokeWidth={1.8} />
        </button>
      </div>

      {/* Stays up during a run — actions submitted mid-run join the queue. */}
      {selected && selected.status === "ready" && <ActionsDock layer={selected} />}

      {layers.length === 0 ? (
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            padding: "28px 26px",
            gap: 14,
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              border: "1.5px dashed var(--border-strong)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-faint)",
            }}
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m12 3 8.5 4.7L12 12.4 3.5 7.7 12 3Z" />
              <path d="m4 12 8 4.5 8-4.5" />
              <path d="m4 16.5 8 4.5 8-4.5" />
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>No layers yet</div>
            <div
              style={{
                fontSize: 12,
                color: "var(--text-muted)",
                marginTop: 5,
                lineHeight: 1.5,
                maxWidth: 200,
              }}
            >
              Generate your first layer from the prompt bar to start building your canvas.
            </div>
          </div>
          <button
            type="button"
            onClick={() => document.getElementById("prompt-input")?.focus()}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              height: 34,
              padding: "0 14px",
              borderRadius: 9,
              background: "transparent",
              border: "1px solid color-mix(in srgb, var(--accent) 45%, var(--border))",
              color: "var(--accent)",
              fontSize: 12.5,
              fontWeight: 500,
              fontFamily: "inherit",
              cursor: "pointer",
            }}
          >
            <Sparkles size={15} strokeWidth={1.9} />
            Generate a layer
          </button>
        </div>
      ) : (
        <div
          style={{
            flex: 1,
            overflow: "auto",
            padding: 6,
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          {reversed.map((l) => (
            <LayerRow key={l.id} layer={l} />
          ))}
        </div>
      )}
    </aside>
  );
}
