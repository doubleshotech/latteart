import { Canvas, Image, loadImage } from "@napi-rs/canvas";
import type { SKRSContext2D } from "@napi-rs/canvas";

/**
 * A Node canvas environment for the DOM-touching `lib/` modules, backed by
 * `@napi-rs/canvas` (real Skia rasterization, real PNG codecs) so tests assert
 * on actual pixels — polarity, thresholds, luma weights — instead of recorded
 * call sequences.
 *
 * Two installers, matching the two environments `lib/raster` distinguishes:
 *
 * - {@link installWorkerCanvas} makes the process worker-shaped: an
 *   `OffscreenCanvas` and a `createImageBitmap`, **no** `document` and no
 *   `Image`. This is the environment `lib/export.worker` runs the compositors
 *   in, and the one PR #21 could only verify by driving the browser.
 * - {@link installDom} / {@link removeDom} add a minimal `document` (canvases
 *   only) and a DOM-flavored `Image`, for the main-thread-only helpers. Scope
 *   them with before/after: their mere presence flips every `makeRaster` call
 *   in the file onto the DOM branch.
 *
 * The `OffscreenCanvas` stub wraps a napi `Canvas` by **composition, not
 * inheritance**. A subclass would inherit `toDataURL`, and `lib/raster`
 * branches on `"toDataURL" in raster` — the tests would silently exercise the
 * main-thread paths and lose the ability to catch a DOM API leaking into
 * worker-reachable code, which is the exact bug class the seam exists for.
 * The cost is that napi's `drawImage` doesn't accept the wrapper, so the
 * context is proxied to unwrap stub arguments.
 */

const INNER = Symbol("napi canvas behind the OffscreenCanvas stub");

type AnyRecord = Record<string, unknown>;
const g = globalThis as AnyRecord;

function unwrapSource(source: unknown): unknown {
  return source instanceof OffscreenCanvasStub
    ? (source as unknown as { [INNER]: Canvas })[INNER]
    : source;
}

function proxyContext(ctx: SKRSContext2D): SKRSContext2D {
  return new Proxy(ctx, {
    get(target, prop) {
      if (prop === "drawImage") {
        return (source: unknown, ...rest: number[]) =>
          (target.drawImage as (...args: unknown[]) => void)(unwrapSource(source), ...rest);
      }
      const value = Reflect.get(target, prop) as unknown;
      return typeof value === "function" ? (value as () => void).bind(target) : value;
    },
    set(target, prop, value) {
      Reflect.set(target, prop, value);
      return true;
    },
  });
}

export class OffscreenCanvasStub {
  [INNER]: Canvas;

  constructor(width: number, height: number) {
    this[INNER] = new Canvas(width, height);
  }

  get width(): number {
    return this[INNER].width;
  }
  set width(value: number) {
    this[INNER].width = value;
  }
  get height(): number {
    return this[INNER].height;
  }
  set height(value: number) {
    this[INNER].height = value;
  }

  getContext(id: string, opts?: unknown): SKRSContext2D | null {
    if (id !== "2d") return null;
    return proxyContext(this[INNER].getContext("2d", opts as never));
  }

  convertToBlob(opts?: { type?: string }): Promise<Blob> {
    if (opts?.type && opts.type !== "image/png") {
      throw new Error(`the OffscreenCanvas stub only encodes PNG, got ${opts.type}`);
    }
    // Copied into a fresh Uint8Array: `BlobPart` wants a view over a plain
    // ArrayBuffer, which Node's Buffer type (ArrayBufferLike) doesn't satisfy.
    return Promise.resolve(
      new Blob([new Uint8Array(this[INNER].toBuffer("image/png"))], { type: "image/png" }),
    );
  }
}

/** Every bitmap the `createImageBitmap` stub has handed out, in creation
 * order, with whether `close()` was called — the observability the leak
 * assertions need. {@link resetBitmapLog} between tests that count. */
export const bitmapLog: { closed: boolean }[] = [];

export function resetBitmapLog(): void {
  bitmapLog.length = 0;
}

const POISON_BODY = "poison-bitmap";

/** A `data:` URL that decodes to a bitmap `drawImage` throws on — for driving
 * the compositors' throw paths. It reports a real size, so it passes every
 * decode-time check and fails only at draw time. */
export const POISON_SRC = `data:application/octet-stream;base64,${Buffer.from(POISON_BODY).toString("base64")}`;

