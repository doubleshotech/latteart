// node:test's describe()/it() are fire-and-forget by design (the runner awaits
// them), so the floating-promise rule doesn't apply in this test file.
/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { CustomStyleInfo } from "@latteart/shared";
import { visibleStyles } from "./stylesStore";

function style(id: string, projectId?: string): CustomStyleInfo {
  return { id, label: id, source: "heuristic", projectId, createdAt: 0 };
}

describe("visibleStyles", () => {
  const globalA = style("custom:global-a");
  const mine = style("custom:mine", "proj-1");
  const other = style("custom:other", "proj-2");
  const library = [globalA, mine, other];

  it("shows global styles plus the project's own, in library order", () => {
    assert.deepEqual(visibleStyles(library, "proj-1"), [globalA, mine]);
  });

  it("hides styles scoped to another project", () => {
    assert.deepEqual(visibleStyles(library, "proj-3"), [globalA]);
  });

  it("treats an empty projectId on a style as global", () => {
    // The server never writes "", but the filter's !s.projectId reading of a
    // falsy scope as global is a contract the picker relies on.
    assert.deepEqual(visibleStyles([style("custom:empty", "")], "proj-1"), [
      style("custom:empty", ""),
    ]);
  });
});
