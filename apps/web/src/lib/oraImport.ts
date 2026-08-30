import { blendModeFromOra } from "@latteart/shared";
import { decodeImage } from "./raster";
import { unzip, type UnzippedEntry } from "./unzip";
import type { Layer } from "../stores/documentStore";

/**
 * OpenRaster (`.ora`) import — the reader half of `lib/ora`.
 *
 * The writer's contract runs in reverse: the first `<layer>` in `stack.xml` is
 * the topmost, latteart's array is bottom→top, so the parsed stack is reversed
 * on the way in. Each layer's PNG is placed 1:1 — `x`/`y` become the layer's
 * position and the PNG's own pixel size becomes its box — so a document
 * round-trips at the scale it was exported at, and a foreign document arrives
 * at its native resolution (the viewport is fitted afterwards, so size in
 * canvas units is cosmetic).
 *
 * What flattening a real editor's document costs, stated rather than hidden:
 * latteart has no layer groups, so nested `<stack>`s are flattened into the
 * layer list. Per the spec, a stack's `x`/`y` are ignored (deprecated in
 * 0.0.6), its `opacity` multiplies down onto its layers, and its `visibility`
 * combines the same way — a layer inside a hidden group imports hidden. A
 * group's own `composite-op` and `isolation` have no flattened equivalent and
 * are dropped; each layer keeps its own op. Rotation doesn't exist in the
 * format, and masks arrived baked into alpha, so both import as plain pixels.
 *
 * A referenced image that is missing or fails to decode **aborts the import,
 * naming the entry**. The export's skip-a-broken-layer stance doesn't transfer:
 * there the user still has the document, here silently opening nine of ten
 * layers is invisible data loss in the copy they may keep working in.
 *
 * Main thread on purpose, unlike the exporters: `DOMParser` doesn't exist in a
 * worker, and the heavy steps — inflate, image decode, base64 — are native and
 * async already. Nothing here holds the thread the way PNG *encoding* does.
 */

/** One `<layer>` as parsed from stack.xml, ancestors already folded in. */
interface ParsedLayer {
  name: string | undefined;
  src: string;
  x: number;
  y: number;
  opacity: number;
  visible: boolean;
  compositeOp: string | null;
}

function attr(el: Element, name: string): string | null {
  return el.getAttribute(name);
}

function numAttr(el: Element, name: string, fallback: number): number {
  const raw = attr(el, name);
  // Empty counts as absent: Number("") is 0, which would silently turn
  // opacity="" into an invisible layer instead of the spec default.
  if (raw === null || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function opacityAttr(el: Element): number {
  return Math.min(1, Math.max(0, numAttr(el, "opacity", 1)));
}

/** Spec: "visible" or "hidden", default visible. Unknown values read as
 * visible — showing a layer the writer mislabeled beats losing it. */
function visibleAttr(el: Element): boolean {
  return attr(el, "visibility") !== "hidden";
}

/** Depth-first over a `<stack>`, topmost-first (document order), folding the
 * ancestors' opacity (multiplied) and visibility (combined) into each layer. */
function walkStack(stack: Element, opacity: number, visible: boolean, out: ParsedLayer[]): void {
  for (let i = 0; i < stack.childNodes.length; i++) {
    const node = stack.childNodes[i];
    if (!node || node.nodeType !== 1) continue;
    const el = node as Element;
    if (el.tagName === "stack") {
      walkStack(el, opacity * opacityAttr(el), visible && visibleAttr(el), out);
    } else if (el.tagName === "layer") {
      const src = attr(el, "src");
      if (!src) throw new Error("stack.xml has a layer with no src");
      out.push({
        name: attr(el, "name") ?? undefined,
        src,
        x: Math.round(numAttr(el, "x", 0)),
        y: Math.round(numAttr(el, "y", 0)),
        opacity: opacity * opacityAttr(el),
        visible: visible && visibleAttr(el),
        compositeOp: attr(el, "composite-op"),
      });
    }
    // Anything else (<text>, vendor elements) has no layer equivalent — skipped.
  }
}

function parseStackXml(xml: string): ParsedLayer[] {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, "text/xml");
  } catch {
    throw new Error("stack.xml is not valid XML");
  }
  // A browser DOMParser reports failure as a document with a parsererror
  // element rather than by throwing (xmldom, under test, throws instead).
  if (doc.getElementsByTagName("parsererror").length > 0) {
    throw new Error("stack.xml is not valid XML");
  }
  const image = doc.documentElement;
  if (!image || image.tagName !== "image") throw new Error("stack.xml has no <image> root");

  // The root stack: the image's first <stack> child, per the spec exactly one.
  let root: Element | null = null;
  for (let i = 0; i < image.childNodes.length && !root; i++) {
    const node = image.childNodes[i];
    if (node && node.nodeType === 1 && (node as Element).tagName === "stack") {
      root = node as Element;
    }
  }
  if (!root) throw new Error("stack.xml has no root <stack>");

  const layers: ParsedLayer[] = [];
  walkStack(root, opacityAttr(root), visibleAttr(root), layers);
  return layers;
}

