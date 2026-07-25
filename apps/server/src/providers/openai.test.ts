// node:test's describe()/it() are fire-and-forget by design (the runner awaits
// them), and the provider's methods are this-free closures, so neither the
// floating-promise nor the unbound-method rule applies in this test file.
/* eslint-disable @typescript-eslint/no-floating-promises, @typescript-eslint/unbound-method */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PNG } from "pngjs";
import type { EditRequest, GenerateRequest, ProviderContext } from "@latteart/shared";
import { createOpenAIProvider } from "./openai.ts";

/**
 * Fixture tests for the OpenAI (gpt-image-1) provider. No live API call (no key
 * yet), so correctness rests on these fixtures matching OpenAI's documented
 * images contract. Seam under test: the provider's public generate()/edit();
 * the one external boundary — HTTP `fetch` — is injected as a stub.
 */

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A fetch stub that returns one response and records the request. */
function openaiStub(response: unknown, status = 200) {
  const calls: RecordedCall[] = [];
  const impl = async (input: unknown, init: RequestInit = {}): Promise<Response> => {
    calls.push({
      url: String(input),
      method: (init.method ?? "GET").toUpperCase(),
      headers: (init.headers ?? {}) as Record<string, string>,
      body: init.body,
    });
    return json(response, status);
  };
  return { fetchImpl: impl as unknown as typeof fetch, calls };
}

const ctxWith = (onProgress?: ProviderContext["onProgress"]): ProviderContext => ({
  apiKey: "test-key",
  onProgress,
});

const genReq = (over: Partial<GenerateRequest> = {}): GenerateRequest => ({
  providerId: "openai",
  prompt: "a red bird",
  width: 1024,
  height: 1024,
  ...over,
});

const editReq = (over: Partial<EditRequest> = {}): EditRequest => ({
  providerId: "openai",
  prompt: "make it blue",
  image: "data:image/png;base64,SRC",
  mode: "img2img",
  ...over,
});

/** Build a tiny white-on-black PNG (latteart's mask convention) as a data URL. */
function whiteOnBlackMask(pixels: number[][]): string {
  const height = pixels.length;
  const width = pixels[0]!.length;
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (width * y + x) * 4;
      const v = pixels[y]![x]! ? 255 : 0; // 1 → white (edit), 0 → black
      png.data[idx] = v;
      png.data[idx + 1] = v;
      png.data[idx + 2] = v;
      png.data[idx + 3] = 255; // opaque
    }
  }
  return `data:image/png;base64,${PNG.sync.write(png).toString("base64")}`;
}

describe("openai provider — txt2img", () => {
  it("posts to /v1/images/generations with a Bearer key and maps b64_json to a data URL", async () => {
    const { fetchImpl, calls } = openaiStub({
      created: 1,
      data: [{ b64_json: "QUJD" }],
      usage: { total_tokens: 10 },
    });
    const openai = createOpenAIProvider({ fetchImpl });
    const progress: number[] = [];

    const result = await openai.generate(
      genReq(),
      ctxWith((p) => progress.push(p)),
    );

    const call = calls[0]!;
    assert.equal(call.url, "https://api.openai.com/v1/images/generations");
    assert.equal(call.method, "POST");
    assert.equal(call.headers.Authorization, "Bearer test-key");
    const body = JSON.parse(String(call.body)) as Record<string, unknown>;
    assert.equal(body.model, "gpt-image-1");
    assert.equal(body.prompt, "a red bird");
    assert.equal(body.size, "1024x1024");
    assert.equal(body.n, 1);

    assert.equal(result.images[0]!.dataUrl, "data:image/png;base64,QUJD");
    assert.equal(result.provider, "openai");
    assert.equal(progress.at(-1), 100);
  });
});

