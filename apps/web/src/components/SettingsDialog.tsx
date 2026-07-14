import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { KeyRound, Lock, Server, Wand2, X } from "lucide-react";
import type { LLMEngine, Provider } from "../api/client";
import { useLLM } from "../stores/llmStore";
import { useProviders } from "../stores/providersStore";
import { useSession } from "../stores/sessionStore";

const CAP_LABELS: Record<string, string> = {
  txt2img: "txt2img",
  img2img: "img2img",
  inpaint: "inpaint",
  outpaint: "outpaint",
  removeBg: "remove bg",
  transparentLayers: "transparent",
  controlnet: "controlnet",
  upscale: "upscale",
};

const ICONS: Record<string, { char: string; bg: string; color: string }> = {
  fal: { char: "f", bg: "linear-gradient(150deg,#3a3fa0,#23264d)", color: "#c8ccff" },
  openai: { char: "◎", bg: "linear-gradient(150deg,#1f6f5c,#123a31)", color: "#a7e8d4" },
  gemini: { char: "G", bg: "linear-gradient(150deg,#4285f4,#1b3a6b)", color: "#dbe7ff" },
  comfyui: { char: "C", bg: "linear-gradient(150deg,#6b3f9e,#341f4d)", color: "#dcc4ff" },
  mock: { char: "M", bg: "var(--surface-2)", color: "var(--text-muted)" },
};

function Badge({ p }: { p: Provider }) {
  let label = "Not connected";
  let color = "var(--text-faint)";
  let bg = "var(--surface-2)";
  let border = "1px solid var(--border)";
  let dot = "var(--text-faint)";
  if (p.id === "mock") {
    label = "Built-in";
    color = "var(--text-muted)";
  } else if (p.connection) {
    label = "Local";
    color = "var(--ok)";
    bg = "color-mix(in srgb, var(--ok) 14%, transparent)";
    border = "1px solid color-mix(in srgb, var(--ok) 30%, transparent)";
    dot = "var(--ok)";
  } else if (p.hasKey) {
    label = "Connected";
    color = "var(--ok)";
    bg = "color-mix(in srgb, var(--ok) 14%, transparent)";
    border = "1px solid color-mix(in srgb, var(--ok) 30%, transparent)";
    dot = "var(--ok)";
  }
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 11,
        padding: "3px 9px",
        borderRadius: 999,
        background: bg,
        color,
        border,
      }}
    >
      {p.id !== "mock" && (
        <span style={{ width: 5, height: 5, borderRadius: 9, background: dot }} />
      )}
      {label}
    </span>
  );
}

const accentBtn: React.CSSProperties = {
  height: 34,
  padding: "0 15px",
  borderRadius: 8,
  background: "var(--accent)",
  border: "none",
  color: "var(--accent-fg)",
  fontSize: 12,
  fontWeight: 600,
  fontFamily: "inherit",
  cursor: "pointer",
  flex: "none",
};

const ghostBtn: React.CSSProperties = {
  height: 34,
  padding: "0 14px",
  borderRadius: 8,
  background: "transparent",
  border: "1px solid var(--border-strong)",
  color: "var(--text-muted)",
  fontSize: 12,
  fontWeight: 500,
  fontFamily: "inherit",
  cursor: "pointer",
  flex: "none",
};

const fieldBox: React.CSSProperties = {
  flex: 1,
  display: "flex",
  alignItems: "center",
  gap: 8,
  height: 34,
  padding: "0 11px",
  background: "var(--surface-2)",
  border: "1px solid var(--border)",
  borderRadius: 8,
};

