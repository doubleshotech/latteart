import { useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, Palette, Scissors, Sparkles, X } from "lucide-react";
import { STYLE_PRESETS } from "@latteart/shared";
import { ACTIONS } from "../lib/actions";
import { useDocument } from "../stores/documentStore";
import { useGeneration } from "../stores/generationStore";
import { useProviders } from "../stores/providersStore";
import { SIZE_PRESETS, useSession } from "../stores/sessionStore";

const barBase: React.CSSProperties = {
  position: "absolute",
  left: "50%",
  bottom: 26,
  transform: "translateX(-50%)",
  width: 780,
  maxWidth: "calc(100% - 40px)",
  display: "flex",
  alignItems: "center",
  gap: 10,
  background: "var(--surface-float)",
  border: "1px solid var(--border-strong)",
  borderRadius: 14,
  padding: "8px 8px 8px 15px",
  zIndex: 5,
};

const pillBtn: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 7,
  height: 34,
  padding: "0 11px",
  borderRadius: 9,
  background: "var(--surface-2)",
  border: "1px solid var(--border)",
  color: "var(--text)",
  fontSize: 12,
  fontFamily: "inherit",
  cursor: "pointer",
  flex: "none",
};

export function PromptBar() {
  const providers = useProviders((s) => s.providers);
  const providerId = useSession((s) => s.providerId);
  const model = useSession((s) => s.model);
  const size = useSession((s) => s.size);
  const styleId = useSession((s) => s.styleId);
  const isolate = useSession((s) => s.isolate);
  const setSize = useSession((s) => s.setSize);
  const setStyle = useSession((s) => s.setStyle);
  const setIsolate = useSession((s) => s.setIsolate);

  const running = useGeneration((s) => s.running);
  const action = useGeneration((s) => s.action);
  const start = useGeneration((s) => s.start);
  const cancel = useGeneration((s) => s.cancel);

  const genProgress = useDocument(
    (s) => s.layers.find((l) => l.status === "generating")?.progress ?? 0,
  );
  // Editor actions anchor progress on their own placeholder, not the first
  // generating layer — a source may have unrelated placeholders around it.
  const actionProgress = useDocument(
    (s) => s.layers.find((l) => l.id === action?.placeholderId)?.progress ?? 0,
  );

  const [prompt, setPrompt] = useState("");
  const [focused, setFocused] = useState(false);

  const active = providers.find((p) => p.id === providerId);
  const activeStyle = STYLE_PRESETS.find((s) => s.id === styleId) ?? STYLE_PRESETS[0]!;

  const canGenerate = prompt.trim().length > 0 && !!active?.available && !running;

  const submit = () => {
    if (!canGenerate || !active) return;
    void start({
      providerId: active.id,
      model: model ?? active.models[0]?.id,
      prompt,
      styleId,
      width: size.w,
      height: size.h,
      isolate,
    });
  };

  if (running && action) {
    // Editor-action progress toast (mockup screen 5) — same slot as the bar.
    const pct = Math.round(actionProgress);
    const ActionIcon = ACTIONS[action.kind].icon;
    return (
      <div style={{ ...barBase, gap: 12, padding: "11px 8px 11px 15px", overflow: "hidden" }}>
        <span
          style={{
            width: 30,
            height: 30,
            flex: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 8,
            background: "color-mix(in srgb, var(--accent) 16%, transparent)",
            color: "var(--accent)",
          }}
        >
          <ActionIcon size={16} strokeWidth={1.8} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 12.5,
              color: "var(--text)",
              fontWeight: 500,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {ACTIONS[action.kind].title({
              sourceName: action.sourceName,
              index: action.index,
              count: action.count,
            })}
          </div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              color: "var(--text-faint)",
              marginTop: 1,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {action.detail}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "none" }}>
          <span
            style={{
              width: 16,
              height: 16,
              borderRadius: "50%",
              border: "2.4px solid rgba(255,255,255,0.12)",
              borderTopColor: "var(--accent)",
              animation: "latte-spin 0.9s linear infinite",
            }}
          />
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text)" }}>
            {pct}%
          </span>
        </div>
        <button
          type="button"
          onClick={cancel}
          style={{
            ...pillBtn,
            gap: 6,
            padding: "0 13px",
            border: "1px solid var(--border-strong)",
            fontWeight: 500,
          }}
        >
          <X size={14} strokeWidth={1.9} />
          Cancel
        </button>
        <div
          style={{
            position: "absolute",
            left: 0,
            bottom: 0,
            height: 2,
            width: `${pct}%`,
            background: "var(--accent)",
            borderRadius: "0 2px 0 0",
            boxShadow: "0 0 10px var(--accent)",
            transition: "width .2s ease",
          }}
        />
      </div>
    );
  }

  if (running) {
    const pct = Math.round(genProgress);
    return (
      <div style={{ ...barBase, gap: 12, overflow: "hidden" }}>
        <Sparkles
          size={18}
          color="var(--accent)"
          strokeWidth={1.7}
          style={{ flex: "none", animation: "latte-pulse 1.2s ease-in-out infinite" }}
        />
        <div
          style={{
            flex: 1,
            fontSize: 13,
            color: "var(--text-muted)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {prompt || "Generating…"}
        </div>
        <div style={{ width: 1, height: 22, background: "var(--border)", flex: "none" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "none" }}>
          <span
            style={{
              width: 16,
              height: 16,
              borderRadius: "50%",
              border: "2.4px solid rgba(255,255,255,0.12)",
              borderTopColor: "var(--accent)",
              animation: "latte-spin 0.9s linear infinite",
            }}
          />
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text)" }}>
            Generating… {pct}%
          </span>
        </div>
        <button
          type="button"
          onClick={cancel}
          style={{
            ...pillBtn,
            gap: 6,
            padding: "0 13px",
            border: "1px solid var(--border-strong)",
            fontWeight: 500,
          }}
        >
          <X size={14} strokeWidth={1.9} />
          Cancel
        </button>
        <div
          style={{
            position: "absolute",
            left: 0,
            bottom: 0,
            height: 2,
            width: `${pct}%`,
            background: "var(--accent)",
            borderRadius: "0 2px 0 0",
            boxShadow: "0 0 10px var(--accent)",
            transition: "width .2s ease",
          }}
        />
      </div>
    );
  }

  return (
    <div
      style={{
        ...barBase,
        boxShadow: focused
          ? "0 18px 44px -14px rgba(0,0,0,.75), 0 0 0 3px color-mix(in srgb, var(--accent) 26%, transparent)"
          : "0 18px 44px -14px rgba(0,0,0,.75)",
      }}
    >
      <Sparkles size={18} color="var(--accent)" strokeWidth={1.7} style={{ flex: "none" }} />
      <input
        id="prompt-input"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="Describe an image to generate…"
        style={{
          flex: 1,
          minWidth: 0,
          background: "transparent",
          border: "none",
          outline: "none",
          color: "var(--text)",
          fontFamily: "inherit",
          fontSize: 13,
        }}
      />
      <div style={{ width: 1, height: 22, background: "var(--border)", flex: "none" }} />

      {/* size picker */}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button type="button" style={{ ...pillBtn, fontFamily: "var(--font-mono)" }}>
            {size.label}
            <ChevronDown size={13} strokeWidth={1.9} color="var(--text-faint)" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="dd-content" sideOffset={8} align="end">
            {SIZE_PRESETS.map((s) => (
              <DropdownMenu.Item
                key={s.label}
                className="dd-item"
                style={{ fontFamily: "var(--font-mono)" }}
                onSelect={() => setSize(s)}
              >
                {s.label}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      {/* style picker */}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button type="button" style={pillBtn}>
            <Palette size={13} strokeWidth={1.9} color="var(--text-faint)" />
            <span style={{ color: styleId === "none" ? "var(--text-muted)" : "var(--text)" }}>
              {styleId === "none" ? "Style" : activeStyle.label}
            </span>
            <ChevronDown size={13} strokeWidth={1.9} color="var(--text-faint)" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="dd-content" sideOffset={8} align="end">
            {STYLE_PRESETS.map((s) => (
              <DropdownMenu.Item
                key={s.id}
                className="dd-item"
                style={{ flexDirection: "column", alignItems: "flex-start", gap: 1 }}
                onSelect={() => setStyle(s.id)}
              >
                <span
                  style={{
                    color: s.id === styleId ? "var(--accent)" : "var(--text)",
                    fontWeight: s.id === styleId ? 600 : 400,
                  }}
                >
                  {s.label}
                </span>
                {s.blurb && (
                  <span style={{ fontSize: 11, color: "var(--text-faint)" }}>{s.blurb}</span>
                )}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      {/* isolate ("Cutout") toggle — generate a transparent, stack-ready subject */}
      <button
        type="button"
        onClick={() => setIsolate(!isolate)}
        title="Cutout — generate the subject on a transparent background so it stacks cleanly"
        aria-pressed={isolate}
        style={{
          ...pillBtn,
          background: isolate
            ? "color-mix(in srgb, var(--accent) 16%, transparent)"
            : pillBtn.background,
          border: isolate ? "1px solid var(--accent)" : pillBtn.border,
          color: isolate ? "var(--accent)" : "var(--text-muted)",
        }}
      >
        <Scissors
          size={13}
          strokeWidth={1.9}
          color={isolate ? "var(--accent)" : "var(--text-faint)"}
        />
        Cutout
      </button>

      <button
        type="button"
        onClick={submit}
        disabled={!canGenerate}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          height: 34,
          padding: "0 15px",
          borderRadius: 9,
          background: "var(--accent)",
          border: "none",
          color: "var(--accent-fg)",
          fontSize: 13,
          fontWeight: 600,
          fontFamily: "inherit",
          cursor: canGenerate ? "pointer" : "not-allowed",
          opacity: canGenerate ? 1 : 0.5,
          flex: "none",
          boxShadow: "0 3px 12px -2px color-mix(in srgb, var(--accent) 60%, transparent)",
        }}
      >
        <Sparkles size={15} strokeWidth={1.9} />
        Generate
      </button>
    </div>
  );
}
