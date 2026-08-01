import type { CSSProperties } from "react";

/** The two checker squares. Shared so the Konva pattern below and the CSS
 * backing used by DOM surfaces (the layer-mask editor's stage) read as the same
 * "this is transparent" cue rather than two near-miss greys. */
const LIGHT = "#e6e6e6";
const DARK = "#bcbcbc";
const CELL = 8;

/**
 * The same checkerboard as a CSS background, for DOM elements — Konva's
 * `fillPatternImage` can't be used outside the canvas.
 */
export const checkerBackground: CSSProperties = {
  backgroundImage: `conic-gradient(from 90deg at 50% 50%, ${LIGHT} 25%, ${DARK} 0 50%, ${LIGHT} 0 75%, ${DARK} 0)`,
  backgroundSize: `${CELL * 2}px ${CELL * 2}px`,
};

let cached: HTMLImageElement | null = null;

/**
 * A 2×2-cell checkerboard tile, built once and reused as a Konva
 * `fillPatternImage`. Konva forwards it straight to
 * `CanvasRenderingContext2D.createPattern`, which happily accepts a canvas —
 * the type just wants an <img>, so we present the canvas as one.
 */
export function checkerPattern(): HTMLImageElement {
  if (cached) return cached;
  const size = CELL * 2;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");
  if (ctx) {
    ctx.fillStyle = LIGHT;
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = DARK;
    ctx.fillRect(0, 0, CELL, CELL);
    ctx.fillRect(CELL, CELL, CELL, CELL);
  }
  cached = c as unknown as HTMLImageElement;
  return cached;
}
