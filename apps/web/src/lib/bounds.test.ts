// node:test's describe()/it() are fire-and-forget by design — the runner awaits
// them — so the floating-promise rule does not apply in this test file.
/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { boundsOf, corners, drawPlaced, type Composited, type Placed } from "./bounds.ts";

/**
 * `bounds.ts` states its own contract: {@link corners} and {@link drawPlaced}
 * are two halves of one transform order, and four compositors (flatten,
 * thumbnail, ora, the viewport's fit-to-content) depend on them agreeing. That
 * agreement has no runtime check — a layer drawn outside its measured hull is
 * simply clipped, silently, in an exported file.
 *
 * So these tests pin the order itself: the rotation happens about the layer's
 * **top-left**, not its centre, and `drawPlaced` translates before it rotates.
 * The measuring half gets closed-form cases whose answers are known
 * independently (a 90° turn swaps width and height; a 45° square grows by √2).
 */

/** Rotations land on irrational cosines, so compare with a tolerance. */
const EPS = 1e-9;

function assertClose(actual: number, expected: number, what: string): void {
  assert.ok(Math.abs(actual - expected) < EPS, `${what}: expected ${expected}, got ${actual}`);
}

function assertBox(
  actual: { x: number; y: number; width: number; height: number } | null,
  expected: { x: number; y: number; width: number; height: number },
): void {
  assert.ok(actual, "expected a box, got null");
  assertClose(actual.x, expected.x, "x");
  assertClose(actual.y, expected.y, "y");
  assertClose(actual.width, expected.width, "width");
  assertClose(actual.height, expected.height, "height");
}

const placed = (over: Partial<Placed> = {}): Placed => ({
  x: 0,
  y: 0,
  width: 100,
  height: 50,
  rotation: 0,
  ...over,
});

describe("corners", () => {
  it("returns the box corners clockwise from the origin when unrotated", () => {
    const result = corners(placed({ x: 10, y: 20 }));

    assert.deepEqual(result, [
      { x: 10, y: 20 },
      { x: 110, y: 20 },
      { x: 110, y: 70 },
      { x: 10, y: 70 },
    ]);
  });

  it("rotates about the top-left corner, which stays put", () => {
    const layer = placed({ x: 10, y: 20, rotation: 90 });

    const result = corners(layer);

    // The origin is the pivot: a rotation of any angle leaves it where it was.
    assertClose(result[0]!.x, 10, "pivot x");
    assertClose(result[0]!.y, 20, "pivot y");
    // A quarter turn clockwise sends +x down and +y left.
    assertClose(result[1]!.x, 10, "width corner x");
    assertClose(result[1]!.y, 120, "width corner y");
    assertClose(result[2]!.x, -40, "far corner x");
    assertClose(result[2]!.y, 120, "far corner y");
    assertClose(result[3]!.x, -40, "height corner x");
    assertClose(result[3]!.y, 20, "height corner y");
  });

  it("sends a half turn to the opposite side of the pivot", () => {
    const result = corners(placed({ x: 0, y: 0, rotation: 180 }));

    assertClose(result[2]!.x, -100, "far corner x");
    assertClose(result[2]!.y, -50, "far corner y");
  });
});

describe("boundsOf", () => {
  it("returns null for no layers", () => {
    assert.equal(boundsOf([]), null);
  });

  it("returns an unrotated layer's own box", () => {
    assertBox(boundsOf([placed({ x: 10, y: 20 })]), { x: 10, y: 20, width: 100, height: 50 });
  });

  it("swaps width and height for a quarter turn", () => {
    assertBox(boundsOf([placed({ x: 10, y: 20, rotation: 90 })]), {
      x: -40,
      y: 20,
      width: 50,
      height: 100,
    });
  });

  it("grows a square by root two at 45 degrees", () => {
    const side = 100;

    const box = boundsOf([placed({ width: side, height: side, rotation: 45 })]);

    const diagonal = side * Math.SQRT2;
    assertBox(box, { x: -diagonal / 2, y: 0, width: diagonal, height: diagonal });
  });

  it("unions disjoint layers, including negative coordinates", () => {
    const box = boundsOf([
      placed({ x: -60, y: -30, width: 10, height: 10 }),
      placed({ x: 100, y: 200, width: 40, height: 20 }),
    ]);

    assertBox(box, { x: -60, y: -30, width: 200, height: 250 });
  });

  it("is unchanged by a layer fully inside another", () => {
    const outer = placed({ x: 0, y: 0, width: 100, height: 100 });
    const inner = placed({ x: 25, y: 25, width: 10, height: 10 });

    assert.deepEqual(boundsOf([outer, inner]), boundsOf([outer]));
  });

  it("measures the rotated hull, not the unrotated box", () => {
    const upright = boundsOf([placed({ width: 100, height: 100 })]);
    const turned = boundsOf([placed({ width: 100, height: 100, rotation: 30 })]);

    assert.ok(turned!.width > upright!.width, "a rotated square needs a wider hull");
    assert.ok(turned!.height > upright!.height, "a rotated square needs a taller hull");
  });
});

