// node:test's describe()/it() are fire-and-forget by design (the runner awaits
// them), and the provider's methods are this-free closures, so neither the
// floating-promise nor the unbound-method rule applies in this test file.
/* eslint-disable @typescript-eslint/no-floating-promises, @typescript-eslint/unbound-method */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { EditRequest, GenerateRequest, ProviderContext } from "@latteart/shared";
import { mockProvider } from "./mock.ts";

/**
 * The mock provider is the offline stand-in that makes each feature verifiable
 * with no key. For custom styles v2 it can't diffuse, so it proves the reference
 * pixels reached the provider by pinning the first ref into the output as a
 * "style ref" swatch — these tests assert that swatch appears iff styleRefs are set.
 */

const ctx: ProviderContext = {};
const REF = "data:image/png;base64,Ymx1ZQ=="; // "blue"

const genReq = (over: Partial<GenerateRequest> = {}): GenerateRequest => ({
  providerId: "mock",
  prompt: "a cat",
  width: 512,
  height: 512,
  ...over,
});

function decodeSvg(dataUrl: string): string {
  const b64 = dataUrl.replace(/^data:image\/svg\+xml;base64,/, "");
  return Buffer.from(b64, "base64").toString("utf8");
}

describe("mock provider — native style-ref swatch", () => {
  it("pins the reference image into the output when styleRefs are present", async () => {
    const res = await mockProvider.generate(genReq({ styleRefs: [REF] }), ctx);
    const svg = decodeSvg(res.images[0]!.dataUrl);
    assert.match(svg, /<image href="data:image\/png;base64,Ymx1ZQ=="/);
    assert.match(svg, /style ref/);
  });

  it("emits no swatch (and no embedded image) without style refs", async () => {
    const res = await mockProvider.generate(genReq(), ctx);
    const svg = decodeSvg(res.images[0]!.dataUrl);
    assert.doesNotMatch(svg, /style ref/);
    assert.doesNotMatch(svg, /<image/);
  });

  it("pins the ref swatch on a masked (inpaint) edit too, not only generate", async () => {
    const px = "data:image/png;base64,QQ==";
    const editReq: EditRequest = {
      providerId: "mock",
      prompt: "a golden phoenix",
      image: px,
      mask: px,
      mode: "inpaint",
      styleRefs: [REF],
    };
    const res = await mockProvider.edit!(editReq, ctx);
    const svg = decodeSvg(res.images[0]!.dataUrl);
    assert.match(svg, /<image href="data:image\/png;base64,Ymx1ZQ=="/);
    assert.match(svg, /style ref/);
  });
});
