import { Arc, Circle, Group, Rect, Text } from "react-konva";
import type { Layer } from "../stores/documentStore";

const ACCENT = "#eea145";

/** On-canvas placeholder while a layer is generating: dashed frame + ring. */
export function GeneratingNode({ layer }: { layer: Layer }) {
  const cx = layer.width / 2;
  const cy = layer.height / 2 - 8;
  const r = 24;
  const pct = Math.max(0, Math.min(100, layer.progress));

  // Editor-action result: the progress ring lives on the source layer's working
  // overlay, so the destination is just a quiet dashed frame (mockup screen 5).
  if (layer.derivedFrom) {
    return (
      <Group x={layer.x} y={layer.y} listening={false}>
        <Rect
          width={layer.width}
          height={layer.height}
          cornerRadius={6}
          stroke="rgba(238,161,69,0.55)"
          strokeWidth={1.5}
          dash={[7, 6]}
        />
        <Group x={8} y={-11}>
          <Rect
            width={84}
            height={17}
            cornerRadius={4}
            fill="#101114"
            stroke="rgba(238,161,69,0.3)"
            strokeWidth={1}
          />
          <Text
            x={0}
            y={4}
            width={84}
            align="center"
            text="new layer ↑"
            fontFamily="Geist Mono Variable, monospace"
            fontSize={9.5}
            fill={ACCENT}
          />
        </Group>
      </Group>
    );
  }

  return (
    <Group x={layer.x} y={layer.y} opacity={layer.opacity} listening={false}>
      <Rect
        width={layer.width}
        height={layer.height}
        cornerRadius={6}
        stroke={ACCENT}
        strokeWidth={1.5}
        dash={[7, 6]}
        fill="rgba(238,161,69,0.06)"
      />
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
        fill="#e7e8ea"
      />
      <Text
        x={0}
        y={cy + r + 12}
        width={layer.width}
        align="center"
        text="GENERATING"
        fontFamily="Geist Mono Variable, monospace"
        fontSize={11}
        letterSpacing={1}
        fill="#e7e8ea"
      />
    </Group>
  );
}