/** Records the calls and the alpha/blend state in force when a draw happens. */
interface DrawCall {
  op: string;
  args: unknown[];
  alpha: number;
  composite: string;
}

function recordingContext(): { calls: DrawCall[]; ctx: CanvasRenderingContext2D } {
  const calls: DrawCall[] = [];
  const state = { globalAlpha: 1, globalCompositeOperation: "source-over" };
  const note = (op: string, args: unknown[]) => {
    calls.push({ op, args, alpha: state.globalAlpha, composite: state.globalCompositeOperation });
  };
  const ctx = {
    get globalAlpha() {
      return state.globalAlpha;
    },
    set globalAlpha(v: number) {
      state.globalAlpha = v;
    },
    get globalCompositeOperation() {
      return state.globalCompositeOperation;
    },
    set globalCompositeOperation(v: string) {
      state.globalCompositeOperation = v;
    },
    save: () => note("save", []),
    restore: () => note("restore", []),
    translate: (...args: unknown[]) => note("translate", args),
    rotate: (...args: unknown[]) => note("rotate", args),
    drawImage: (...args: unknown[]) => note("drawImage", args),
  };
  return { calls, ctx: ctx as unknown as CanvasRenderingContext2D };
}

const composited = (over: Partial<Composited> = {}): Composited => ({
  ...placed(),
  opacity: 1,
  ...over,
});

/** `drawPlaced` only forwards this to `drawImage`; it never reads from it. */
const IMAGE = {} as CanvasImageSource;

describe("drawPlaced", () => {
  it("translates to the layer's origin, then rotates, then draws", () => {
    const layer = composited({ x: 10, y: 20, rotation: 90 });

    const { calls, ctx } = recordingContext();
    drawPlaced(ctx, layer, IMAGE, { x: 5, y: 5 });

    assert.deepEqual(
      calls.map((c) => c.op),
      ["save", "translate", "rotate", "drawImage", "restore"],
      "translate must precede rotate, or the layer pivots about the wrong point",
    );
    assert.deepEqual(calls[1]!.args, [5, 15], "translate is relative to the composite's origin");
    assertClose(calls[2]!.args[0] as number, Math.PI / 2, "rotation in radians");
    assert.deepEqual(calls[3]!.args, [IMAGE, 0, 0, 100, 50], "drawn at the post-transform origin");
  });

  it("draws at the layer's own size, so the measured hull matches what lands", () => {
    const layer = composited({ x: -30, y: 40, width: 64, height: 48 });

    const { calls, ctx } = recordingContext();
    drawPlaced(ctx, layer, IMAGE, { x: 0, y: 0 });

    const hull = corners(layer);
    assert.deepEqual(calls[1]!.args, [hull[0]!.x, hull[0]!.y], "translate lands on the pivot");
    assert.deepEqual(calls[3]!.args.slice(3), [64, 48]);
  });

  it("applies opacity and blend mode by default", () => {
    const { calls, ctx } = recordingContext();
    drawPlaced(ctx, composited({ opacity: 0.4, blendMode: "multiply" }), IMAGE, { x: 0, y: 0 });

    const draw = calls.find((c) => c.op === "drawImage")!;
    assert.equal(draw.alpha, 0.4);
    assert.equal(draw.composite, "multiply");
  });

  it("reads an absent blend mode as normal", () => {
    for (const blendMode of [null, undefined, "normal" as const]) {
      const { calls, ctx } = recordingContext();
      drawPlaced(ctx, composited({ blendMode }), IMAGE, { x: 0, y: 0 });

      const draw = calls.find((c) => c.op === "drawImage")!;
      assert.equal(draw.composite, "source-over", `blendMode ${String(blendMode)}`);
    }
  });

  it("leaves opacity and blend alone when bare", () => {
    const { calls, ctx } = recordingContext();
    drawPlaced(
      ctx,
      composited({ opacity: 0.4, blendMode: "multiply" }),
      IMAGE,
      { x: 0, y: 0 },
      {
        bare: true,
      },
    );

    // An OpenRaster layer keeps both live in stack.xml, so baking them in here
    // would apply each of them twice.
    const draw = calls.find((c) => c.op === "drawImage")!;
    assert.equal(draw.alpha, 1);
    assert.equal(draw.composite, "source-over");
  });

  it("balances save and restore so a caller can draw a stack in a plain loop", () => {
    const { calls, ctx } = recordingContext();
    for (const opacity of [0.2, 0.5, 1]) {
      drawPlaced(ctx, composited({ opacity }), IMAGE, { x: 0, y: 0 });
    }

    assert.equal(calls.filter((c) => c.op === "save").length, 3);
    assert.equal(calls.filter((c) => c.op === "restore").length, 3);
    assert.equal(calls.at(-1)!.op, "restore");
  });
});
