import { useEffect } from "react";
import { Group, Image as KonvaImage, Rect } from "react-konva";
import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import { useImage } from "../lib/useImage";
import { useHasAlpha } from "../lib/useHasAlpha";
import { checkerPattern } from "../lib/checkerboard";
import { useDocument, type Layer } from "../stores/documentStore";

const CORNER = 4;

/** A ready image layer: draggable, selectable, transformable Konva node. */
export function LayerNode({
  layer,
  registerRef,
}: {
  layer: Layer;
  registerRef: (id: string, node: Konva.Node | null) => void;
}) {
  const img = useImage(layer.src);
  const hasAlpha = useHasAlpha(img, layer.src);
  const select = useDocument((s) => s.select);
  const selected = useDocument((s) => s.selectedId === layer.id);
  const updateLayer = useDocument((s) => s.updateLayer);

  // Fit the layer to the real image's aspect once it loads — providers return
  // varying sizes, but the placeholder was created at the requested size.
  useEffect(() => {
    if (!img?.naturalWidth || !img.naturalHeight) return;
    const current = useDocument.getState().layers.find((x) => x.id === layer.id);
    if (!current) return;
    const imgAspect = img.naturalWidth / img.naturalHeight;
    const layerAspect = current.width / current.height;
    if (Math.abs(imgAspect - layerAspect) > 0.02) {
      // System adjustment, not a user edit — keep it out of the undo stack.
      useDocument
        .getState()
        .updateLayer(
          layer.id,
          { height: Math.max(24, Math.round(current.width / imgAspect)) },
          { history: false },
        );
    }
  }, [img, layer.id]);

  if (!layer.visible) return null;

  // Back a transparent layer with a checkerboard while it's selected, so its
  // cut-out areas read as transparency. Left off when unselected: this is a
  // free multi-layer canvas, so an always-on backing would occlude whatever
  // sits beneath the layer instead of compositing through it.
  const showChecker = hasAlpha && selected;

  return (
    <Group
      x={layer.x}
      y={layer.y}
      rotation={layer.rotation}
      draggable
      ref={(node) => registerRef(layer.id, node)}
      onMouseDown={() => select(layer.id)}
      onTap={() => select(layer.id)}
      onDragEnd={(e: KonvaEventObject<DragEvent>) =>
        updateLayer(layer.id, { x: e.target.x(), y: e.target.y() })
      }
      onTransformEnd={(e: KonvaEventObject<Event>) => {
        const node = e.target as Konva.Group;
        const sx = node.scaleX();
        const sy = node.scaleY();
        node.scaleX(1);
        node.scaleY(1);
        updateLayer(layer.id, {
          x: node.x(),
          y: node.y(),
          width: Math.max(24, layer.width * sx),
          height: Math.max(24, layer.height * sy),
          rotation: node.rotation(),
        });
      }}
    >
      {showChecker && (
        <Rect
          width={layer.width}
          height={layer.height}
          cornerRadius={CORNER}
          fillPatternImage={checkerPattern()}
          fillPatternRepeat="repeat"
          listening={false}
        />
      )}
      <KonvaImage
        image={img ?? undefined}
        width={layer.width}
        height={layer.height}
        opacity={layer.opacity}
        cornerRadius={CORNER}
        shadowColor="#000000"
        shadowBlur={26}
        shadowOpacity={0.5}
        shadowOffsetY={14}
      />
    </Group>
  );
}
