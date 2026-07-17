// node:test's describe()/it() are fire-and-forget by design (the runner awaits
// them), and the provider's methods are this-free closures, so neither the
// floating-promise nor the unbound-method rule applies in this test file.
/* eslint-disable @typescript-eslint/no-floating-promises, @typescript-eslint/unbound-method */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { EditRequest, GenerateRequest, ProviderContext } from "@latteart/shared";
import { createFalProvider } from "./fal.ts";

/**
 * Fixture-based tests for the Fal provider. There is no live API call (no key
 * yet), so correctness rests on these fixtures matching Fal's documented queue
 * contract + FLUX schema. The seam under test is the provider's public
 * generate()/edit() methods; the one external boundary — HTTP `fetch` — is
 * injected as a stub that plays the queue lifecycle (submit → status → result).
 */

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** The submit response Fal returns; the provider must use these exact URLs. */
const SUBMITTED = {
  request_id: "req-1",
  status_url: "https://queue.fal.run/fal-ai/flux/requests/req-1/status",
  response_url: "https://queue.fal.run/fal-ai/flux/requests/req-1",
  cancel_url: "https://queue.fal.run/fal-ai/flux/requests/req-1/cancel",
};

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * A fetch stub that plays a queue run: one submit, an ordered list of status
 * responses (the last repeats if polled again), and one result body. Records
 * every call for assertions. `cancel` records PUTs and short-circuits.
 */
function falStub(script: {
  statuses: unknown[];
  result: unknown;
  /** Optional hosted asset served for a GET to a non-queue URL (CDN fallback). */
  asset?: { body: string; contentType: string };
  /** Invoked for every recorded call — lets a test abort mid-run, etc. */
  hook?: (call: RecordedCall) => void;
}) {
  const calls: RecordedCall[] = [];
  let statusIdx = 0;
  const impl = async (input: unknown, init: RequestInit = {}): Promise<Response> => {
    const url = String(input);
    const method = (init.method ?? "GET").toUpperCase();
    const headers = (init.headers ?? {}) as Record<string, string>;
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    const call = { url, method, headers, body };
    calls.push(call);
    script.hook?.(call);

    const path = url.split("?")[0]!;
    if (method === "PUT") return json({ status: "CANCELLATION_REQUESTED" }, 202);
    if (method === "POST" && !path.includes("/requests/")) return json(SUBMITTED);
    if (path.endsWith("/status")) {
      const s = script.statuses[Math.min(statusIdx, script.statuses.length - 1)];
      statusIdx += 1;
      return json(s);
    }
    if (path.includes("/requests/")) return json(script.result); // GET response_url
    // A hosted CDN asset fetch (result url was not a data: URI).
    return new Response(script.asset?.body ?? "", {
      status: 200,
      headers: { "content-type": script.asset?.contentType ?? "application/octet-stream" },
    });
  };
  return { fetchImpl: impl as unknown as typeof fetch, calls };
}

const ctxWith = (onProgress?: ProviderContext["onProgress"]): ProviderContext => ({
  apiKey: "test-key",
  onProgress,
});

const genReq = (over: Partial<GenerateRequest> = {}): GenerateRequest => ({
  providerId: "fal",
  prompt: "a red bird",
  width: 512,
  height: 384,
  ...over,
});

const editReq = (over: Partial<EditRequest> = {}): EditRequest => ({
  providerId: "fal",
  prompt: "make it blue",
  image: "data:image/png;base64,SRC",
  mode: "img2img",
  ...over,
});

