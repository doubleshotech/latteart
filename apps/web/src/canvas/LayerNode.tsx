import { useEffect } from "react";
import { Image as KonvaImage } from "react-konva";
import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import { useImage } from "../lib/useImage";
import { useDocument, type Layer } from "../stores/documentStore";

/** A ready image layer: draggable, selectable, transformable Konva.Image. */
export function LayerNode({
  layer,
  registerRef,
}: {
  layer: Layer;
  registerRef: (id: string, node: Konva.Node | null) => void;
}) {
  const img = useImage(layer.src);
  const select = useDocument((s) => s.select);
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

  return (
    <KonvaImage
      image={img ?? undefined}
      x={layer.x}
      y={layer.y}
      width={layer.width}
      height={layer.height}
      rotation={layer.rotation}
      opacity={layer.opacity}
      cornerRadius={4}
      shadowColor="#000000"
      shadowBlur={26}
      shadowOpacity={0.5}
      shadowOffsetY={14}
      draggable
      ref={(node) => registerRef(layer.id, node)}
      onMouseDown={() => select(layer.id)}
      onTap={() => select(layer.id)}
      onDragEnd={(e: KonvaEventObject<DragEvent>) =>
        updateLayer(layer.id, { x: e.target.x(), y: e.target.y() })
      }
      onTransformEnd={(e: KonvaEventObject<Event>) => {
        const node = e.target as Konva.Image;
        const sx = node.scaleX();
        const sy = node.scaleY();
        node.scaleX(1);
        node.scaleY(1);
        updateLayer(layer.id, {
          x: node.x(),
          y: node.y(),
          width: Math.max(24, node.width() * sx),
          height: Math.max(24, node.height() * sy),
          rotation: node.rotation(),
        });
      }}
    />
  );
}
