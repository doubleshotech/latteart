import { PNG } from "pngjs";
import { noCapabilities } from "@latteart/shared";
import { withStyleRefInstruction } from "./styleRef.ts";
import type {
  EditRequest,
  GenResult,
  GenerateRequest,
  ImageProvider,
  ModelInfo,
  ProviderContext,
} from "@latteart/shared";

/**
 * OpenAI images (gpt-image-1) via BYOK. Like Gemini, this is a single
 * synchronous call per request — no queue — so progress is faked coarsely.
 * gpt-image-1 always returns base64 (`b64_json`, never a url), which drops
 * straight onto the canvas as a data URL.
 *
 * v1 covers text-to-image (`/images/generations`), whole-image edits, and
 * masked inpaint (both via `/images/edits`). v2 adds native style-reference
 * conditioning for custom styles: see `decodeStyleRefs` for the input budgeting
 * and the comments in `generate()`/`edit()` for why txt2img detours through the
 * edits endpoint and why masked edits opt out. See openai.test.ts — verified
 * against the documented contract via fixtures only, not live-smoked.
 */

const BASE = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-image-1";

/**
 * `/images/edits` accepts at most 16 input images, and the source image being
 * edited counts toward that budget. Extra style refs are dropped rather than
 * failing the whole request — a style conditioned on 15 of its 20 references is
 * still the style the user asked for.
 */
const MAX_INPUT_IMAGES = 16;

/** Sizes gpt-image-1 accepts, with their aspect ratios for nearest-match. */
const OPENAI_SIZES = [
  { size: "1024x1024", ratio: 1 },
  { size: "1536x1024", ratio: 1536 / 1024 },
  { size: "1024x1536", ratio: 1024 / 1536 },
];

/** Snap a requested pixel size to the closest size OpenAI supports. */
function nearestSize(width: number, height: number): string {
  if (!width || !height) return "1024x1024";
  const target = width / height;
  let best = OPENAI_SIZES[0]!;
  for (const s of OPENAI_SIZES) {
    if (Math.abs(s.ratio - target) < Math.abs(best.ratio - target)) best = s;
  }
  return best.size;
}

/**
 * gpt-image-1 has no negative-prompt field, so fold any negative into the
 * positive prompt as a soft "avoid" clause rather than dropping it.
 */
function foldNegative(prompt: string, negative?: string): string {
  const neg = negative?.trim();
  return neg ? `${prompt}\n\nAvoid: ${neg}` : prompt;
}

/** One decoded image on its way into a multipart part. */
interface DecodedImage {
  mime: string;
  bytes: Buffer;
}

/** Parse a `data:<mime>;base64,<data>` URL into its mime + raw bytes. */
function parseDataUrl(url: string): DecodedImage | null {
  const m = /^data:(.*?);base64,(.*)$/s.exec(url);
  if (!m) return null;
  return { mime: m[1] || "image/png", bytes: Buffer.from(m[2] ?? "", "base64") };
}

/** File extension for a raster mime, for the multipart part's filename. */
function extFor(mime: string): string {
  if (/jpe?g/.test(mime)) return "jpg";
  if (/webp/.test(mime)) return "webp";
  return "png";
}

/**
 * Append one decoded image to a multipart form under `field`.
 *
 * The Blob wraps a plain Uint8Array: a Node Buffer's type is
 * Buffer<ArrayBufferLike>, which the DOM lib's BlobPart (backed by a strict
 * ArrayBuffer) rejects.
 */
function appendImage(form: FormData, field: string, image: DecodedImage, filename: string): void {
  form.append(field, new Blob([new Uint8Array(image.bytes)], { type: image.mime }), filename);
}

/**
 * Decode a custom style's reference images, dropping any that aren't base64
 * `data:` URLs and trimming to the input-image budget left over after the
 * caller's own images (1 for an edit's source, 0 for a generation).
 */
function decodeStyleRefs(styleRefs: string[] | undefined, reservedSlots: number): DecodedImage[] {
  if (!styleRefs?.length) return [];
  return styleRefs
    .map(parseDataUrl)
    .filter((r): r is DecodedImage => r !== null)
    .slice(0, Math.max(0, MAX_INPUT_IMAGES - reservedSlots));
}

/**
 * Append `images` to the form as OpenAI's multi-image input.
 *
 * The field name is positional-array syntax (`image[]`, repeated once per file)
 * whenever there is more than one image — that's the form OpenAI's own curl
 * examples use, and it's what preserves order. A lone image keeps the plain
 * `image` field, matching the single-image path that shipped in v1.
 */
function appendImages(form: FormData, images: DecodedImage[]): void {
  if (images.length === 1) {
    const only = images[0]!;
    appendImage(form, "image", only, `image.${extFor(only.mime)}`);
    return;
  }
  images.forEach((img, i) => {
    appendImage(form, "image[]", img, `image-${i}.${extFor(img.mime)}`);
  });
}