function ProviderCard({ p, last }: { p: Provider; last: boolean }) {
  const setKey = useProviders((s) => s.setKey);
  const removeKey = useProviders((s) => s.removeKey);
  const [value, setValue] = useState(p.connection?.defaultValue ?? "");
  const [busy, setBusy] = useState(false);

  const icon = ICONS[p.id] ?? ICONS.mock!;
  const chips = Object.entries(p.capabilities)
    .filter(([, v]) => v)
    .map(([k]) => CAP_LABELS[k] ?? k);

  const save = async () => {
    if (!value.trim()) return;
    setBusy(true);
    try {
      await setKey(p.id, value.trim());
      if (p.requiresKey) setValue("");
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await removeKey(p.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: "14px 12px", borderBottom: last ? "none" : "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 9,
            flex: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: icon.bg,
            color: icon.color,
            fontWeight: 700,
            fontSize: 14,
            border: p.id === "mock" ? "1px solid var(--border)" : "none",
          }}
        >
          {icon.char}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            {p.label}
            {p.sublabel && (
              <span style={{ fontWeight: 400, color: "var(--text-faint)", fontSize: 11.5 }}>
                {" "}
                {p.sublabel}
              </span>
            )}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{p.blurb}</div>
        </div>
        <Badge p={p} />
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          flexWrap: "wrap",
          margin: "11px 0 10px",
        }}
      >
        {chips.map((c) => (
          <span
            key={c}
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              padding: "2px 7px",
              borderRadius: 5,
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              color: "var(--text-muted)",
            }}
          >
            {c}
          </span>
        ))}
      </div>

      {p.id === "mock" ? null : p.connection ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={fieldBox}>
            <Server size={14} strokeWidth={1.7} color="var(--text-faint)" />
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={p.connection.placeholder}
              style={{
                flex: 1,
                background: "transparent",
                border: "none",
                outline: "none",
                color: "var(--text)",
                fontFamily: "var(--font-mono)",
                fontSize: 12,
              }}
            />
          </div>
          <button type="button" style={ghostBtn} disabled={busy} onClick={save}>
            Save
          </button>
        </div>
      ) : p.hasKey ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={fieldBox}>
            <KeyRound size={14} strokeWidth={1.7} color="var(--text-faint)" />
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                color: "var(--text-muted)",
                letterSpacing: ".05em",
              }}
            >
              •••••••••••••••• key stored
            </span>
          </div>
          <button type="button" style={ghostBtn} disabled={busy} onClick={remove}>
            Remove
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={fieldBox}>
            <KeyRound size={14} strokeWidth={1.7} color="var(--text-faint)" />
            <input
              type="password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void save();
              }}
              placeholder={p.keyPlaceholder ?? "Paste your API key…"}
              style={{
                flex: 1,
                background: "transparent",
                border: "none",
                outline: "none",
                color: "var(--text)",
                fontFamily: "var(--font-mono)",
                fontSize: 12,
              }}
            />
          </div>
          <button type="button" style={accentBtn} disabled={busy} onClick={save}>
            Save
          </button>
        </div>
      )}
    </div>
  );
}

/** Editable Ollama endpoint — persisted server-side like ComfyUI's URL. The
 * stored value is never returned (keystore hygiene), so the field starts at the
 * default and a note flags when a custom URL is saved. */
function EngineUrlField({ engine }: { engine: LLMEngine }) {
  const setUrl = useLLM((s) => s.setUrl);
  const clearUrl = useLLM((s) => s.clearUrl);
  const [value, setValue] = useState(engine.connection?.defaultValue ?? "");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!value.trim()) return;
    setBusy(true);
    try {
      await setUrl(engine.id, value.trim());
    } finally {
      setBusy(false);
    }
  };
  const reset = async () => {
    setBusy(true);
    try {
      await clearUrl(engine.id);
      setValue(engine.connection?.defaultValue ?? "");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginTop: 11 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={fieldBox}>
          <Server size={14} strokeWidth={1.7} color="var(--text-faint)" />
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
            }}
            placeholder={engine.connection?.placeholder}
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "var(--text)",
              fontFamily: "var(--font-mono)",
              fontSize: 12,
            }}
          />
        </div>
        <button type="button" style={ghostBtn} disabled={busy} onClick={save}>
          Save
        </button>
        {engine.hasUrl && (
          <button type="button" style={ghostBtn} disabled={busy} onClick={reset}>
            Reset
          </button>
        )}
      </div>
      <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 6 }}>
        {engine.available
          ? engine.hasUrl
            ? "Custom endpoint saved · reachable"
            : "Reachable at the default endpoint"
          : "Not reachable — start the engine, then Save to re-check"}
      </div>
    </div>
  );
}

/** One selectable enhancement engine (or the synthetic "Auto"). Click to pick. */
function EngineCard({
  label,
  selected,
  onSelect,
  badge,
  children,
}: {
  label: React.ReactNode;
  selected: boolean;
  onSelect: () => void;
  badge?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div
      role="radio"
      aria-checked={selected}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      style={{
        borderRadius: 10,
        padding: "11px 12px",
        cursor: "pointer",
        border: selected ? "1px solid var(--accent)" : "1px solid var(--border)",
        background: selected
          ? "color-mix(in srgb, var(--accent) 8%, transparent)"
          : "var(--surface-2)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          style={{
            width: 15,
            height: 15,
            borderRadius: "50%",
            flex: "none",
            border: selected ? "4.5px solid var(--accent)" : "1.5px solid var(--border-strong)",
            background: selected ? "var(--accent-fg)" : "transparent",
          }}
        />
        <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 500 }}>{label}</div>
        {badge}
      </div>
      {children}
    </div>
  );
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 11,
        color: ok ? "var(--ok)" : "var(--text-faint)",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: 9,
          background: ok ? "var(--ok)" : "var(--text-faint)",
          flex: "none",
        }}
      />
      {label}
    </span>
  );
}

