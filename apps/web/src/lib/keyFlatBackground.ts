/** Load a data: URL into an HTMLImageElement, resolving null on failure. */
function load(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

const sq = (n: number) => n * n;

/** Mean RGB of an 8×8 patch anchored at (x0, y0). */
function patchMean(
  p: Uint8ClampedArray,
  w: number,
  x0: number,
  y0: number,
): [number, number, number] {
  let r = 0,
    g = 0,
    b = 0,
    n = 0;
  for (let y = y0; y < y0 + 8; y++) {
    for (let x = x0; x < x0 + 8; x++) {
      const o = (y * w + x) * 4;
      r += p[o]!;
      g += p[o + 1]!;
      b += p[o + 2]!;
      n++;
    }
  }
  return [r / n, g / n, b / n];
}

/** Median of four numbers (mean of the middle two). */
function median4(vals: number[]): number {
  const v = [...vals].sort((a, b) => a - b);
  return (v[1]! + v[2]!) / 2;
}

/**
 * Remove a flat, solid background locally by flooding in from the edges and
 * knocking out pixels near the border color. Built for the "Cutout" flow: the
 * subject is generated on a plain background, and diffusion img2img can't emit
 * an alpha channel, so this is how any provider actually gets transparency.
 *
 * Flooding from the border (rather than a global color match) preserves
 * interior regions that happen to match the background — a white tooth stays.
 * Returns a transparent PNG data URL, or null when there's no uniform
 * background to key (corners disagree, or nothing was removed), so a busy
 * scene is left untouched rather than mangled.
 */
export async function keyFlatBackground(dataUrl: string): Promise<string | null> {
  const img = await load(dataUrl);
  const W = img?.naturalWidth ?? 0;
  const H = img?.naturalHeight ?? 0;
  // Need room for the 8×8 corner patches; anything smaller isn't a keyable image.
  if (!img || W < 8 || H < 8) return null;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);
  const id = ctx.getImageData(0, 0, W, H);
  const p = id.data;

  // Background reference = median of the four corner patches. Require at least
  // three corners to agree: that's what tells a flat backdrop apart from a busy
  // scene (or a subject touching one edge, which pulls a single corner off).
  const corners: [number, number, number][] = [
    patchMean(p, W, 0, 0),
    patchMean(p, W, W - 8, 0),
    patchMean(p, W, 0, H - 8),
    patchMean(p, W, W - 8, H - 8),
  ];
  const ref = [0, 1, 2].map((k) => median4(corners.map((c) => c[k])));
  const AGREE2 = 60 * 60;
  const agreeing = corners.filter(
    (c) => sq(c[0] - ref[0]!) + sq(c[1] - ref[1]!) + sq(c[2] - ref[2]!) <= AGREE2,
  );
  if (agreeing.length < 3) return null;
  const br = agreeing.reduce((s, c) => s + c[0], 0) / agreeing.length;
  const bg = agreeing.reduce((s, c) => s + c[1], 0) / agreeing.length;
  const bb = agreeing.reduce((s, c) => s + c[2], 0) / agreeing.length;

  const TOL2 = 80 * 80;
  const vis = new Uint8Array(W * H);
  const stack: number[] = [];
  const seed = (x: number, y: number) => {
    const i = y * W + x;
    if (vis[i]) return;
    const o = i * 4;
    if (sq(p[o]! - br) + sq(p[o + 1]! - bg) + sq(p[o + 2]! - bb) <= TOL2) {
      vis[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < W; x++) {
    seed(x, 0);
    seed(x, H - 1);
  }
  for (let y = 0; y < H; y++) {
    seed(0, y);
    seed(W - 1, y);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % W;
    const y = (i / W) | 0;
    if (x > 0) seed(x - 1, y);
    if (x < W - 1) seed(x + 1, y);
    if (y > 0) seed(x, y - 1);
    if (y < H - 1) seed(x, y + 1);
  }

  let removed = 0;
  for (let i = 0; i < W * H; i++) {
    if (vis[i]) {
      p[i * 4 + 3] = 0;
      removed++;
    }
  }
  if (removed === 0) return null; // subject filled the frame — nothing to key

  ctx.putImageData(id, 0, 0);
  return canvas.toDataURL("image/png");
}
