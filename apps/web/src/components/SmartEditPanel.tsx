import { useEffect, useRef, useState } from "react";
import { ChevronLeft, Undo2, Wand2 } from "lucide-react";
import { rewriteInpaintInstruction } from "../api/inpaintPrompt";
import { inpaintBlockedNote } from "../lib/actions";
import { guessTarget, maskFromMatte, previewFromMatte, type MaskTarget } from "../lib/autoMask";
import { foregroundMatte, type Matte } from "../lib/removeBackgroundAI";
import type { Layer } from "../stores/documentStore";
import { useGeneration } from "../stores/generationStore";
import { useProviders } from "../stores/providersStore";
import { useSession } from "../stores/sessionStore";

const fieldLabel: React.CSSProperties = { fontSize: 12, fontWeight: 500, color: "var(--text)" };
const monoFaint: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 9.5,
  color: "var(--text-faint)",
};

/** Square icon affordance beside the instruction input (rewrite / undo). */
const iconBtn: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 40,
  height: 40,
  borderRadius: 10,
  background: "var(--surface-2)",
  border: "1px solid var(--border)",
  color: "var(--text-muted)",
  cursor: "pointer",
  flex: "none",
};

const spinner: React.CSSProperties = {
  width: 15,
  height: 15,
  borderRadius: "50%",
  border: "2.4px solid rgba(255,255,255,0.12)",
  borderTopColor: "var(--accent)",
  animation: "latte-spin 0.9s linear infinite",
};

const TARGETS: { id: MaskTarget; label: string; note: string }[] = [
  {
    id: "subject",
    label: "Subject",
    note: "Regenerates the subject — the background stays locked.",
  },
  {
    id: "background",
    label: "Background",
    note: "Regenerates the background — the subject stays locked.",
  },
];

/**
 * Smart edit drill-in — type an instruction and inpaint without hand-painting a
 * mask. The mask comes from the RMBG foreground matte (subject vs. background),
 * so the region the user isn't editing stays pixel-identical. Mirrors
 * ActionDrillIn's chrome and MaskEditor's rewrite/undo pattern.
 */
