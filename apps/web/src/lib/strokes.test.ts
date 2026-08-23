// node:test's describe()/it() are fire-and-forget by design — the runner awaits
// them — so the floating-promise rule does not apply in this test file.
/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderStroke, renderStrokes, type Stroke } from "./strokes.ts";

/**
 * Both mask painters — the inpaint Edit-area overlay and the layer-mask editor
 * — paint through here, and a mask is not a picture: a stroke that fails to
 * paint leaves a hole the model then refuses to touch, with nothing on screen
 * to say why.
 *
 * The case worth guarding is the single-point one. A tap is a `moveTo` with no
 * `lineTo`, which strokes nothing at all under any line cap, so it goes through
 * `arc` + `fill` instead. These tests hold that branch, and hold that the dot's
 * radius is half the brush size — matching the width a dragged stroke gets.
 */

interface Call {
  op: string;
  args: unknown[];
}

function recordingContext(): {
  calls: Call[];
  ops: () => string[];
  ctx: CanvasRenderingContext2D;
  state: {
    lineWidth: number;
    lineCap: string;
    lineJoin: string;
    strokeStyle: string;
    fillStyle: string;
  };
} {
  const calls: Call[] = [];
  const state = {
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    strokeStyle: "#000000",
    fillStyle: "#000000",
  };
  const note = (op: string, args: unknown[]) => calls.push({ op, args });
  const ctx = {
    ...state,
    beginPath: () => note("beginPath", []),
    moveTo: (...args: unknown[]) => note("moveTo", args),
    lineTo: (...args: unknown[]) => note("lineTo", args),
    arc: (...args: unknown[]) => note("arc", args),
    fill: () => note("fill", []),
    stroke: () => note("stroke", []),
  };
  // Mirror the style properties into `state` as the code under test sets them.
  const proxied = new Proxy(ctx, {
    set(target, key, value) {
      if (key in state) (state as Record<string, unknown>)[key as string] = value;
      return Reflect.set(target, key, value);
    },
  });
  return {
    calls,
    ops: () => calls.map((c) => c.op),
    ctx: proxied as unknown as CanvasRenderingContext2D,
    state,
  };
}

const stroke = (over: Partial<Stroke> = {}): Stroke => ({
  size: 20,
  points: [
    { x: 0, y: 0 },
    { x: 10, y: 10 },
  ],
  ...over,
});

describe("renderStroke — a dragged stroke", () => {
  it("moves to the first point and lines to every later one", () => {
    const s = stroke({
      points: [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
        { x: 5, y: 6 },
      ],
    });

    const { calls, ops, ctx } = recordingContext();
    renderStroke(ctx, s);

    assert.deepEqual(ops(), ["beginPath", "moveTo", "lineTo", "lineTo", "stroke"]);
    assert.deepEqual(calls[1]!.args, [1, 2]);
    assert.deepEqual(calls[2]!.args, [3, 4]);
    assert.deepEqual(calls[3]!.args, [5, 6]);
  });

  it("sets the line width to the brush size", () => {
    const { state, ctx } = recordingContext();
    renderStroke(ctx, stroke({ size: 37 }));

    assert.equal(state.lineWidth, 37);
  });

  it("uses round caps and joins, so a stroke has no square corners", () => {
    const { state, ctx } = recordingContext();
    renderStroke(ctx, stroke());

    assert.equal(state.lineCap, "round");
    assert.equal(state.lineJoin, "round");
  });
});

describe("renderStroke — a single tap", () => {
  it("fills a dot instead of stroking a zero-length line", () => {
    const { ops, ctx } = recordingContext();
    renderStroke(ctx, stroke({ points: [{ x: 8, y: 9 }] }));

    // The exact sequence already forbids `stroke`, which is the point: a
    // zero-length line paints nothing under any cap.
    assert.deepEqual(ops(), ["beginPath", "arc", "fill"]);
  });

  it("gives the dot half the brush size as its radius", () => {
    const { calls, ctx } = recordingContext();
    renderStroke(ctx, stroke({ size: 24, points: [{ x: 8, y: 9 }] }));

    const arc = calls.find((c) => c.op === "arc")!;
    assert.deepEqual(arc.args, [8, 9, 12, 0, Math.PI * 2], "a full circle of radius size / 2");
  });

  it("matches the width a dragged stroke of the same size gets", () => {
    const size = 30;

    const dot = recordingContext();
    renderStroke(dot.ctx, stroke({ size, points: [{ x: 0, y: 0 }] }));
    const dragged = recordingContext();
    renderStroke(dragged.ctx, stroke({ size }));

    const radius = dot.calls.find((c) => c.op === "arc")!.args[2] as number;
    assert.equal(radius * 2, dragged.state.lineWidth, "a tap must be as wide as a drag");
  });
});

describe("renderStrokes", () => {
  it("paints every stroke in the given colour", () => {
    const { calls, state, ctx } = recordingContext();
    renderStrokes(ctx, [stroke(), stroke({ points: [{ x: 5, y: 5 }] }), stroke()], "#ffffff");

    assert.equal(state.strokeStyle, "#ffffff");
    assert.equal(state.fillStyle, "#ffffff", "the dot branch fills, so fillStyle matters too");
    assert.equal(calls.filter((c) => c.op === "beginPath").length, 3, "one path per stroke");
    assert.equal(calls.filter((c) => c.op === "stroke").length, 2);
    assert.equal(calls.filter((c) => c.op === "fill").length, 1);
  });

  it("draws nothing for an empty list", () => {
    const { calls, ctx } = recordingContext();
    renderStrokes(ctx, [], "#ffffff");

    assert.deepEqual(calls, []);
  });

  it("keeps stroke order, so a later stroke paints over an earlier one", () => {
    const { calls, ctx } = recordingContext();
    renderStrokes(
      ctx,
      [stroke({ points: [{ x: 1, y: 1 }] }), stroke({ points: [{ x: 2, y: 2 }] })],
      "#000000",
    );

    const arcs = calls.filter((c) => c.op === "arc");
    assert.deepEqual(arcs[0]!.args.slice(0, 2), [1, 1]);
    assert.deepEqual(arcs[1]!.args.slice(0, 2), [2, 2]);
  });
});