describe("openai provider — img2img", () => {
  it("posts multipart to /v1/images/edits with the source image and prompt, no mask", async () => {
    const { fetchImpl, calls } = openaiStub({ data: [{ b64_json: "OUT" }] });
    const openai = createOpenAIProvider({ fetchImpl });
    assert.ok(openai.edit, "provider should implement edit()");

    const result = await openai.edit!(
      editReq({ prompt: "make it blue", width: 1536, height: 864 }),
      ctxWith(),
    );

    const call = calls[0]!;
    assert.equal(call.url, "https://api.openai.com/v1/images/edits");
    assert.equal(call.method, "POST");
    assert.equal(call.headers.Authorization, "Bearer test-key");
    const form = call.body as FormData;
    assert.ok(form instanceof FormData, "edit body should be multipart FormData");
    assert.equal(form.get("model"), "gpt-image-1");
    assert.equal(form.get("prompt"), "make it blue");
    assert.ok(form.get("image"), "the source image part should be present");
    assert.equal(form.get("mask"), null, "img2img should send no mask");
    // Edits preserve the source dimensions — no forced size (would resample).
    assert.equal(form.get("size"), null, "edits should not force a size");

    assert.equal(result.images[0]!.dataUrl, "data:image/png;base64,OUT");
    assert.equal(result.provider, "openai");
  });
});

describe("openai provider — inpaint", () => {
  it("converts the white-on-black mask into OpenAI's alpha mask (white → transparent = edit)", async () => {
    const { fetchImpl, calls } = openaiStub({ data: [{ b64_json: "OUT" }] });
    const openai = createOpenAIProvider({ fetchImpl });
    // 2x2: top-left white (edit), the rest black (preserve).
    const mask = whiteOnBlackMask([
      [1, 0],
      [0, 0],
    ]);

    await openai.edit!(editReq({ mode: "inpaint", mask }), ctxWith());

    const form = calls[0]!.body as FormData;
    const maskPart = form.get("mask");
    assert.ok(maskPart instanceof Blob, "inpaint should attach a mask part");
    const out = PNG.sync.read(Buffer.from(await (maskPart as Blob).arrayBuffer()));
    const alphaAt = (x: number, y: number) => out.data[(out.width * y + x) * 4 + 3];
    // white pixel → alpha 0 (edit here); black pixels → alpha 255 (preserve).
    assert.equal(alphaAt(0, 0), 0);
    assert.equal(alphaAt(1, 0), 255);
    assert.equal(alphaAt(0, 1), 255);
    assert.equal(alphaAt(1, 1), 255);
  });
});

describe("openai provider — outpaint", () => {
  it("attaches a mask for mode 'outpaint' and forces no size (keeps the expanded canvas)", async () => {
    const { fetchImpl, calls } = openaiStub({ data: [{ b64_json: "OUT" }] });
    const openai = createOpenAIProvider({ fetchImpl });
    // 2x2: everything white (fill the whole border) except a preserved corner.
    const mask = whiteOnBlackMask([
      [0, 1],
      [1, 1],
    ]);

    await openai.edit!(editReq({ mode: "outpaint", mask }), ctxWith());

    const form = calls[0]!.body as FormData;
    const maskPart = form.get("mask");
    assert.ok(maskPart instanceof Blob, "outpaint should attach a mask part");
    // Same masked-edit endpoint as inpaint; the source is the pre-expanded canvas
    // so no forced size (that would resample and break the expansion alignment).
    assert.equal(form.get("size"), null, "outpaint should not force a size");
    const out = PNG.sync.read(Buffer.from(await (maskPart as Blob).arrayBuffer()));
    const alphaAt = (x: number, y: number) => out.data[(out.width * y + x) * 4 + 3];
    // white → alpha 0 (fill here); black → alpha 255 (preserve).
    assert.equal(alphaAt(0, 0), 255);
    assert.equal(alphaAt(1, 0), 0);
  });
});

describe("openai provider — size mapping", () => {
  it("snaps requested dimensions to the nearest OpenAI size", async () => {
    const sizes: unknown[] = [];
    for (const [w, h] of [
      [1024, 1024],
      [1536, 864],
      [864, 1536],
    ]) {
      const { fetchImpl, calls } = openaiStub({ data: [{ b64_json: "AA" }] });
      const openai = createOpenAIProvider({ fetchImpl });
      await openai.generate(genReq({ width: w, height: h }), ctxWith());
      sizes.push((JSON.parse(String(calls[0]!.body)) as Record<string, unknown>).size);
    }
    assert.deepEqual(sizes, ["1024x1024", "1536x1024", "1024x1536"]);
  });
});