async function createImageBitmapStub(blob: Blob): Promise<ImageBitmap> {
  const buf = Buffer.from(await blob.arrayBuffer());
  const record = { closed: false };
  if (buf.toString() === POISON_BODY) {
    bitmapLog.push(record);
    return {
      width: 4,
      height: 4,
      close: () => {
        record.closed = true;
      },
    } as unknown as ImageBitmap;
  }
  // Rejects on undecodable bytes, which is what makes `decodeImage` return null.
  const img = await loadImage(buf);
  bitmapLog.push(record);
  return Object.assign(img, {
    close: () => {
      record.closed = true;
    },
  }) as unknown as ImageBitmap;
}

/** `FileReader.readAsDataURL` only — what `pngDataUrl`'s worker branch needs. */
class FileReaderStub {
  result: string | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  readAsDataURL(blob: Blob): void {
    blob
      .arrayBuffer()
      .then((buf) => {
        this.result = `data:${blob.type};base64,${Buffer.from(buf).toString("base64")}`;
        this.onload?.();
      })
      .catch(() => this.onerror?.());
  }
}

/** Make this process worker-shaped: `OffscreenCanvas` + `createImageBitmap`
 * (+ `FileReader`, which workers have), and no `document`. Call once at the
 * top of a test file. */
export function installWorkerCanvas(): void {
  g.OffscreenCanvas = OffscreenCanvasStub;
  g.createImageBitmap = createImageBitmapStub;
  g.FileReader = FileReaderStub;
}

/**
 * Add the DOM surface the main-thread-only helpers use: a `document` that
 * makes (napi) canvases and a DOM-flavored `Image`. Scope with before/after —
 * see the module docblock. Callers that touch `lib/layerMask` should also
 * `clearMaskStencils()` when crossing environments: a stencil canvas cached
 * under one environment is not drawable by the other's contexts.
 */
export function installDom(): void {
  g.document = {
    createElement: (tag: string) => {
      if (tag !== "canvas") throw new Error(`the testenv document only makes canvases, got ${tag}`);
      return new Canvas(1, 1);
    },
  };
  g.Image = Image;
  // A browser main thread has these too — `decodeImage` runs on both sides.
  g.createImageBitmap = createImageBitmapStub;
  g.FileReader = FileReaderStub;
}

export function removeDom(): void {
  delete g.document;
  delete g.Image;
}

/** A PNG `data:` URL of a freshly painted canvas — the standard way tests
 * build layer sources and masks. */
export function pngUrl(
  width: number,
  height: number,
  paint?: (ctx: SKRSContext2D) => void,
): string {
  const canvas = new Canvas(width, height);
  paint?.(canvas.getContext("2d"));
  return canvas.toDataURL("image/png");
}

/** A PNG `data:` URL filled with one solid color. */
export function solidUrl(width: number, height: number, color: string): string {
  return pngUrl(width, height, (ctx) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, width, height);
  });
}

export interface DecodedPixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

function decodeNapi(src: string | Uint8Array): Promise<Image> {
  if (typeof src !== "string") return loadImage(Buffer.from(src));
  // Strings go through `Image` — napi's `loadImage` treats a string as a path
  // or http URL, while `Image#src` handles `data:` URLs.
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err ?? new Error("decode failed"));
    img.src = src;
  });
}

/** Decode PNG bytes or a `data:` URL into raw RGBA — how tests read what a
 * module actually produced. Uses napi's own decoder, an oracle independent of
 * everything under test. */
export async function pixelsOf(src: string | Uint8Array): Promise<DecodedPixels> {
  const img = await decodeNapi(src);
  const canvas = new Canvas(img.width, img.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const image = ctx.getImageData(0, 0, img.width, img.height);
  return { width: img.width, height: img.height, data: image.data };
}

/** Read raw RGBA straight off a canvas either environment produced. */
export function pixelsOfRaster(raster: unknown): DecodedPixels {
  const canvas = raster instanceof OffscreenCanvasStub ? raster[INNER] : (raster as Canvas);
  const ctx = canvas.getContext("2d");
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { width: canvas.width, height: canvas.height, data: image.data };
}

/** One pixel as `[r, g, b, a]`. */
export function px(p: DecodedPixels, x: number, y: number): [number, number, number, number] {
  const o = (y * p.width + x) * 4;
  return [p.data[o]!, p.data[o + 1]!, p.data[o + 2]!, p.data[o + 3]!];
}
