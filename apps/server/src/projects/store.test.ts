// node:test's describe()/it() are fire-and-forget by design (the runner awaits
// them), so the floating-promise rule doesn't apply in this test file.
/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The store binds DATA_DIR at import time (via ../paths.ts), so the override
// must land before the dynamic import — a static import would be hoisted past it.
const dataDir = mkdtempSync(join(tmpdir(), "latteart-projects-"));
process.env.LATTEART_DATA_DIR = dataDir;
const store = await import("./index.ts");

after(() => rmSync(dataDir, { recursive: true, force: true }));

describe("restyleSession", () => {
  it("points the session style at a new id and persists it", () => {
    const doc = store.createProject("Restyle probe");
    const before = doc.session.styleId;
    const updated = store.restyleSession(doc.id, "custom:abcd1234");
    assert.equal(updated?.session.styleId, "custom:abcd1234");
    assert.notEqual(updated?.session.styleId, before);
    // The write must be durable, not just the returned object: the duplicate
    // route hands the doc to a client that will re-read it from disk on open.
    assert.equal(store.loadProject(doc.id)?.session.styleId, "custom:abcd1234");
  });

  it("leaves the rest of the session untouched", () => {
    const doc = store.createProject("Restyle probe 2");
    const updated = store.restyleSession(doc.id, "custom:ffff0000");
    assert.deepEqual({ ...updated?.session, styleId: doc.session.styleId }, doc.session);
  });

  it("returns null for an unknown project", () => {
    assert.equal(store.restyleSession("no-such-project", "custom:abcd1234"), null);
  });
});