/** `src` paths as written vs. as stored: writers emit `./data/x.png` and
 * `data/x.png` for the same entry. */
function findEntry(entries: Map<string, UnzippedEntry>, src: string): UnzippedEntry | undefined {
  return entries.get(src) ?? entries.get(src.replace(/^\.\//, ""));
}

/** The MIME type the bytes actually are. The baseline spec requires PNG;
 * JPEG is accepted because decoding it costs nothing and rejecting it would
 * only lose a layer some out-of-spec writer stored. */
function sniffImageType(bytes: Uint8Array): string | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return null;
}

function toDataUrl(bytes: Uint8Array<ArrayBuffer>, type: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("could not read the image data"));
    reader.readAsDataURL(new Blob([bytes], { type }));
  });
}

/**
 * Parse an OpenRaster file into layers ready for `makeLayer`, bottom→top.
 *
 * Pure parsing — no store is touched, so a corrupt file fails here with
 * nothing to clean up. Throws with a message naming what's wrong: not an
 * OpenRaster file, unreadable stack.xml, or a specific layer image that is
 * missing, unsupported or undecodable.
 */
export async function importOra(bytes: Uint8Array<ArrayBuffer>): Promise<Partial<Layer>[]> {
  const entries = unzip(bytes);

  // The spec identifies the format by this entry. Its absence is tolerated —
  // stack.xml parsing below is the real test — but a *different* mimetype
  // means this zip is deliberately something else.
  const mimetype = entries.get("mimetype");
  if (mimetype) {
    const declared = new TextDecoder().decode(await mimetype.data()).trim();
    if (declared !== "image/openraster") {
      throw new Error(`not an OpenRaster file (mimetype says "${declared}")`);
    }
  }

  const stackEntry = entries.get("stack.xml");
  if (!stackEntry) throw new Error("not an OpenRaster file (no stack.xml)");
  const parsed = parseStackXml(new TextDecoder().decode(await stackEntry.data()));
  if (!parsed.length) throw new Error("the document contains no layers");

  const layers: Partial<Layer>[] = [];
  for (const p of parsed) {
    const entry = findEntry(entries, p.src);
    if (!entry) throw new Error(`the archive is missing a layer image: ${p.src}`);
    const data = await entry.data();
    const type = sniffImageType(data);
    if (!type) throw new Error(`a layer image is not a PNG or JPEG: ${p.src}`);
    const src = await toDataUrl(data, type);
    const decoded = await decodeImage(src);
    if (!decoded) throw new Error(`a layer image failed to decode: ${p.src}`);
    const { width, height } = decoded;
    decoded.close();

    layers.push({
      name: p.name,
      visible: p.visible,
      opacity: p.opacity,
      x: p.x,
      y: p.y,
      width,
      height,
      rotation: 0,
      blendMode: blendModeFromOra(p.compositeOp),
      mask: null,
      src,
      prompt: null,
      derivedFrom: null,
    });
  }

  // stack.xml lists the topmost layer first; the document store's array runs
  // bottom→top.
  return layers.reverse();
}
