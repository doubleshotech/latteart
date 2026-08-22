// node:test's describe()/it() are fire-and-forget by design — the runner awaits
// them — so the floating-promise rule does not apply in this test file.
/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { imageKey } from "./imageKey.ts";

/**
 * `imageKey` trades collision resistance for memory on purpose — it keys the
 * alpha-detection and mask-stencil caches without pinning whole data URLs.
 *
 * The trade only stays safe while the key keeps **both** halves: two images
 * must share a byte length *and* their last 40 base64 characters to collide.
 * A well-meaning "simplify" to just the tail would collide across every image
 * padded to the same ending, so these tests pin each half separately.
 */

const TAIL = 40;
const url = (body: string) => `data:image/png;base64,${body}`;

describe("imageKey", () => {
  it("is the source length, a colon, then the last 40 characters", () => {
    const src = url("A".repeat(100));

    assert.equal(imageKey(src), `${src.length}:${src.slice(-TAIL)}`);
  });

  it("keeps a short source whole rather than padding it", () => {
    assert.equal(imageKey("abc"), "3:abc");
    assert.equal(imageKey(""), "0:");
  });

  it("separates sources that differ only in their tail", () => {
    const head = url("A".repeat(200));

    assert.notEqual(imageKey(`${head}aaaa`), imageKey(`${head}bbbb`));
  });

  it("separates sources that share a tail but differ in length", () => {
    const tail = "Z".repeat(TAIL);

    // Same ending, different byte length — the length half is what tells these
    // apart, and dropping it would hand back one image's mask for another.
    assert.notEqual(
      imageKey(`${url("A".repeat(50))}${tail}`),
      imageKey(`${url("A".repeat(80))}${tail}`),
    );
  });

  it("is stable and equal for the same source", () => {
    const src = url("payload".repeat(30));

    assert.equal(imageKey(src), imageKey(src));
    assert.equal(imageKey(src), imageKey(`${src}`));
  });

  it("ignores differences earlier than the last 40 characters, as documented", () => {
    const tail = "T".repeat(TAIL);
    const a = `data:image/png;base64,AAAAAAAAAA${tail}`;
    const b = `data:image/png;base64,BBBBBBBBBB${tail}`;

    // Not a defect: equal lengths plus equal tails is the documented collision,
    // and its worst cost is one wrong memo. This test exists so a future change
    // that widens the collision has to change this line deliberately.
    assert.equal(a.length, b.length);
    assert.equal(imageKey(a), imageKey(b));
  });

  it("stays short whatever the source size", () => {
    const huge = url("A".repeat(5_000_000));

    assert.ok(imageKey(huge).length < 60, "the key must not pin the payload");
  });
});