export function SmartEditPanel({ source }: { source: Layer }) {
  const closeAction = useSession((s) => s.closeAction);
  const providerId = useSession((s) => s.providerId);
  const model = useSession((s) => s.model);
  const llmProviderId = useSession((s) => s.llmProviderId);
  const providers = useProviders((s) => s.providers);
  const runAction = useGeneration((s) => s.runAction);
  const setError = useGeneration((s) => s.setError);

  const [target, setTarget] = useState<MaskTarget>(() => guessTarget(""));
  // The heuristic keeps steering the toggle until the user picks one by hand.
  const [targetTouched, setTargetTouched] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [rewriting, setRewriting] = useState(false);
  const [preRewrite, setPreRewrite] = useState<string | null>(null);
  const rewriteCtl = useRef<AbortController | null>(null);

  // The matte is target-independent — build it once (~3s), then flipping the
  // toggle re-derives the mask + preview instantly.
  const [matte, setMatte] = useState<Matte | null>(null);
  const [mask, setMask] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const prepCtl = useRef<AbortController | null>(null);

  const active = providers.find((p) => p.id === providerId);
  const canInpaint = !!active?.available && !!active.capabilities.inpaint;
  const canRewrite = prompt.trim().length > 0 && !rewriting;
  const canGenerate = canInpaint && !!mask && !!prompt.trim();
  const targetMeta = TARGETS.find((t) => t.id === target)!;
  const Icon = Wand2;

  const blockedNote = inpaintBlockedNote(active);

  // Re-derive mask + preview whenever the matte or target changes.
  useEffect(() => {
    if (!matte || !source.src) return;
    let alive = true;
    setMask(maskFromMatte(matte, target));
    previewFromMatte(source.src, matte, target)
      .then((p) => {
        if (alive) setPreview(p);
      })
      .catch(() => {
        /* preview is a nicety; a failure here still leaves a usable mask */
      });
    return () => {
      alive = false;
    };
  }, [matte, target, source.src]);

  // Abort in-flight work if the panel closes.
  useEffect(
    () => () => {
      rewriteCtl.current?.abort();
      prepCtl.current?.abort();
    },
    [],
  );

  const pickTarget = (t: MaskTarget) => {
    setTargetTouched(true);
    setTarget(t);
  };

  const editPrompt = (value: string) => {
    setPrompt(value);
    rewriteCtl.current?.abort();
    if (preRewrite !== null) setPreRewrite(null);
    // Until the user commits a target by hand, let the wording steer it.
    if (!targetTouched) setTarget(guessTarget(value));
  };

  /** Expand the terse instruction into a detailed fill prompt via the local LLM. */
  const runRewrite = async () => {
    const text = prompt.trim();
    if (!text || rewriting) return;
    rewriteCtl.current?.abort();
    const ctl = new AbortController();
    rewriteCtl.current = ctl;
    setRewriting(true);
    try {
      const { prompt: rewritten } = await rewriteInpaintInstruction(
        text,
        llmProviderId,
        source.prompt || undefined,
        ctl.signal,
      );
      if (ctl.signal.aborted) return;
      setPreRewrite(prompt);
      setPrompt(rewritten);
    } catch (err) {
      if (!ctl.signal.aborted)
        setError((err as Error).message || "Couldn't rewrite the instruction.");
    } finally {
      if (rewriteCtl.current === ctl) rewriteCtl.current = null;
      setRewriting(false);
    }
  };

  const revertRewrite = () => {
    if (preRewrite === null) return;
    setPrompt(preRewrite);
    setPreRewrite(null);
  };

  /** Build the foreground matte (once) so the derive effect can show the preview. */
  const buildPreview = async () => {
    if (!source.src || preparing) return;
    prepCtl.current?.abort();
    const ctl = new AbortController();
    prepCtl.current = ctl;
    setPreparing(true);
    try {
      const m = await foregroundMatte(source.src, ctl.signal);
      if (ctl.signal.aborted) return;
      setMatte(m);
    } catch (err) {
      if ((err as Error).name !== "AbortError")
        setError((err as Error).message || "Couldn't build the mask — no clear subject found.");
    } finally {
      if (prepCtl.current === ctl) prepCtl.current = null;
      setPreparing(false);
    }
  };

  const generate = () => {
    if (!canGenerate || !active || !mask) return;
    runAction({
      providerId: active.id,
      model: model ?? undefined,
      kind: "smart-edit",
      sourceId: source.id,
      prompt,
      mask,
      detail: `inpaint · ${target} · ${active.label}`,
    });
    closeAction();
  };

  const onPrimary = () => {
    if (mask) generate();
    else void buildPreview();
  };
  const primaryLabel = preparing ? "Preparing mask…" : mask ? "Generate edit" : "Preview mask";
  const primaryDisabled = preparing || (mask ? !canGenerate : !source.src);

  return (
    <>
      {/* header — mirrors ActionDrillIn */}
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
        <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600 }}>Smart edit</div>
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
        {/* target toggle */}
        <div>
          <div style={{ ...fieldLabel, marginBottom: 7 }}>What to change</div>
          <div style={{ display: "flex", gap: 6 }}>
            {TARGETS.map((t) => {
              const on = t.id === target;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => pickTarget(t.id)}
                  style={{
                    flex: 1,
                    height: 34,
                    borderRadius: 8,
                    background: on
                      ? "color-mix(in srgb, var(--accent) 16%, transparent)"
                      : "var(--surface-2)",
                    border: on
                      ? "1px solid color-mix(in srgb, var(--accent) 45%, transparent)"
                      : "1px solid var(--border)",
                    color: on ? "var(--accent)" : "var(--text-muted)",
                    fontSize: 12.5,
                    fontWeight: 600,
                    fontFamily: "inherit",
                    cursor: "pointer",
                  }}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
          <div style={{ ...monoFaint, marginTop: 7, lineHeight: 1.4 }}>{targetMeta.note}</div>
        </div>

        {/* instruction + rewrite */}
        <div>
          <div style={{ ...fieldLabel, marginBottom: 7 }}>Instruction</div>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <textarea
              value={prompt}
              onChange={(e) => editPrompt(e.target.value)}
              placeholder={
                target === "background"
                  ? "Describe the new background — e.g. a misty pine forest at dawn…"
                  : "Describe the new subject — e.g. a bronze robot in the same pose…"
              }
              rows={3}
              style={{
                flex: 1,
                minHeight: 78,
                padding: "10px 11px",
                borderRadius: 9,
                background: "var(--surface-canvas)",
                border: "1px solid var(--border-strong)",
                color: "var(--text)",
                fontSize: 12.5,
                lineHeight: 1.55,
                fontFamily: "inherit",
                resize: "vertical",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {/* ✨ rewrite into a detailed fill prompt */}
              <button
                type="button"
                onClick={runRewrite}
                disabled={!canRewrite}
                title="Rewrite — expand your instruction into a detailed fill prompt via a local LLM"
                aria-label="Rewrite instruction"
                style={{
                  ...iconBtn,
                  color: canRewrite ? "var(--accent)" : "var(--text-faint)",
                  cursor: canRewrite ? "pointer" : "not-allowed",
                  opacity: prompt.trim().length > 0 ? 1 : 0.5,
                }}
              >
                {rewriting ? <span style={spinner} /> : <Wand2 size={16} strokeWidth={1.8} />}
              </button>
              {/* revert to the pre-rewrite instruction — only right after a rewrite */}
              {preRewrite !== null && (
                <button
                  type="button"
                  onClick={revertRewrite}
                  title="Undo rewrite — restore your instruction"
                  aria-label="Undo rewrite"
                  style={{ ...iconBtn, color: "var(--text-faint)" }}
                >
                  <Undo2 size={15} strokeWidth={1.9} />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* mask preview */}
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 7,
            }}
          >
            <span style={fieldLabel}>Mask preview</span>
            {preview && <span style={monoFaint}>tinted = regenerates</span>}
          </div>
          <div
            style={{
              position: "relative",
              borderRadius: 9,
              overflow: "hidden",
              border: "1px solid var(--border)",
              background: "var(--surface-canvas)",
              minHeight: 120,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {preview ? (
              <img
                src={preview}
                alt="Mask preview"
                draggable={false}
                style={{ width: "100%", display: "block" }}
              />
            ) : (
              <div
                style={{
                  padding: "24px 16px",
                  textAlign: "center",
                  fontSize: 11.5,
                  color: "var(--text-faint)",
                  lineHeight: 1.5,
                }}
              >
                {preparing
                  ? "Preparing mask…"
                  : "Preview the mask to confirm the region before generating."}
              </div>
            )}
          </div>
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
          disabled={primaryDisabled}
          onClick={onPrimary}
          title={blockedNote ?? undefined}
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
            cursor: primaryDisabled ? "not-allowed" : "pointer",
            opacity: primaryDisabled ? 0.5 : 1,
            boxShadow: "0 3px 12px -2px color-mix(in srgb, var(--accent) 60%, transparent)",
          }}
        >
          {preparing ? <span style={spinner} /> : <Icon size={16} strokeWidth={1.8} />}
          {primaryLabel}
        </button>
        <div style={{ ...monoFaint, textAlign: "center", marginTop: 8 }}>
          {blockedNote ?? `Creates a new layer above ${source.name}`}
        </div>
      </div>
    </>
  );
}