describe("openai provider — prompt & errors", () => {
  it("folds a negative prompt into the positive prompt", async () => {
    const { fetchImpl, calls } = openaiStub({ data: [{ b64_json: "AA" }] });
    const openai = createOpenAIProvider({ fetchImpl });
    await openai.generate(genReq({ negativePrompt: "blurry, text" }), ctxWith());
    const body = JSON.parse(String(calls[0]!.body)) as Record<string, unknown>;
    assert.match(String(body.prompt), /Avoid: blurry, text/);
  });

  it("rejects when no API key is set", async () => {
    const { fetchImpl } = openaiStub({});
    const openai = createOpenAIProvider({ fetchImpl });
    await assert.rejects(() => openai.generate(genReq(), {}), /API key/);
  });

  it("surfaces OpenAI's error message", async () => {
    const { fetchImpl } = openaiStub({ error: { message: "content policy violation" } }, 400);
    const openai = createOpenAIProvider({ fetchImpl });
    await assert.rejects(() => openai.generate(genReq(), ctxWith()), /content policy violation/);
  });

  it("rejects an edit source that isn't a data: URL", async () => {
    const { fetchImpl } = openaiStub({});
    const openai = createOpenAIProvider({ fetchImpl });
    await assert.rejects(
      () => openai.edit!(editReq({ image: "https://example.com/x.png" }), ctxWith()),
      /data: URL/,
    );
  });
});

/**
 * Custom styles v2 — native reference-image conditioning. gpt-image-1's
 * /images/generations has no image input, so a style-conditioned txt2img is
 * routed through /images/edits with the refs as the input images. These fixtures
 * pin the two contract facts the routing depends on: OpenAI's documented
 * multi-image field name (`image[]`, repeated, order-preserving) and "if there
 * are multiple images provided, the mask will be applied on the first image".
 */
const REF_A = "data:image/png;base64,QUFB";
const REF_B = "data:image/webp;base64,QkJC";

/**
 * Re-encode a base64 payload to its canonical form, so a fixture written as
 * "SRC" (3 chars = 2 bytes) compares equal to the "SRA=" that round-tripping
 * through bytes produces.
 */
const b64 = (payload: string) => Buffer.from(payload, "base64").toString("base64");

/** Read a text field off a multipart form (a file part reads as ""). */
const textField = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

/** Read the bytes of every image part, in the order they were appended. */
async function imageParts(form: FormData): Promise<string[]> {
  const parts = form.getAll("image[]").length ? form.getAll("image[]") : form.getAll("image");
  return Promise.all(
    parts.map(async (p) => Buffer.from(await (p as Blob).arrayBuffer()).toString("base64")),
  );
}

