import { S } from './state.js';
import { hexToRgba, rgbaToHex } from './color.js';
import { setPixel } from './pixels.js';

// ══════════════════════════════════════════════════════════════
//  Brushes: size/shape footprint, mirror symmetry, tile wrap,
//  and the per-pixel inks of the brush tools.
// ══════════════════════════════════════════════════════════════

export const BRUSH_TOOLS = new Set(['pencil', 'eraser', 'dither', 'shade']);
export const BRUSH_SIZE_MIN = 1;
export const BRUSH_SIZE_MAX = 8;

let _offsetsCache = null;   // { key, offsets }
let _stroke = null;         // per-stroke state, see beginStroke()

/** Offset of the footprint's top-left pixel relative to the cursor pixel. */
export function brushOrigin() {
  return -Math.floor((S.brushSize - 1) / 2);
}

/** Pixel offsets covered by the brush, relative to the cursor pixel. */
export function brushOffsets() {
  const size = S.brushSize, round = S.brushShape === 'round';
  const key = `${size}:${round}`;
  if (_offsetsCache?.key === key) return _offsetsCache.offsets;

  const offsets = [];
  const o = brushOrigin(), c = (size - 1) / 2;
  // Threshold chosen so 3 px gives a plus shape and larger sizes look round
  const r2 = (size / 2) ** 2 - 0.5;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      if (round && size > 2 && (i - c) ** 2 + (j - c) ** 2 > r2) continue;
      offsets.push([o + i, o + j]);
    }
  }
  _offsetsCache = { key, offsets };
  return offsets;
}

/** Whether the pixel-perfect algorithm applies to the current tool/brush. */
export function usesPixelPerfect() {
  return S.pixelPerfect && S.brushSize === 1 && (S.tool === 'pencil' || S.tool === 'eraser');
}

/**
 * All pixels a single point maps to: the point itself plus its mirror
 * images. In tile mode coordinates wrap around the canvas edges.
 */
export function symmetricPoints(x, y) {
  const W = S.width, H = S.height;
  if (S.tileMode) { x = ((x % W) + W) % W; y = ((y % H) + H) % H; }
  const pts = [[x, y]];
  if (S.mirrorX) pts.push([W - 1 - x, y]);
  if (S.mirrorY) pts.push([x, H - 1 - y]);
  if (S.mirrorX && S.mirrorY) pts.push([W - 1 - x, H - 1 - y]);
  return pts.length === 1 ? pts : pts.filter(([px, py], i) => pts.findIndex(([qx, qy]) => qx === px && qy === py) === i);
}

/** Wrap a shape generator so every point is mirrored (and wrapped in tile mode). */
export function* symmetricPixels(gen) {
  for (const { x, y } of gen)
    for (const [sx, sy] of symmetricPoints(x, y)) yield { x: sx, y: sy };
}

// ── Strokes ───────────────────────────────────────────────────

/** Call once on mouse-down before stamping; `button` 2 = right mouse button. */
export function beginStroke(button) {
  const primary = hexToRgba(S.primaryColor), secondary = hexToRgba(S.secondaryColor);
  _stroke = {
    right: button === 2,
    main: button === 2 ? secondary : primary,
    alt:  button === 2 ? primary : secondary,
    visited: new Uint8Array(S.width * S.height),
    palette: S.palette.map(h => h.toLowerCase()),
  };
}

export function endStroke() { _stroke = null; }

/** Apply the active brush tool with its full footprint at a cursor position. */
export function stampBrush(cx, cy) {
  if (!_stroke) return;
  for (const [ox, oy] of brushOffsets())
    for (const [x, y] of symmetricPoints(cx + ox, cy + oy)) plotInk(x, y);
}

function plotInk(x, y) {
  if (x < 0 || y < 0 || x >= S.width || y >= S.height) return;
  const st = _stroke;
  switch (S.tool) {
    case 'pencil': setPixel(x, y, st.main.r, st.main.g, st.main.b); break;
    case 'eraser': setPixel(x, y, 0, 0, 0, 0); break;
    case 'dither': {
      // Fixed checkerboard in image space, so overlapping strokes stay consistent
      const c = ((x + y) & 1) === 0 ? st.main : st.alt;
      setPixel(x, y, c.r, c.g, c.b);
      break;
    }
    case 'shade': shadePixel(x, y); break;
  }
}

/** Step a pixel's colour one swatch along the palette (left: forward, right: back), once per stroke. */
function shadePixel(x, y) {
  const st = _stroke, p = y * S.width + x;
  if (st.visited[p]) return;
  st.visited[p] = 1;
  const px = S.pixels, i = p * 4;
  if (px[i + 3] === 0) return;
  const idx = st.palette.indexOf(rgbaToHex(px[i], px[i + 1], px[i + 2]));
  if (idx < 0) return;
  const next = Math.max(0, Math.min(st.palette.length - 1, idx + (st.right ? -1 : 1)));
  if (next === idx) return;
  const c = hexToRgba(st.palette[next]);
  setPixel(x, y, c.r, c.g, c.b);
}
