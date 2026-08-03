import { oraCompositeOp } from "@latteart/shared";
import { boundsOf } from "./bounds";
import { flattenLayers } from "./flatten";
import { loadImage, naturalSize } from "./loadImage";
import { loadMaskedLayer } from "./layerMask";
import { zip, type Bytes, type ZipEntry } from "./zip";
import type { Layer } from "../stores/documentStore";

/**
 * OpenRaster (`.ora`) export — the layer stack, portable.
 *
 * A PNG export is the picture; this is the *document*. An `.ora` opens in Krita,
 * GIMP, MyPaint, Drawpile and Scribus with every layer still separate, still
 * named, still carrying its opacity, visibility and blend mode — so latteart is
 * a step in a workflow rather than the end of one. It is a ZIP holding a
 * `stack.xml` plus one PNG per layer.
 *
 * Five things the format decides for us, none of them negotiable:
 *
 * 1. **`mimetype` is the first entry and is stored uncompressed.** A reader
 *    identifies the format by reading it at a fixed offset, so entry order is
 *    part of the file being valid. `lib/zip` writes entries in the order given.
 * 2. **The first `<layer>` is the topmost.** latteart's array is bottom→top, the
 *    order a compositor draws in, so the stack is written reversed.
 * 3. **There is no rotation attribute, and `x`/`y` are signed integers.** A
 *    layer's PNG is placed at its offset at its own pixel size — nothing scales
 *    or rotates it on the way in. So rotation and the layer's on-canvas size
 *    bake into the pixels here, and each layer is written as the axis-aligned
 *    hull of its rotated box. Negative offsets are legal, but the document
 *    "should be cropped to (0,0,w,h) when displaying" — so re-origining the
 *    stack onto its own bounding box is *required*, not tidiness: a canvas
 *    whose work sits off-origin would otherwise be cropped away by the reader.
 * 4. **There is no layer-mask concept.** A mask bakes into the layer's alpha,
 *    via the same `lib/layerMask` composite every other renderer uses — the
 *    exported layer is what the canvas shows.
 * 5. **`mergedimage.png` and `Thumbnails/thumbnail.png` are required**, the
 *    first at full document size for viewers that don't composite, the second
 *    at most 256×256 for file browsers.
 *
 * What deliberately survives as *live* data rather than baked pixels: opacity,
 * visibility and blend mode. Hidden layers are exported too, marked hidden —
 * losing them would make the export lossier than the project it came from,
 * which is the whole reason to write `.ora` instead of PNG.
 */

/** The spec version this writer targets. */
const ORA_VERSION = "0.0.6";

/** Longest edge of the exported document, in pixels. A guard on the memory a
 * single export can ask for, not a quality choice — {@link nativeScale} only
 * ever reaches it on a canvas holding several large layers spread far apart. */
const MAX_SIDE = 8192;

/** Ceiling on the supersample factor. Past a layer's own resolution there is no
 * more detail to recover, and this bounds the damage when a layer's box is tiny
 * relative to its pixels. */
const MAX_SCALE = 4;

/** Spec: the thumbnail is "at most 256x256 pixels". */
const THUMB_MAX = 256;

/**
 * An opacity as the spec's "simple floating-point number". Rounding first is
 * what keeps it simple: `String(1e-7)` is `"1e-7"`, which is a number JS can
 * read back and an ORA parser expecting plain decimals cannot.
 */
function opacityValue(opacity: number): string {
  return String(Number(opacity.toFixed(4)));
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** The pixel dimensions of a drawable. `loadMaskedLayer` hands back the image
 * itself when a layer has no mask and a canvas when it does, and the two spell
 * their size differently. */
function pixelSize(img: CanvasImageSource): { w: number; h: number } | null {
  if (img instanceof HTMLImageElement) return naturalSize(img);
  if (img instanceof HTMLCanvasElement) {
    return img.width && img.height ? { w: img.width, h: img.height } : null;
  }
  return null;
}

/**
 * How much to supersample the document so no layer is exported below its own
 * resolution.
 *
 * A layer's box is in canvas units, which are unrelated to how many pixels its
 * image actually has — a 1024² generation commonly sits in a 512-unit box. The
 * PNG export picks a fixed 2× for that reason; an `.ora` is handed to a real
 * editor, so the factor is *measured* from the layers instead: the largest
 * pixels-per-unit ratio in the document, which exports the most detailed layer
 * at exactly its native resolution and upsamples the rest to match.
 *
 * Both axes are measured, not just width: a layer whose box has been stretched
 * horizontally still has its full vertical detail to preserve, and taking the
 * width ratio alone would export it below its own resolution.
 */
function nativeScale(measured: { layer: Layer; size: { w: number; h: number } }[]): number {
  const ratio = Math.max(
    1,
    ...measured.flatMap(({ layer, size }) => [
      size.w / Math.max(1, layer.width),
      size.h / Math.max(1, layer.height),
    ]),
  );
  return Math.min(ratio, MAX_SCALE);
}

/** A canvas as PNG bytes. */
async function pngBytes(canvas: HTMLCanvasElement): Promise<Bytes> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("could not encode a PNG");
  return new Uint8Array(await blob.arrayBuffer());
}

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  return canvas;
}

/** A layer rendered into its own axis-aligned PNG, plus where that PNG sits in
 * the document. Opacity and blend mode are left out on purpose — they ride in
 * `stack.xml`, where an editor can still change them. */