describe("openai provider — style refs (txt2img)", () => {
  it("detours to /images/edits with the refs as image[] and keeps an explicit size", async () => {
    const { fetchImpl, calls } = openaiStub({ data: [{ b64_json: "OUT" }] });
    const openai = createOpenAIProvider({ fetchImpl });

    await openai.generate(
      genReq({ width: 1536, height: 864, styleRefs: [REF_A, REF_B] }),
      ctxWith(),
    );

    const call = calls[0]!;
    assert.equal(
      call.url,
      "https://api.openai.com/v1/images/edits",
      "style-conditioned txt2img must use the edits endpoint (generations takes no image input)",
    );
    const form = call.body as FormData;
    assert.ok(form instanceof FormData);
    assert.deepEqual(
      await imageParts(form),
      [b64("QUFB"), b64("QkJC")],
      "refs ride along in order",
    );
    assert.equal(form.getAll("image[]").length, 2, "multiple images use the image[] field name");
    assert.equal(form.get("mask"), null, "a style-conditioned generation sends no mask");
    // Unlike a real edit, there's no source alignment to protect — pin the size
    // so the output follows the user's pick, not the reference's aspect ratio.
    assert.equal(form.get("size"), "1536x1024");
  });

  it("frames the refs as style-only, with plural agreement", async () => {
    const { fetchImpl, calls } = openaiStub({ data: [{ b64_json: "OUT" }] });
    const openai = createOpenAIProvider({ fetchImpl });

    await openai.generate(genReq({ styleRefs: [REF_A, REF_B] }), ctxWith());

    const prompt = textField(calls[0]!.body as FormData, "prompt");
    assert.match(prompt, /^a red bird/, "the user's prompt stays in front");
    assert.match(prompt, /The final 2 images are STYLE REFERENCES/);
    assert.match(prompt, /Do not copy the subject, objects, or composition of them/);
  });

  it("uses singular framing for a single ref", async () => {
    const { fetchImpl, calls } = openaiStub({ data: [{ b64_json: "OUT" }] });
    const openai = createOpenAIProvider({ fetchImpl });

    await openai.generate(genReq({ styleRefs: [REF_A] }), ctxWith());

    const form = calls[0]!.body as FormData;
    assert.match(textField(form, "prompt"), /The final image is a STYLE REFERENCE/);
    // A lone image keeps the plain `image` field, as in the single-image v1 path.
    assert.equal(form.getAll("image").length, 1);
    assert.equal(form.getAll("image[]").length, 0);
  });

  it("keeps the plain generations path when there are no usable refs", async () => {
    for (const styleRefs of [undefined, [], ["https://example.com/ref.png"]]) {
      const { fetchImpl, calls } = openaiStub({ data: [{ b64_json: "OUT" }] });
      const openai = createOpenAIProvider({ fetchImpl });

      await openai.generate(genReq({ styleRefs }), ctxWith());

      const call = calls[0]!;
      assert.equal(
        call.url,
        "https://api.openai.com/v1/images/generations",
        `no decodable refs (${JSON.stringify(styleRefs)}) should leave txt2img untouched`,
      );
      const body = JSON.parse(String(call.body)) as Record<string, unknown>;
      assert.equal(body.prompt, "a red bird", "no framing clause without refs");
    }
  });

  it("caps the input images at OpenAI's documented limit of 16", async () => {
    const { fetchImpl, calls } = openaiStub({ data: [{ b64_json: "OUT" }] });
    const openai = createOpenAIProvider({ fetchImpl });
    const many = Array.from({ length: 20 }, (_, i) => `data:image/png;base64,R${i}`);

    await openai.generate(genReq({ styleRefs: many }), ctxWith());

    const form = calls[0]!.body as FormData;
    assert.equal(form.getAll("image[]").length, 16);
    assert.match(
      textField(form, "prompt"),
      /The final 16 images are STYLE REFERENCES/,
      "the framing must count the refs actually sent, not the ones requested",
    );
  });
});

describe("openai provider — style refs (edit)", () => {
  it("appends refs after the source so the mask still lands on the source", async () => {
    const { fetchImpl, calls } = openaiStub({ data: [{ b64_json: "OUT" }] });
    const openai = createOpenAIProvider({ fetchImpl });
    const mask = whiteOnBlackMask([
      [1, 0],
      [0, 0],
    ]);

    await openai.edit!(editReq({ mode: "inpaint", mask, styleRefs: [REF_A] }), ctxWith());

    const form = calls[0]!.body as FormData;
    // OpenAI applies the mask to the FIRST image, so the source must lead.
    assert.deepEqual(await imageParts(form), [b64("SRC"), b64("QUFB")]);
    assert.ok(form.get("mask") instanceof Blob, "the inpaint mask survives the ref append");
    assert.match(textField(form, "prompt"), /The final image is a STYLE REFERENCE/);
  });

  it("reserves a slot for the source when capping refs", async () => {
    const { fetchImpl, calls } = openaiStub({ data: [{ b64_json: "OUT" }] });
    const openai = createOpenAIProvider({ fetchImpl });
    const many = Array.from({ length: 20 }, (_, i) => `data:image/png;base64,R${i}`);

    await openai.edit!(editReq({ styleRefs: many }), ctxWith());

    const form = calls[0]!.body as FormData;
    assert.equal(form.getAll("image[]").length, 16, "source + 15 refs, not 1 + 16");
    assert.match(textField(form, "prompt"), /The final 15 images are STYLE REFERENCES/);
  });

  it("leaves the edit untouched when no refs are present", async () => {
    const { fetchImpl, calls } = openaiStub({ data: [{ b64_json: "OUT" }] });
    const openai = createOpenAIProvider({ fetchImpl });

    await openai.edit!(editReq(), ctxWith());

    const form = calls[0]!.body as FormData;
    assert.equal(form.get("prompt"), "make it blue", "no framing clause without refs");
    assert.equal(form.getAll("image").length, 1);
    assert.equal(form.getAll("image[]").length, 0);
  });
});
