import { Download, Settings } from "lucide-react";
import { LogoMark } from "./LogoMark";
import { useProviders } from "../stores/providersStore";
import { useSession } from "../stores/sessionStore";

export function Topbar() {
  const providers = useProviders((s) => s.providers);
  const providerId = useSession((s) => s.providerId);
  const openSettings = useSession((s) => s.openSettings);

  const active = providers.find((p) => p.id === providerId);
  const keyed = active?.kind === "cloud" && active.hasKey;
  const statusLabel = active
    ? `${active.label}${active.kind === "local" ? " · local" : keyed ? " · key set" : ""}`
    : "No provider";

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
          title="Export — flatten visible layers to PNG (coming soon)"
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
            cursor: "pointer",
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
