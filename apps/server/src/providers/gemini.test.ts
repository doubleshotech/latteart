// node:test's describe()/it() are fire-and-forget by design (the runner awaits
// them), and the provider's methods are this-free closures, so neither the
// floating-promise nor the unbound-method rule applies in this test file.
/* eslint-disable @typescript-eslint/no-floating-promises, @typescript-eslint/unbound-method */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { EditRequest, GenerateRequest, ProviderContext } from "@latteart/shared";
import { geminiProvider } from "./gemini.ts";

/**
 * Fixture tests for custom styles v2 — native reference-image conditioning on
 * the Gemini provider. No live API call (no key yet), so correctness rests on
 * asserting the request Gemini receives: the crux is that a style's reference
 * pixels ride along as trailing `inlineData` parts AND the prompt is suffixed
 * with a style-only framing instruction (otherwise Gemini edits the reference
 * instead of emulating it). The one external boundary — global `fetch` — is
 * stubbed to capture the outgoing body.
 */

const IMG = "data:image/png;base64,QQ=="; // source image ("A")
const REF1 = "data:image/png;base64,Ymx1ZQ=="; // style ref 1 ("blue")
const REF2 = "data:image/jpeg;base64,cmVk"; // style ref 2 ("red")

// A minimal valid Gemini response carrying one inline image.
const GEMINI_OK = {
  candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "QUJD" } }] } }],
};

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

/** Stub globalThis.fetch to capture the JSON body of the one request, then
 * restore. Returns the parts array Gemini would have received. */
async function captureParts(run: () => Promise<unknown>): Promise<GeminiPart[]> {
  const original = globalThis.fetch;
  let body: { contents: { parts: GeminiPart[] }[] } | undefined;
  globalThis.fetch = (async (_input: unknown, init: RequestInit = {}) => {
    // The provider always sends a JSON string body; narrow to it (not String()).
    const raw = typeof init.body === "string" ? init.body : "";
    body = raw ? JSON.parse(raw) : undefined;
    return new Response(JSON.stringify(GEMINI_OK), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
  assert.ok(body, "expected a request to be sent");
  return body.contents[0]!.parts;
}

const ctx: ProviderContext = { apiKey: "test-key" };
const genReq = (over: Partial<GenerateRequest> = {}): GenerateRequest => ({
  providerId: "gemini",
  prompt: "a red bird",
  width: 1024,
  height: 1024,
  ...over,
});
const editReq = (over: Partial<EditRequest> = {}): EditRequest => ({
  providerId: "gemini",
  prompt: "make it night",
  image: IMG,
  mode: "img2img",
  ...over,
});

const inlineParts = (parts: GeminiPart[]) => parts.filter((p) => p.inlineData);

describe("gemini generate — native style refs", () => {
  it("sends only the prompt text and no framing when there are no refs", async () => {
    const parts = await captureParts(() => geminiProvider.generate(genReq(), ctx));
    assert.equal(parts.length, 1);
    assert.equal(parts[0]!.text, "a red bird");
    assert.equal(inlineParts(parts).length, 0);
  });

  it("appends one inlineData part per ref, after the prompt text", async () => {
    const parts = await captureParts(() =>
      geminiProvider.generate(genReq({ styleRefs: [REF1, REF2] }), ctx),
    );
    assert.equal(parts.length, 3);
    assert.ok(parts[0]!.text, "first part is the prompt text");
    assert.deepEqual(parts[1]!.inlineData, { mimeType: "image/png", data: "Ymx1ZQ==" });
    assert.deepEqual(parts[2]!.inlineData, { mimeType: "image/jpeg", data: "cmVk" });
  });

  it("marks the refs as style-only in the prompt (singular framing)", async () => {
    const parts = await captureParts(() =>
      geminiProvider.generate(genReq({ styleRefs: [REF1] }), ctx),
    );
    const text = parts[0]!.text ?? "";
    assert.match(text, /^a red bird/);
    assert.match(text, /The final image is a STYLE REFERENCE/);
    assert.match(text, /Do not copy the subject/);
  });

  it("uses plural framing for multiple refs", async () => {
    const parts = await captureParts(() =>
      geminiProvider.generate(genReq({ styleRefs: [REF1, REF2] }), ctx),
    );
    assert.match(parts[0]!.text ?? "", /The final 2 images are STYLE REFERENCES/);
  });

  it("drops refs that aren't decodable data URLs, and counts only the survivors", async () => {
    const parts = await captureParts(() =>
      geminiProvider.generate(genReq({ styleRefs: ["not-a-data-url", REF1] }), ctx),
    );
    assert.equal(inlineParts(parts).length, 1);
    assert.match(parts[0]!.text ?? "", /The final image is a STYLE REFERENCE/);
  });
});

describe("gemini edit — native style refs", () => {
  it("orders parts as [instruction, source, ...refs] with style framing", async () => {
    const parts = await captureParts(() =>
      geminiProvider.edit!(editReq({ styleRefs: [REF1] }), ctx),
    );
    assert.equal(parts.length, 3);
    assert.match(parts[0]!.text ?? "", /The final image is a STYLE REFERENCE/);
    // Source image is first (the thing being edited)…
    assert.deepEqual(parts[1]!.inlineData, { mimeType: "image/png", data: "QQ==" });
    // …the style ref trails it, so "final image" points at the ref, not the source.
    assert.deepEqual(parts[2]!.inlineData, { mimeType: "image/png", data: "Ymx1ZQ==" });
  });

  it("keeps the original [instruction, source] shape and no framing without refs", async () => {
    const parts = await captureParts(() => geminiProvider.edit!(editReq(), ctx));
    assert.equal(parts.length, 2);
    assert.equal(inlineParts(parts).length, 1);
    assert.doesNotMatch(parts[0]!.text ?? "", /STYLE REFERENCE/);
  });
});