/** Settings section for the ✨ Enhance engine — pick Auto / Ollama / offline. */
function LLMSection() {
  const engines = useLLM((s) => s.engines);
  const selected = useSession((s) => s.llmProviderId);
  const setLLM = useSession((s) => s.setLLMProvider);

  return (
    <div style={{ padding: "14px 12px 4px", borderTop: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Wand2 size={15} strokeWidth={1.8} color="var(--accent)" />
        <div style={{ fontSize: 13, fontWeight: 600 }}>Prompt enhancement</div>
      </div>
      <div
        style={{
          fontSize: 11.5,
          color: "var(--text-muted)",
          margin: "3px 0 12px",
          lineHeight: 1.5,
        }}
      >
        The local model behind ✨ Enhance. Runs on your machine — no key, nothing leaves it.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <EngineCard
          label={
            <>
              Auto{" "}
              <span style={{ color: "var(--text-faint)", fontWeight: 400 }}>· best available</span>
            </>
          }
          selected={selected === "auto"}
          onSelect={() => setLLM("auto")}
          badge={
            <span
              style={{
                fontSize: 10.5,
                padding: "2px 7px",
                borderRadius: 999,
                color: "var(--accent)",
                background: "color-mix(in srgb, var(--accent) 14%, transparent)",
              }}
            >
              Recommended
            </span>
          }
        />
        {engines.map((e) => (
          <EngineCard
            key={e.id}
            label={e.label}
            selected={selected === e.id}
            onSelect={() => setLLM(e.id)}
            badge={
              e.connection ? (
                <StatusBadge ok={e.available} label={e.available ? "Reachable" : "Not reachable"} />
              ) : (
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Built-in</span>
              )
            }
          >
            {selected === e.id && e.connection && <EngineUrlField engine={e} />}
          </EngineCard>
        ))}
      </div>
    </div>
  );
}

export function SettingsDialog() {
  const settingsOpen = useSession((s) => s.settingsOpen);
  const closeSettings = useSession((s) => s.closeSettings);
  const providers = useProviders((s) => s.providers);

  return (
    <Dialog.Root open={settingsOpen} onOpenChange={(o) => !o && closeSettings()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dlg-overlay" />
        <Dialog.Content className="dlg-content" aria-describedby={undefined}>
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              padding: "18px 18px 0 20px",
            }}
          >
            <div>
              <Dialog.Title
                style={{ fontSize: 16, fontWeight: 600, letterSpacing: "-.01em", margin: 0 }}
              >
                Settings
              </Dialog.Title>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                Providers, keys &amp; prompt enhancement
              </div>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                style={{
                  width: 30,
                  height: 30,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 8,
                  background: "var(--surface-2)",
                  border: "1px solid var(--border)",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                }}
              >
                <X size={15} strokeWidth={1.9} />
              </button>
            </Dialog.Close>
          </div>

          <div
            style={{
              display: "flex",
              gap: 20,
              padding: "14px 20px 0",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <div
              style={{
                paddingBottom: 10,
                fontSize: 12.5,
                fontWeight: 500,
                color: "var(--text)",
                borderBottom: "2px solid var(--accent)",
                marginBottom: -1,
              }}
            >
              Providers
            </div>
            <div style={{ paddingBottom: 10, fontSize: 12.5, color: "var(--text-faint)" }}>
              Canvas
            </div>
            <div style={{ paddingBottom: 10, fontSize: 12.5, color: "var(--text-faint)" }}>
              About
            </div>
          </div>

          <div style={{ overflow: "auto", padding: "6px 8px" }}>
            {providers.map((p, i) => (
              <ProviderCard key={p.id} p={p} last={i === providers.length - 1} />
            ))}
            <LLMSection />
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              padding: "12px 20px",
              borderTop: "1px solid var(--border)",
              background: "color-mix(in srgb, var(--ok) 5%, transparent)",
            }}
          >
            <Lock size={15} strokeWidth={1.7} color="var(--text-muted)" style={{ flex: "none" }} />
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              Keys are encrypted and stored only on this device.
            </span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
