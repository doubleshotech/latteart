import { useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Slider from "@radix-ui/react-slider";
import { ChevronDown, ChevronLeft, Palette } from "lucide-react";
import { STYLE_PRESETS } from "@latteart/shared";
import { ACTIONS } from "../lib/actions";
import type { Layer } from "../stores/documentStore";
import { useGeneration } from "../stores/generationStore";
import { useProviders } from "../stores/providersStore";
import { useSession, type ActionView } from "../stores/sessionStore";

/** Remix similarity stops — index maps to img2img denoising strength. */
const SIMILARITY_STOPS = [
  { label: "Very close", strength: 0.15 },
  { label: "Quite similar", strength: 0.3 },
  { label: "Balanced", strength: 0.5 },
  { label: "Adventurous", strength: 0.7 },
  { label: "Reinvent", strength: 0.9 },
] as const;

const fieldLabel: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 500,
  color: "var(--text)",
};

const monoFaint: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 9.5,
  color: "var(--text-faint)",
};

/**
 * Drill-in panel for Remix / Change background / Variations — replaces the
 * layer panel content (mockup screen 4). Back returns to the actions dock.
 */
export function ActionDrillIn({ view, source }: { view: ActionView; source: Layer }) {
  const closeAction = useSession((s) => s.closeAction);
  const sessionStyleId = useSession((s) => s.styleId);
  const providerId = useSession((s) => s.providerId);
  const model = useSession((s) => s.model);
  const providers = useProviders((s) => s.providers);

  const runAction = useGeneration((s) => s.runAction);

  const [prompt, setPrompt] = useState(view.kind === "remix" ? (source.prompt ?? "") : "");
  const [simIndex, setSimIndex] = useState(1); // "Quite similar"
  const [styleId, setStyleId] = useState(sessionStyleId);
  const [count, setCount] = useState(2);
  const [scale, setScale] = useState<2 | 4>(2);
  const [focused, setFocused] = useState(false);

  const active = providers.find((p) => p.id === providerId);
  const meta = ACTIONS[view.kind];
  const Icon = meta.icon;
  const stop = SIMILARITY_STOPS[simIndex] ?? SIMILARITY_STOPS[1];

  const isUpscale = view.kind === "upscale";
  const needsPrompt = view.kind === "remix" || view.kind === "change-bg";
  // Upscale gates on its own capability; every other drill-in is img2img.
  const capOk = isUpscale ? !!active?.capabilities.upscale : !!active?.capabilities.img2img;
  // Not gated on a running job — submitting mid-run queues the action.
  const canGenerate = !!active?.available && capOk && (!needsPrompt || !!prompt.trim());

  const activeStyle = STYLE_PRESETS.find((s) => s.id === styleId) ?? STYLE_PRESETS[0]!;
  const jobs = view.kind === "variations" ? count : 1;

  const generate = () => {
    if (!canGenerate || !active) return;
    const detail = isUpscale
      ? `upscale ×${scale} · ${active.label}`
      : view.kind === "remix"
        ? `img2img · ${active.label} · ${stop.label.toLowerCase()}`
        : `img2img · ${active.label}`;
    runAction({
      providerId: active.id,
      model: model ?? undefined,
      kind: view.kind,
      sourceId: source.id,
      prompt: needsPrompt ? prompt : undefined,
      styleId: view.kind === "remix" ? styleId : undefined,
      strength: view.kind === "remix" ? stop.strength : undefined,
      scale: isUpscale ? scale : undefined,
      detail,
      count: jobs,
    });
    // Submitting consumes the draft — close back to the layer panel so the
    // working row / progress states show (mockup screen 5). Stray selection
    // changes no longer close the drill-in; only submit and Back do.
    closeAction();
  };

  const generateLabel = isUpscale
    ? `Upscale ×${scale}`
    : view.kind === "remix"
      ? "Generate remix"
      : view.kind === "change-bg"
        ? "Generate background"
        : "Generate variations";

  return (
    <>
      {/* drill-in header */}
      <div
        style={{
          height: 44,
          flex: "none",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 12px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <button
          type="button"
          title="Back"
          onClick={closeAction}
          style={{
            width: 26,
            height: 26,
            flex: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 7,
            background: "var(--surface-2)",
            border: "1px solid var(--border)",
            color: "var(--text)",
            cursor: "pointer",
          }}
        >
          <ChevronLeft size={15} strokeWidth={1.9} />
        </button>
        <span
          style={{
            width: 24,
            height: 24,
            flex: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 6,
            background: "color-mix(in srgb, var(--accent) 16%, transparent)",
            color: "var(--accent)",
          }}
        >
          <Icon size={14} strokeWidth={1.8} />
        </span>
        <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600 }}>{meta.label}</div>
        <span
          style={{
            ...monoFaint,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxWidth: 96,
          }}
        >
          {source.name}
        </span>
      </div>

      {/* body */}
      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: "14px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        {/* source ref */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: 8,
            borderRadius: 9,
            background: "var(--surface-2)",
            border: "1px solid var(--border)",
          }}
        >
          {source.src ? (
            <img
              src={source.src}
              alt=""
              draggable={false}
              style={{
                width: 40,
                height: 40,
                borderRadius: 6,
                flex: "none",
                border: "1px solid var(--border-strong)",
                objectFit: "cover",
              }}
            />
          ) : (
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 6,
                flex: "none",
                border: "1px solid var(--border-strong)",
                background: "var(--surface-canvas)",
              }}
            />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ ...monoFaint, letterSpacing: ".06em" }}>SOURCE</div>
            <div
              style={{
                fontSize: 12,
                color: "var(--text)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {source.name} · {Math.round(source.width)}×{Math.round(source.height)}
            </div>
          </div>
        </div>

        {/* remix: similarity slider */}
        {view.kind === "remix" && (
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 12,
              }}
            >
              <span style={fieldLabel}>Similarity to original</span>
              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: 500,
                  color: "var(--accent)",
                  background: "color-mix(in srgb, var(--accent) 14%, transparent)",
                  border: "1px solid color-mix(in srgb, var(--accent) 30%, transparent)",
                  padding: "2px 8px",
                  borderRadius: 999,
                }}
              >
                {stop.label}
              </span>
            </div>
            <Slider.Root
              className="sim-slider"
              min={0}
              max={SIMILARITY_STOPS.length - 1}
              step={1}
              value={[simIndex]}
              onValueChange={([v]) => setSimIndex(v ?? 1)}
            >
              <Slider.Track className="sim-track">
                <Slider.Range className="sim-range" />
                {SIMILARITY_STOPS.map((s, i) => (
                  <span
                    key={s.label}
                    style={{
                      position: "absolute",
                      left: `${(i / (SIMILARITY_STOPS.length - 1)) * 100}%`,
                      top: "50%",
                      width: 5,
                      height: 5,
                      borderRadius: "50%",
                      background: i <= simIndex ? "var(--accent)" : "var(--text-faint)",
                      transform: "translate(-50%, -50%)",
                    }}
                  />
                ))}
              </Slider.Track>
              <Slider.Thumb className="sim-thumb" aria-label="Similarity to original" />
            </Slider.Root>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginTop: 8,
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                color: "var(--text-faint)",
              }}
            >
              <span>Close</span>
              <span>Reinvent</span>
            </div>
          </div>
        )}

        {/* prompt (remix prefilled from source; change-bg empty) */}
        {needsPrompt && (
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 7,
              }}
            >
              <span style={fieldLabel}>Prompt</span>
              {view.kind === "remix" && source.prompt && <span style={monoFaint}>from source</span>}
            </div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder={
                view.kind === "remix"
                  ? "Describe the remix…"
                  : "Describe the new background — e.g. a misty pine forest at dawn…"
              }
              rows={3}
              style={{
                width: "100%",
                minHeight: 78,
                padding: "10px 11px",
                borderRadius: 9,
                background: "var(--surface-canvas)",
                border: focused ? "1px solid var(--accent)" : "1px solid var(--border-strong)",
                boxShadow: focused
                  ? "0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent)"
                  : "none",
                color: "var(--text)",
                fontSize: 12.5,
                lineHeight: 1.55,
                fontFamily: "inherit",
                resize: "vertical",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>
        )}

        {/* remix: style override */}
        {view.kind === "remix" && (
          <div>
            <div style={{ ...fieldLabel, marginBottom: 7 }}>Style override</div>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  type="button"
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 9,
                    height: 36,
                    padding: "0 11px",
                    borderRadius: 9,
                    background: "var(--surface-2)",
                    border: "1px solid var(--border)",
                    color: "var(--text)",
                    fontSize: 12.5,
                    fontFamily: "inherit",
                    cursor: "pointer",
                  }}
                >
                  <Palette size={14} strokeWidth={1.8} color="var(--text-faint)" />
                  <span
                    style={{
                      flex: 1,
                      textAlign: "left",
                      color: styleId === "none" ? "var(--text-muted)" : "var(--text)",
                    }}
                  >
                    {styleId === "none" ? "None" : activeStyle.label}
                  </span>
                  <ChevronDown size={13} strokeWidth={1.9} color="var(--text-faint)" />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content className="dd-content" sideOffset={6} align="start">
                  {STYLE_PRESETS.map((s) => (
                    <DropdownMenu.Item
                      key={s.id}
                      className="dd-item"
                      onSelect={() => setStyleId(s.id)}
                    >
                      <span
                        style={{
                          color: s.id === styleId ? "var(--accent)" : "var(--text)",
                          fontWeight: s.id === styleId ? 600 : 400,
                        }}
                      >
                        {s.label}
                      </span>
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        )}

        {/* variations: count */}
        {view.kind === "variations" && (
          <div>
            <div style={{ ...fieldLabel, marginBottom: 7 }}>How many</div>
            <div style={{ display: "flex", gap: 6 }}>
              {[1, 2, 3, 4].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setCount(n)}
                  style={{
                    flex: 1,
                    height: 34,
                    borderRadius: 8,
                    background:
                      n === count
                        ? "color-mix(in srgb, var(--accent) 16%, transparent)"
                        : "var(--surface-2)",
                    border:
                      n === count
                        ? "1px solid color-mix(in srgb, var(--accent) 45%, transparent)"
                        : "1px solid var(--border)",
                    color: n === count ? "var(--accent)" : "var(--text-muted)",
                    fontSize: 13,
                    fontWeight: 600,
                    fontFamily: "var(--font-mono)",
                    cursor: "pointer",
                  }}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* upscale: factor */}
        {isUpscale && (
          <div>
            <div style={{ ...fieldLabel, marginBottom: 7 }}>Factor</div>
            <div style={{ display: "flex", gap: 6 }}>
              {([2, 4] as const).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setScale(n)}
                  style={{
                    flex: 1,
                    height: 34,
                    borderRadius: 8,
                    background:
                      n === scale
                        ? "color-mix(in srgb, var(--accent) 16%, transparent)"
                        : "var(--surface-2)",
                    border:
                      n === scale
                        ? "1px solid color-mix(in srgb, var(--accent) 45%, transparent)"
                        : "1px solid var(--border)",
                    color: n === scale ? "var(--accent)" : "var(--text-muted)",
                    fontSize: 13,
                    fontWeight: 600,
                    fontFamily: "var(--font-mono)",
                    cursor: "pointer",
                  }}
                >
                  ×{n}
                </button>
              ))}
            </div>
            <div style={{ ...monoFaint, marginTop: 8 }}>
              {scale}× the resolution — same size on canvas, sharper when zoomed or exported
            </div>
          </div>
        )}
      </div>

      {/* footer: primary action */}
      <div
        style={{
          flex: "none",
          padding: 12,
          borderTop: "1px solid var(--border)",
          background: "var(--surface-1)",
        }}
      >
        <button
          type="button"
          disabled={!canGenerate}
          onClick={generate}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            height: 40,
            borderRadius: 10,
            background: "var(--accent)",
            border: "none",
            color: "var(--accent-fg)",
            fontSize: 13,
            fontWeight: 600,
            fontFamily: "inherit",
            cursor: canGenerate ? "pointer" : "not-allowed",
            opacity: canGenerate ? 1 : 0.5,
            boxShadow: "0 3px 12px -2px color-mix(in srgb, var(--accent) 60%, transparent)",
          }}
        >
          <Icon size={16} strokeWidth={1.8} />
          {generateLabel}
        </button>
        <div style={{ ...monoFaint, textAlign: "center", marginTop: 8 }}>
          Creates {jobs > 1 ? `${jobs} new layers` : "a new layer"} above {source.name}
        </div>
      </div>
    </>
  );
}