async function renderLayer(
  layer: Layer,
  img: CanvasImageSource,
  scale: number,
  origin: { x: number; y: number },
): Promise<{ data: Bytes; x: number; y: number } | null> {
  const hull = boundsOf([layer]);
  if (!hull) return null;

  const canvas = makeCanvas(Math.round(hull.width * scale), Math.round(hull.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.scale(scale, scale);
  // Same transform order as every other compositor: to the layer's origin,
  // rotate about it, draw the box. The hull's own origin becomes (0,0) here,
  // since this PNG holds nothing but the one layer.
  ctx.translate(layer.x - hull.x, layer.y - hull.y);
  ctx.rotate((layer.rotation * Math.PI) / 180);
  ctx.drawImage(img, 0, 0, layer.width, layer.height);

  return {
    data: await pngBytes(canvas),
    x: Math.round((hull.x - origin.x) * scale),
    y: Math.round((hull.y - origin.y) * scale),
  };
}

/** The document flattened at full size, as PNG bytes. Every layer may be hidden
 * — the file still needs a merged image, so that case is a transparent one of
 * the right size rather than a missing entry. */
async function renderMerged(
  layers: Layer[],
  box: { x: number; y: number; width: number; height: number },
  scale: number,
  size: { width: number; height: number },
): Promise<{ data: Bytes; image: HTMLImageElement | null }> {
  const flat = await flattenLayers(layers, { box, pixelRatio: scale });
  if (!flat) return { data: await pngBytes(makeCanvas(size.width, size.height)), image: null };
  return {
    data: dataUrlBytes(flat.dataUrl),
    image: await loadImage(flat.dataUrl),
  };
}

/** The bytes behind a base64 `data:` URL. */
function dataUrlBytes(dataUrl: string): Bytes {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function stackXml(
  size: { width: number; height: number },
  entries: { layer: Layer; src: string; x: number; y: number }[],
): string {
  // Topmost first — the reverse of the array, which runs bottom→top.
  const lines = [...entries].reverse().map(({ layer, src, x, y }) => {
    const attrs = [
      `name="${escapeXml(layer.name)}"`,
      `src="${src}"`,
      `x="${x}"`,
      `y="${y}"`,
      `opacity="${opacityValue(layer.opacity)}"`,
      `visibility="${layer.visible ? "visible" : "hidden"}"`,
      `composite-op="${oraCompositeOp(layer.blendMode)}"`,
    ];
    return `    <layer ${attrs.join(" ")} />`;
  });

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<image version="${ORA_VERSION}" w="${size.width}" h="${size.height}">`,
    `  <stack>`,
    ...lines,
    `  </stack>`,
    `</image>`,
    ``,
  ].join("\n");
}

/**
 * Export the document as an OpenRaster file, or null when there is nothing to
 * export (no layer holds pixels yet).
 *
 * Layers whose image fails to decode are skipped rather than failing the export
 * — the same call every compositor here makes: a broken layer shouldn't cost
 * the user the other nine.
 */
export async function exportOra(layers: Layer[]): Promise<Blob | null> {
  const withPixels = layers.filter((l) => l.src);
  if (!withPixels.length) return null;

  // Masked through the shared composite, so an exported layer carries what the
  // canvas shows. Loaded up front: the draw loop must not await between layers.
  const images = await Promise.all(
    withPixels.map((l) => loadMaskedLayer(l.src!, l.mask).catch(() => null)),
  );
  const measured = withPixels.flatMap((layer, i) => {
    const img = images[i];
    const size = img ? pixelSize(img) : null;
    return img && size ? [{ layer, img, size }] : [];
  });
  if (!measured.length) return null;

  const box = boundsOf(measured.map((m) => m.layer));
  if (!box || !(box.width > 0) || !(box.height > 0)) return null;

  let scale = nativeScale(measured);
  const longest = Math.max(box.width, box.height) * scale;
  if (longest > MAX_SIDE) scale = MAX_SIDE / Math.max(box.width, box.height);

  const size = {
    width: Math.max(1, Math.round(box.width * scale)),
    height: Math.max(1, Math.round(box.height * scale)),
  };

  const files: ZipEntry[] = [];
  const stack: { layer: Layer; src: string; x: number; y: number }[] = [];
  for (const [i, { layer, img }] of measured.entries()) {
    const rendered = await renderLayer(layer, img, scale, box);
    if (!rendered) continue;
    const src = `data/layer${i}.png`;
    files.push({ name: src, data: rendered.data });
    stack.push({ layer, src, x: rendered.x, y: rendered.y });
  }
  if (!stack.length) return null;

  // Only the layers that made it into the stack, so a skipped layer can't
  // appear in the merged image without appearing as a layer.
  const exported = stack.map((s) => s.layer);
  const merged = await renderMerged(exported, box, scale, size);

  const thumbScale = Math.min(1, THUMB_MAX / Math.max(size.width, size.height));
  const thumb = makeCanvas(
    Math.round(size.width * thumbScale),
    Math.round(size.height * thumbScale),
  );
  const thumbCtx = thumb.getContext("2d");
  if (thumbCtx && merged.image) thumbCtx.drawImage(merged.image, 0, 0, thumb.width, thumb.height);

  return zip(
    [
      // First entry, stored — the spec identifies the format by it.
      { name: "mimetype", data: new TextEncoder().encode("image/openraster") },
      { name: "stack.xml", data: new TextEncoder().encode(stackXml(size, stack)) },
      ...files,
      { name: "mergedimage.png", data: merged.data },
      { name: "Thumbnails/thumbnail.png", data: await pngBytes(thumb) },
    ],
    "image/openraster",
  );
}