describe("fal provider — txt2img", () => {
  it("submits to the model's queue endpoint with the FLUX schema and maps the result", async () => {
    const progress: number[] = [];
    const { fetchImpl, calls } = falStub({
      statuses: [{ status: "COMPLETED", response_url: SUBMITTED.response_url }],
      result: {
        images: [
          {
            url: "data:image/jpeg;base64,QUJD",
            width: 512,
            height: 384,
            content_type: "image/jpeg",
          },
        ],
        seed: 4242,
        has_nsfw_concepts: [false],
      },
    });
    const fal = createFalProvider({ fetchImpl, pollIntervalMs: 0 });

    const result = await fal.generate(
      genReq({ model: "fal-ai/flux/schnell", seed: 7 }),
      ctxWith((pct) => progress.push(pct)),
    );

    // Submit request: correct URL, method, auth header, and mapped input body.
    const submit = calls[0]!;
    assert.equal(submit.url, "https://queue.fal.run/fal-ai/flux/schnell");
    assert.equal(submit.method, "POST");
    assert.equal(submit.headers.Authorization, "Key test-key");
    assert.equal(submit.body && (submit.body as Record<string, unknown>).prompt, "a red bird");
    assert.deepEqual((submit.body as Record<string, unknown>).image_size, {
      width: 512,
      height: 384,
    });
    assert.equal((submit.body as Record<string, unknown>).sync_mode, true);
    assert.equal((submit.body as Record<string, unknown>).num_images, 1);
    assert.equal((submit.body as Record<string, unknown>).seed, 7);

    // Result mapping → GenResult with the image as a data URL.
    assert.equal(result.images.length, 1);
    assert.equal(result.images[0]!.dataUrl, "data:image/jpeg;base64,QUJD");
    assert.equal(result.images[0]!.width, 512);
    assert.equal(result.images[0]!.height, 384);
    assert.equal(result.provider, "fal");
    assert.equal(result.seed, 4242);

    // Progress ends at 100.
    assert.equal(progress.at(-1), 100);
  });

  it("folds a negative prompt into the positive prompt (FLUX has no negative field)", async () => {
    const { fetchImpl, calls } = falStub({
      statuses: [{ status: "COMPLETED" }],
      result: { images: [{ url: "data:image/png;base64,QQ==" }], seed: 1 },
    });
    const fal = createFalProvider({ fetchImpl, pollIntervalMs: 0 });

    await fal.generate(genReq({ negativePrompt: "blurry, text" }), ctxWith());

    const body = calls[0]!.body as Record<string, unknown>;
    assert.match(String(body.prompt), /a red bird/);
    assert.match(String(body.prompt), /Avoid:\s*blurry, text/);
    assert.equal("negative_prompt" in body, false);
  });
});

describe("fal provider — img2img", () => {
  it("routes edit() to the model's image-to-image endpoint with image_url + strength", async () => {
    const { fetchImpl, calls } = falStub({
      statuses: [{ status: "COMPLETED" }],
      result: {
        images: [{ url: "data:image/jpeg;base64,OUT", width: 768, height: 512 }],
        seed: 9,
      },
    });
    const fal = createFalProvider({ fetchImpl, pollIntervalMs: 0 });
    assert.ok(fal.edit, "provider should implement edit()");

    const result = await fal.edit!(
      editReq({ model: "fal-ai/flux/dev", strength: 0.35 }),
      ctxWith(),
    );

    const submit = calls[0]!;
    assert.equal(submit.url, "https://queue.fal.run/fal-ai/flux/dev/image-to-image");
    const body = submit.body as Record<string, unknown>;
    assert.equal(body.image_url, "data:image/png;base64,SRC");
    assert.equal(body.strength, 0.35);
    assert.equal(body.prompt, "make it blue");
    // img2img derives size from the source; no image_size is sent.
    assert.equal("image_size" in body, false);
    assert.equal(result.images[0]!.dataUrl, "data:image/jpeg;base64,OUT");
    assert.equal(result.provider, "fal");
  });

  it("falls back to the flux/dev i2i endpoint when the model has no image-to-image", async () => {
    const { fetchImpl, calls } = falStub({
      statuses: [{ status: "COMPLETED" }],
      result: { images: [{ url: "data:image/png;base64,OUT" }], seed: 1 },
    });
    const fal = createFalProvider({ fetchImpl, pollIntervalMs: 0 });

    await fal.edit!(editReq({ model: "fal-ai/flux/schnell", strength: 0.5 }), ctxWith());

    assert.equal(calls[0]!.url, "https://queue.fal.run/fal-ai/flux/dev/image-to-image");
  });
});

