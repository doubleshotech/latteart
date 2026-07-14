import { useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, Layers, Palette, Scissors, Sparkles, X } from "lucide-react";
import { STYLE_PRESETS } from "@latteart/shared";
import { ACTIONS } from "../lib/actions";
import { useDocument } from "../stores/documentStore";
import { useGeneration, type QueuedJob } from "../stores/generationStore";
import { useProviders } from "../stores/providersStore";
import { SIZE_PRESETS, useSession } from "../stores/sessionStore";

const cardBase: React.CSSProperties = {
  width: "100%",
  display: "flex",
  alignItems: "center",
  gap: 10,
  background: "var(--surface-float)",
  border: "1px solid var(--border-strong)",
  borderRadius: 14,
  padding: "8px 8px 8px 15px",
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

const spinner: React.CSSProperties = {
  width: 16,
  height: 16,
  borderRadius: "50%",
  border: "2.4px solid rgba(255,255,255,0.12)",
  borderTopColor: "var(--accent)",
  animation: "latte-spin 0.9s linear infinite",
};

function jobIcon(kind: QueuedJob["kind"]) {
  if (kind === "generate") return Sparkles;
  if (kind === "merge") return Layers;
  return ACTIONS[kind].icon;
}

/** One waiting job in the strip — label plus an ✕ to drop it from the queue. */
function QueueChip({ job }: { job: QueuedJob }) {
  const dequeue = useGeneration((s) => s.dequeue);
  const Icon = jobIcon(job.kind);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: 24,
        padding: "0 4px 0 9px",
        borderRadius: 12,
        background: "var(--surface-2)",
        border: "1px solid var(--border)",
        fontSize: 11,
        color: "var(--text-muted)",
        maxWidth: 200,
      }}
    >
      <Icon size={12} strokeWidth={1.9} style={{ flex: "none", color: "var(--text-faint)" }} />
      <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {job.label}
      </span>
      <button
        type="button"
        onClick={() => dequeue(job.id)}
        title="Remove from queue"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 16,
          height: 16,
          padding: 0,
          borderRadius: "50%",
          background: "transparent",
          border: "none",
          color: "var(--text-faint)",
          cursor: "pointer",
          flex: "none",
        }}
      >
        <X size={11} strokeWidth={2} />
      </button>
    </span>
  );
}

/**
 * Progress + queue card floating above the prompt bar. Shows the executing
 * job (with cancel) and a chip per waiting job — the bar below stays live, so
 * submitting while a slow local generation runs just lines work up here.
 */
function QueueStrip() {
  const busy = useGeneration((s) => s.busy);
  const queue = useGeneration((s) => s.queue);
  const current = useGeneration((s) => s.current);
  const action = useGeneration((s) => s.action);
  const cancel = useGeneration((s) => s.cancel);
  const clearQueue = useGeneration((s) => s.clearQueue);

  const genProgress = useDocument(
    (s) => s.layers.find((l) => l.status === "generating")?.progress ?? 0,
  );
  // Editor actions anchor progress on their own placeholder, not the first
  // generating layer — a source may have unrelated placeholders around it.
  const actionProgress = useDocument(
    (s) => s.layers.find((l) => l.id === action?.placeholderId)?.progress ?? 0,
  );

  const pct = Math.round(action ? actionProgress : genProgress);
  const ActionIcon = action ? ACTIONS[action.kind].icon : Sparkles;

  return (
    <div
      style={{
        ...cardBase,
        flexDirection: "column",
        alignItems: "stretch",
        gap: 8,
        padding: "11px 8px 11px 15px",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {busy && (
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {action ? (
            // Editor-action progress row (mockup screen 5).
            <>
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
            </>
          ) : (
            // Plain generation / merge progress row.
            <>
              <Sparkles
                size={18}
                color="var(--accent)"
                strokeWidth={1.7}
                style={{ flex: "none", animation: "latte-pulse 1.2s ease-in-out infinite" }}
              />
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 13,
                  color: "var(--text-muted)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {current?.label ?? "Generating…"}
              </div>
            </>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "none" }}>
            <span style={spinner} />
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
        </div>
      )}

      {queue.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              letterSpacing: 0.6,
              color: "var(--text-faint)",
              flex: "none",
            }}
          >
            QUEUED · {queue.length}
          </span>
          {queue.map((j) => (
            <QueueChip key={j.id} job={j} />
          ))}
          {queue.length > 1 && (
            <button
              type="button"
              onClick={clearQueue}
              style={{
                background: "transparent",
                border: "none",
                padding: "0 4px",
                fontSize: 11,
                fontFamily: "inherit",
                color: "var(--text-faint)",
                cursor: "pointer",
                textDecoration: "underline",
                textUnderlineOffset: 3,
                flex: "none",
              }}
            >
              Clear all
            </button>
          )}
        </div>
      )}

      {busy && (
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
      )}
    </div>
  );
}

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

  const busy = useGeneration((s) => s.busy);
  const queued = useGeneration((s) => s.queue.length > 0);
  const start = useGeneration((s) => s.start);

  const [prompt, setPrompt] = useState("");
  const [focused, setFocused] = useState(false);

  const active = providers.find((p) => p.id === providerId);
  const activeStyle = STYLE_PRESETS.find((s) => s.id === styleId) ?? STYLE_PRESETS[0]!;

  // The bar never locks while a job runs — submitting mid-run queues the job.
  const canGenerate = prompt.trim().length > 0 && !!active?.available;

  const submit = () => {
    if (!canGenerate || !active) return;
    start({
      providerId: active.id,
      model: model ?? active.models[0]?.id,
      prompt,
      styleId,
      width: size.w,
      height: size.h,
      isolate,
    });
    // Consume the draft so the field is ready for the next prompt (and the
    // "…it queues up" placeholder shows) — re-Enter can't re-submit the same one.
    setPrompt("");
  };

  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        bottom: 26,
        transform: "translateX(-50%)",
        width: 780,
        maxWidth: "calc(100% - 40px)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        zIndex: 5,
      }}
    >
      {(busy || queued) && <QueueStrip />}

      <div
        style={{
          ...cardBase,
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
          placeholder={
            busy ? "Describe the next image — it queues up…" : "Describe an image to generate…"
          }
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
          {busy || queued ? "Queue" : "Generate"}
        </button>
      </div>
    </div>
  );
}
