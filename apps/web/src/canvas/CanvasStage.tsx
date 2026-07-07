import { Fragment, useEffect, useRef } from "react";
import { Layer as KonvaLayer, Stage, Transformer } from "react-konva";
import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import { useDocument } from "../stores/documentStore";
import { useGeneration } from "../stores/generationStore";
import { useViewport } from "../stores/viewportStore";
import { LayerNode } from "./LayerNode";
import { GeneratingNode } from "./GeneratingNode";
import { WorkingOverlay } from "./WorkingOverlay";

const ACCENT = "#eea145";

/** The infinite canvas: one Konva Stage driven by the viewport store. */
export function CanvasStage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const nodeRefs = useRef<Map<string, Konva.Node>>(new Map());

  const layers = useDocument((s) => s.layers);
  const selectedId = useDocument((s) => s.selectedId);
  const select = useDocument((s) => s.select);
  const action = useGeneration((s) => s.action);

  const scale = useViewport((s) => s.scale);
  const x = useViewport((s) => s.x);
  const y = useViewport((s) => s.y);
  const stageW = useViewport((s) => s.stageW);
  const stageH = useViewport((s) => s.stageH);
  const setStageSize = useViewport((s) => s.setStageSize);

  // Keep the stage sized to its container.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setStageSize(el.clientWidth, el.clientHeight);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [setStageSize]);

  // Attach the transformer to the selected, ready layer.
  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    const selected = layers.find((l) => l.id === selectedId && l.status === "ready" && l.visible);
    const node = selected ? nodeRefs.current.get(selected.id) : null;
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [selectedId, layers]);

  const registerRef = (id: string, node: Konva.Node | null) => {
    if (node) nodeRefs.current.set(id, node);
    else nodeRefs.current.delete(id);
  };

  const onWheel = (e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const pointer = e.target.getStage()?.getPointerPosition();
    if (!pointer) return;
    const factor = e.evt.deltaY > 0 ? 0.92 : 1.08;
    useViewport.getState().zoomAt(factor, pointer.x, pointer.y);
  };

  const onMouseDown = (e: KonvaEventObject<MouseEvent>) => {
    if (e.target === e.target.getStage()) select(null);
  };

  const onDragMove = (e: KonvaEventObject<DragEvent>) => {
    if (e.target === e.target.getStage())
      useViewport.getState().setView({ x: e.target.x(), y: e.target.y() });
  };

  return (
    <div ref={containerRef} className="canvas-root">
      <div
        className="canvas-dots"
        style={{
          backgroundPosition: `${x}px ${y}px`,
          backgroundSize: `${24 * scale}px ${24 * scale}px`,
        }}
      />
      <div className="canvas-vignette" />
      <Stage
        width={stageW}
        height={stageH}
        x={x}
        y={y}
        scaleX={scale}
        scaleY={scale}
        draggable
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onDragMove={onDragMove}
      >
        <KonvaLayer>
          {(() => {
            // Draw the working overlay directly above its anchor so layers above
            // the source aren't dimmed by the scrim. Anchor on the source when it
            // exists, else on the result placeholder (source hidden/deleted).
            const sourcePresent = layers.some((x) => x.id === action?.sourceId);
            return layers.map((l) => {
              const overlayHere =
                !!action &&
                (action.sourceId === l.id || (!sourcePresent && action.placeholderId === l.id));
              return (
                <Fragment key={l.id}>
                  {l.status === "generating" ? (
                    <GeneratingNode layer={l} />
                  ) : (
                    <LayerNode layer={l} registerRef={registerRef} />
                  )}
                  {overlayHere && <WorkingOverlay />}
                </Fragment>
              );
            });
          })()}
          <Transformer
            ref={trRef}
            rotateEnabled
            keepRatio={false}
            flipEnabled={false}
            anchorSize={9}
            anchorStroke={ACCENT}
            anchorFill="#ffffff"
            anchorCornerRadius={2}
            borderStroke={ACCENT}
            borderStrokeWidth={1.5}
            rotateAnchorOffset={26}
          />
        </KonvaLayer>
      </Stage>
    </div>
  );
}
