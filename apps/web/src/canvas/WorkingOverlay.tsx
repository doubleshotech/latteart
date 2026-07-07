import { Arc, Circle, Group, Rect, Text } from "react-konva";
import { ACTIONS } from "../lib/actions";
import { useDocument } from "../stores/documentStore";
import { useGeneration } from "../stores/generationStore";

const ACCENT = "#eea145";

/**
 * While an editor action runs, the source layer stays visible under a dark
 * working scrim with a determinate progress ring (mockup screen 5). The result
 * placeholder is a separate dashed frame rendered by GeneratingNode. When the
 * source is hidden or deleted, the ring falls back onto that placeholder so
 * progress still reads on-canvas (no scrim over a dashed frame).
 */
export function WorkingOverlay() {
  const action = useGeneration((s) => s.action);
  const layers = useDocument((s) => s.layers);

  if (!action) return null;
  const source = layers.find((l) => l.id === action.sourceId);
  const placeholder = layers.find((l) => l.id === action.placeholderId);
  // Anchor the ring on the live source when it's visible; otherwise on the
  // result placeholder. Return null only if neither exists.
  const onSource = !!source && source.visible;
  const anchor = onSource ? source : placeholder;
  if (!anchor) return null;

  const pct = Math.max(0, Math.min(100, placeholder?.progress ?? 0));

  const cx = anchor.width / 2;
  const cy = anchor.height / 2 - 8;
  const r = 24;
  const kindLabel = ACTIONS[action.kind].canvasLabel;
  const label = action.count > 1 ? `${kindLabel} ${action.index + 1}/${action.count}` : kindLabel;

  return (
    <Group
      x={anchor.x}
      y={anchor.y}
      rotation={anchor.rotation}
      opacity={onSource ? anchor.opacity : 1}
      listening={false}
    >
      {onSource && (
        <Rect
          width={anchor.width}
          height={anchor.height}
          cornerRadius={4}
          fill="rgba(8,9,12,0.6)"
        />
      )}
      <Circle x={cx} y={cy} radius={r} stroke="rgba(255,255,255,0.1)" strokeWidth={4} />
      <Arc
        x={cx}
        y={cy}
        innerRadius={r - 2}
        outerRadius={r + 2}
        angle={pct * 3.6}
        rotation={-90}
        fill={ACCENT}
      />
      <Text
        x={cx - 34}
        y={cy - 7}
        width={68}
        align="center"
        text={`${Math.round(pct)}%`}
        fontFamily="Geist Mono Variable, monospace"
        fontSize={13}
        fill="#ffffff"
      />
      <Text
        x={0}
        y={cy + r + 12}
        width={anchor.width}
        align="center"
        text={label}
        fontFamily="Geist Mono Variable, monospace"
        fontSize={11}
        letterSpacing={1}
        fill="#e7e8ea"
      />
    </Group>
  );
}
