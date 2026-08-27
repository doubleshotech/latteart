import type { Layer } from "../../stores/documentStore";

/**
 * A fully-populated {@link Layer} for compositor tests. Tests build layers as
 * literals instead of importing `makeLayer` — the store module drags zustand
 * along, and a test's layer should state every field it relies on anyway.
 */
export function layer(over: Partial<Layer> & Pick<Layer, "src">): Layer {
  return {
    id: "test-layer",
    name: "layer",
    visible: true,
    opacity: 1,
    x: 0,
    y: 0,
    width: 4,
    height: 4,
    rotation: 0,
    blendMode: "normal",
    mask: null,
    status: "ready",
    progress: 100,
    prompt: null,
    derivedFrom: null,
    ...over,
  };
}
