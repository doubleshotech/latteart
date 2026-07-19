import { useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronLeft,
  Expand,
  Image as ImageIcon,
} from "lucide-react";
import { ACTIONS, outpaintBlockedNote } from "../lib/actions";
import { buildOutpaintAssets, type Dirs } from "../lib/outpaint";
import type { Layer } from "../stores/documentStore";
import { useGeneration } from "../stores/generationStore";
import { useProviders } from "../stores/providersStore";
import { useSession } from "../stores/sessionStore";

/** How much to add on each active side, as a fraction of the source dimension. */
const AMOUNTS = [
  { label: "25%", f: 0.25 },
  { label: "50%", f: 0.5 },
  { label: "75%", f: 0.75 },
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

/** One toggleable side in the 3×3 direction grid. */
function SideCell({
  active,
  icon,
  onClick,
  label,
}: {
  active: boolean;
  icon: React.ReactNode;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 8,
        background: active
          ? "color-mix(in srgb, var(--accent) 16%, transparent)"
          : "var(--surface-2)",
        border: active
          ? "1px solid color-mix(in srgb, var(--accent) 45%, transparent)"
          : "1px solid var(--border)",
        color: active ? "var(--accent)" : "var(--text-muted)",
        cursor: "pointer",
      }}
    >
      {icon}
    </button>
  );
}

/**
 * Drill-in panel for Outpaint (Expand) — pick which sides to grow, how much, and
 * an optional description of what to add, then build the expanded canvas + mask
 * and hand them to the generation store. Replaces the layer panel like the other
 * drill-ins; Back returns to the actions dock.
 */
export function OutpaintDrillIn({ source }: { source: Layer }) {
  const closeAction = useSession((s) => s.closeAction);
  const providerId = useSession((s) => s.providerId);
  const model = useSession((s) => s.model);
  const providers = useProviders((s) => s.providers);

  const runAction = useGeneration((s) => s.runAction);
  const setError = useGeneration((s) => s.setError);

  const [dirs, setDirs] = useState<Dirs>({ up: true, down: true, left: true, right: true });
  const [amountIdx, setAmountIdx] = useState(1); // 50%
  const [prompt, setPrompt] = useState("");
  const [focused, setFocused] = useState(false);
  const [building, setBuilding] = useState(false);

  const active = providers.find((p) => p.id === providerId);
  const meta = ACTIONS.outpaint;
  const amount = AMOUNTS[amountIdx] ?? AMOUNTS[1]!;
  const anySide = dirs.up || dirs.down || dirs.left || dirs.right;
  const blockedNote = outpaintBlockedNote(active);
  const canGenerate = !!active?.available && !!active.capabilities.outpaint && anySide && !building;

  const toggle = (k: keyof Dirs) => setDirs((d) => ({ ...d, [k]: !d[k] }));

  const generate = async () => {
    if (!canGenerate || !active) return;
    setBuilding(true);
    try {
      const outpaint = await buildOutpaintAssets(source, dirs, amount.f);
      runAction({
        providerId: active.id,
        model: model ?? undefined,
        kind: "outpaint",
        sourceId: source.id,
        prompt: prompt.trim() || undefined,
        detail: `outpaint · ${active.label}`,
        outpaint,
      });
      closeAction();
    } catch (err) {
      setError((err as Error).message || "Couldn't prepare the canvas to expand.");
    } finally {
      setBuilding(false);
    }
  };

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
          <Expand size={14} strokeWidth={1.8} />
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

        {/* direction grid */}
        <div>
          <div style={{ ...fieldLabel, marginBottom: 8 }}>Expand from</div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gridTemplateRows: "repeat(3, 40px)",
              gap: 6,
            }}
          >
            <span />
            <SideCell
              active={dirs.up}
              onClick={() => toggle("up")}
              label="Top"
              icon={<ArrowUp size={16} strokeWidth={2} />}
            />
            <span />
            <SideCell
              active={dirs.left}
              onClick={() => toggle("left")}
              label="Left"
              icon={<ArrowLeft size={16} strokeWidth={2} />}
            />
            {/* center: the source, kept in place while the border grows */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 8,
                background: "var(--surface-canvas)",
                border: "1px dashed var(--border-strong)",
                color: "var(--text-faint)",
              }}
            >
              <ImageIcon size={15} strokeWidth={1.7} />
            </div>
            <SideCell
              active={dirs.right}
              onClick={() => toggle("right")}
              label="Right"
              icon={<ArrowRight size={16} strokeWidth={2} />}
            />
            <span />
            <SideCell
              active={dirs.down}
              onClick={() => toggle("down")}
              label="Bottom"
              icon={<ArrowDown size={16} strokeWidth={2} />}
            />
            <span />
          </div>
          {!anySide && (
            <div style={{ ...monoFaint, marginTop: 8, color: "var(--accent)" }}>
              Pick at least one side to expand.
            </div>
          )}
        </div>

        {/* amount */}
        <div>
          <div style={{ ...fieldLabel, marginBottom: 7 }}>Amount</div>
          <div style={{ display: "flex", gap: 6 }}>
            {AMOUNTS.map((a, i) => (
              <button
                key={a.label}
                type="button"
                onClick={() => setAmountIdx(i)}
                style={{
                  flex: 1,
                  height: 34,
                  borderRadius: 8,
                  background:
                    i === amountIdx
                      ? "color-mix(in srgb, var(--accent) 16%, transparent)"
                      : "var(--surface-2)",
                  border:
                    i === amountIdx
                      ? "1px solid color-mix(in srgb, var(--accent) 45%, transparent)"
                      : "1px solid var(--border)",
                  color: i === amountIdx ? "var(--accent)" : "var(--text-muted)",
                  fontSize: 13,
                  fontWeight: 600,
                  fontFamily: "var(--font-mono)",
                  cursor: "pointer",
                }}
              >
                {a.label}
              </button>
            ))}
          </div>
          <div style={{ ...monoFaint, marginTop: 8 }}>
            Adds {amount.label} on each selected side, filled by AI to match the scene
          </div>
        </div>

        {/* optional prompt */}
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
            <span style={monoFaint}>optional</span>
          </div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="Describe what to add in the new area — or leave blank to extend the scene…"
            rows={3}
            style={{
              width: "100%",
              minHeight: 72,
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
          onClick={() => void generate()}
          title={blockedNote ?? (!anySide ? "Pick at least one side" : "Expand the image")}
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
          <Expand size={16} strokeWidth={1.8} />
          {building ? "Preparing…" : "Expand image"}
        </button>
        <div style={{ ...monoFaint, textAlign: "center", marginTop: 8 }}>
          {blockedNote ?? `Creates a new, larger layer over ${source.name}`}
        </div>
      </div>
    </>
  );
}