/**
 * Build the multipart body for `/images/edits`, shared by the two callers that
 * use that endpoint: a real edit, and the style-conditioned generation that has
 * to detour through it. `size` is omitted for edits (see edit()) and set for the
 * detour (see generate()); `mask` is only ever present on a real masked edit.
 */
function editsForm(opts: {
  model: string;
  prompt: string;
  images: DecodedImage[];
  size?: string;
  mask?: Buffer;
}): FormData {
  const form = new FormData();
  form.append("model", opts.model);
  form.append("prompt", opts.prompt);
  form.append("n", "1");
  form.append("output_format", "png");
  if (opts.size) form.append("size", opts.size);
  appendImages(form, opts.images);
  if (opts.mask) appendImage(form, "mask", { mime: "image/png", bytes: opts.mask }, "mask.png");
  return form;
}

/** POST a prepared multipart body to `/images/edits`. */
async function postEdits(
  fetchImpl: typeof fetch,
  form: FormData,
  apiKey: string,
  signal: AbortSignal | undefined,
): Promise<Response> {
  return fetchImpl(`${BASE}/images/edits`, {
    method: "POST",
    // No content-type — FormData sets the multipart boundary itself.
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal,
  });
}

/**
 * Convert latteart's mask (an opaque white-on-black PNG where *white* = the
 * region to regenerate) into OpenAI's convention: a PNG whose *transparent*
 * pixels mark the region to edit. We set each pixel's alpha to the inverse of
 * its luminance (white → alpha 0 = edit, black → alpha 255 = preserve), keeping
 * the source's dimensions (which already match the image).
 */
function toOpenAIMask(maskDataUrl: string): Buffer {
  const parsed = parseDataUrl(maskDataUrl);
  if (!parsed) throw new Error("OpenAI inpaint expected a base64 data: URL for the mask");
  const png = PNG.sync.read(parsed.bytes);
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i + 3] = 255 - png.data[i]!; // alpha = 255 − red (luminance)
  }
  return PNG.sync.write(png);
}

/** Read a JSON error message off a failed OpenAI response, else a status fallback. */
async function openaiError(res: Response): Promise<Error> {
  let message = `OpenAI request failed (${res.status})`;
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    if (body.error?.message) message = body.error.message;
  } catch {
    /* keep the status-code message */
  }
  return new Error(message);
}

/** Pull the first image's base64 out of an OpenAI images response, or throw. */
async function readImageB64(res: Response): Promise<string> {
  if (!res.ok) throw await openaiError(res);
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new Error("OpenAI returned no image");
  }
  const b64 = (data as { data?: { b64_json?: string }[] })?.data?.[0]?.b64_json;
  if (typeof b64 !== "string" || !b64) throw new Error("OpenAI returned no image");
  return b64;
}