describe("fal provider — result handling", () => {
  it("fetches a hosted CDN url and encodes it as a data URL, without sending the API key", async () => {
    const { fetchImpl, calls } = falStub({
      statuses: [{ status: "COMPLETED" }],
      result: {
        images: [{ url: "https://v3.fal.media/files/out.png", width: 512, height: 512 }],
        seed: 3,
      },
      asset: { body: "PNGBYTES", contentType: "image/png" },
    });
    const fal = createFalProvider({ fetchImpl, pollIntervalMs: 0 });

    const result = await fal.generate(genReq(), ctxWith());

    const expected = `data:image/png;base64,${Buffer.from("PNGBYTES").toString("base64")}`;
    assert.equal(result.images[0]!.dataUrl, expected);

    // The asset fetch must NOT carry the fal API key (different host).
    const assetCall = calls.find((c) => c.url === "https://v3.fal.media/files/out.png");
    assert.ok(assetCall, "provider should fetch the hosted asset");
    assert.equal(assetCall!.headers.Authorization, undefined);
  });
});

describe("fal provider — progress", () => {
  it("reports non-decreasing phase-based progress across polls, ending at 100", async () => {
    const progress: number[] = [];
    const { fetchImpl } = falStub({
      statuses: [
        { status: "IN_QUEUE", queue_position: 2 },
        { status: "IN_PROGRESS" },
        { status: "IN_PROGRESS" },
        { status: "COMPLETED" },
      ],
      result: { images: [{ url: "data:image/png;base64,QQ==" }], seed: 1 },
    });
    const fal = createFalProvider({ fetchImpl, pollIntervalMs: 0 });

    await fal.generate(
      genReq(),
      ctxWith((p) => progress.push(p)),
    );

    assert.equal(progress[0], 5); // submitted
    assert.equal(progress.at(-1), 100); // done
    for (let i = 1; i < progress.length; i += 1) {
      assert.ok(progress[i]! >= progress[i - 1]!, `progress decreased: ${progress.join(",")}`);
    }
    // A ramp during IN_PROGRESS, not a single jump to 100.
    assert.ok(
      progress.some((p) => p > 10 && p < 100),
      `expected an intermediate running value: ${progress.join(",")}`,
    );
  });
});

describe("fal provider — cancel", () => {
  it("aborts mid-poll with an AbortError and best-effort PUTs the cancel_url", async () => {
    const ac = new AbortController();
    const { fetchImpl, calls } = falStub({
      statuses: [{ status: "IN_PROGRESS" }, { status: "COMPLETED" }],
      result: { images: [{ url: "data:image/png;base64,QQ==" }], seed: 1 },
      // Abort as soon as the first status poll is observed.
      hook: (call) => {
        if (call.url.includes("/status")) ac.abort();
      },
    });
    const fal = createFalProvider({ fetchImpl, pollIntervalMs: 5 });

    await assert.rejects(
      () => fal.generate(genReq(), ctxWith(), ac.signal),
      (err: Error) => err.name === "AbortError",
    );

    const cancel = calls.find((c) => c.method === "PUT");
    assert.ok(cancel, "provider should PUT the cancel_url on abort");
    assert.equal(cancel!.url, SUBMITTED.cancel_url);
  });
});

describe("fal provider — errors", () => {
  it("rejects with a clear message when no API key is set", async () => {
    const { fetchImpl } = falStub({ statuses: [], result: {} });
    const fal = createFalProvider({ fetchImpl, pollIntervalMs: 0 });
    await assert.rejects(() => fal.generate(genReq(), {}), /API key/);
  });

  it("surfaces Fal's error detail when submit fails", async () => {
    const fetchImpl = (async () =>
      json({ detail: "invalid prompt" }, 422)) as unknown as typeof fetch;
    const fal = createFalProvider({ fetchImpl, pollIntervalMs: 0 });
    await assert.rejects(() => fal.generate(genReq(), ctxWith()), /invalid prompt/);
  });

  it("throws on a terminal failure status instead of polling forever", async () => {
    const { fetchImpl } = falStub({
      statuses: [{ status: "IN_PROGRESS" }, { status: "FAILED" }],
      result: {},
    });
    const fal = createFalProvider({ fetchImpl, pollIntervalMs: 0 });
    await assert.rejects(() => fal.generate(genReq(), ctxWith()), /Fal run failed \(FAILED\)/);
  });

  it("rejects an img2img source that isn't a data: URL", async () => {
    const { fetchImpl } = falStub({ statuses: [], result: {} });
    const fal = createFalProvider({ fetchImpl, pollIntervalMs: 0 });
    await assert.rejects(
      () => fal.edit!(editReq({ image: "https://example.com/x.png" }), ctxWith()),
      /data: URL/,
    );
  });
});