/** Injectable dependencies so tests can stub the HTTP boundary. */
export interface OpenAIOptions {
  /** HTTP client; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Build an OpenAI provider. Production uses the global fetch; tests inject a
 * stub.
 */
export function createOpenAIProvider(opts: OpenAIOptions = {}): ImageProvider {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const missingKey = () =>
    new Error("OpenAI needs an API key — create one at platform.openai.com/api-keys");

  return {
    id: "openai",
    label: "OpenAI",
    kind: "cloud",
    requiresKey: true,
    // styleRef: gpt-image-1 has no image input on /images/generations, so
    // txt2img conditions on a custom style's pixels by detouring through
    // /images/edits with the refs as input images (see generate()).
    capabilities: {
      ...noCapabilities(),
      txt2img: true,
      img2img: true,
      inpaint: true,
      outpaint: true,
      styleRef: true,
    },

    async listModels(): Promise<ModelInfo[]> {
      return [{ id: "gpt-image-1", label: "GPT Image 1" }];
    },

    async generate(
      req: GenerateRequest,
      ctx: ProviderContext,
      signal?: AbortSignal,
    ): Promise<GenResult> {
      if (!ctx.apiKey) throw missingKey();
      const model = req.model?.trim() || DEFAULT_MODEL;
      const prompt = foldNegative(req.prompt, req.negativePrompt);
      const size = nearestSize(req.width, req.height);
      // Custom styles v2: `/images/generations` takes no image input at all, so
      // a text-to-image *conditioned on reference pixels* has to detour through
      // `/images/edits` with the refs as the input images and no mask.
      //
      // Caveat worth naming: a maskless /images/edits is img2img (see edit()
      // below), so with a single ref this call is structurally an img2img *of
      // that reference*. Only the style-only framing clause pushes it toward
      // "paint a new scene in this style" — and that clause was tuned against
      // Gemini, not gpt-image-1. TODO(live-smoke): confirm the output follows
      // the prompt rather than redrawing the reference; if it doesn't, the fix
      // is a stronger prefix here, not a different endpoint (there isn't one).
      //
      // Unlike a real edit we DO pin `size`: there's no source whose alignment
      // we'd disturb, and omitting it would let the output follow the
      // reference's aspect instead of the size the user picked.
      const refs = decodeStyleRefs(req.styleRefs, 0);

      ctx.onProgress?.(15);
      let res: Response;
      if (refs.length > 0) {
        res = await postEdits(
          fetchImpl,
          editsForm({
            model,
            prompt: withStyleRefInstruction(prompt, refs.length),
            images: refs,
            size,
          }),
          ctx.apiKey,
          signal,
        );
      } else {
        res = await fetchImpl(`${BASE}/images/generations`, {
          method: "POST",
          headers: { Authorization: `Bearer ${ctx.apiKey}`, "content-type": "application/json" },
          body: JSON.stringify({ model, prompt, size, n: 1, output_format: "png" }),
          signal,
        });
      }
      const b64 = await readImageB64(res);

      ctx.onProgress?.(100);
      return {
        id: crypto.randomUUID(),
        images: [{ dataUrl: `data:image/png;base64,${b64}`, width: req.width, height: req.height }],
        provider: "openai",
        model,
        seed: req.seed,
        createdAt: Date.now(),
      };
    },

    async edit(req: EditRequest, ctx: ProviderContext, signal?: AbortSignal): Promise<GenResult> {
      if (!ctx.apiKey) throw missingKey();
      const model = req.model?.trim() || DEFAULT_MODEL;
      const source = parseDataUrl(req.image);
      if (!source) throw new Error("OpenAI edit expected a base64 data: URL for the source image");

      // /images/edits is multipart: the source image (+ an optional mask for
      // inpaint) plus the instruction. gpt-image-1 edits the whole image from
      // the prompt when there's no mask.
      //
      // Masked edit: only the transparent-in-the-mask region is regenerated.
      // Inpaint marks a painted region; outpaint marks the transparent padding
      // around a source placed on an expanded canvas — the same masked-fill call
      // to gpt-image-1, so both extend the image coherently. Without a mask,
      // gpt-image-1 edits the whole image (img2img).
      const masked = (req.mode === "inpaint" || req.mode === "outpaint") && !!req.mask;

      // Custom styles v2: style refs trail the source image, so the framing
      // clause's "the final N images" points at the refs and not at the thing
      // being edited.
      //
      // But NOT on a masked edit. Extra inputs are safe for mask *placement* —
      // OpenAI documents that with multiple images "the mask will be applied on
      // the first image" — yet that says nothing about how the omitted `size`
      // resolves under "auto" when the inputs disagree on dimensions. A ref that
      // shifted the output size would slide the preserved region out of
      // alignment with the layer's on-canvas box, which is the exact failure the
      // no-`size` rule below exists to prevent, and it can't be verified without
      // a key. A style applied to a masked fill is marginal; a misaligned
      // composite is not, so masked edits keep the text descriptor instead.
      const refs = masked ? [] : decodeStyleRefs(req.styleRefs, 1);

      ctx.onProgress?.(15);
      const res = await postEdits(
        fetchImpl,
        editsForm({
          model,
          prompt: withStyleRefInstruction(
            foldNegative(req.prompt, req.negativePrompt),
            refs.length,
          ),
          images: [source, ...refs],
          // No `size`: forcing one resamples the whole output and breaks inpaint's
          // "unmasked region stays put", so we let OpenAI default to "auto" (which
          // keeps a standard-sized source at its dimensions). Gemini's edit path
          // omits size for the same reason. TODO(live-smoke): confirm how "auto"
          // treats a non-standard source size — matters most for outpaint, whose
          // expanded canvas (source + padding) is usually not one of gpt-image-1's
          // three sizes; if "auto" resamples it, the preserved original would shift
          // out of alignment with the layer's on-canvas box. The offline mock is
          // unaffected (it honors any size), so outpaint verifies end-to-end there.
          mask: masked ? toOpenAIMask(req.mask!) : undefined,
        }),
        ctx.apiKey,
        signal,
      );
      const b64 = await readImageB64(res);

      ctx.onProgress?.(100);
      return {
        id: crypto.randomUUID(),
        images: [
          {
            dataUrl: `data:image/png;base64,${b64}`,
            width: req.width ?? 1024,
            height: req.height ?? 1024,
          },
        ],
        provider: "openai",
        model,
        seed: req.seed,
        createdAt: Date.now(),
      };
    },
  };
}

/** The registered OpenAI provider (production defaults). */
export const openaiProvider = createOpenAIProvider();
