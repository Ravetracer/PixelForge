import { C64_PALETTE_RGB, COLODORE_HEX } from '../constants.js';
import { hexToRgba } from '../color.js';

// ══════════════════════════════════════════════════════════════
//  C64 colour helpers (Colodore palette, hardware indices 0–15)
// ══════════════════════════════════════════════════════════════

/** Marker in index buffers for "background colour" / transparent pixels. */
export const BG = 16;

export function nearestC64Color(r, g, b) {
  let best = 0, bestDist = Infinity;
  for (let i = 0; i < C64_PALETTE_RGB.length; i++) {
    const [cr, cg, cb] = C64_PALETTE_RGB[i];
    const d = (r-cr)**2 + (g-cg)**2 + (b-cb)**2;
    if (d < bestDist) { bestDist = d; best = i; }
  }
  return best;
}

export function snapToC64Hex(hex) {
  const {r, g, b} = hexToRgba(hex);
  return COLODORE_HEX[nearestC64Color(r, g, b)];
}

export function c64IndexOfHex(hex) {
  const i = COLODORE_HEX.indexOf(hex.toLowerCase());
  return i >= 0 ? i : snapIndex(hex);
}

function snapIndex(hex) {
  const { r, g, b } = hexToRgba(hex);
  return nearestC64Color(r, g, b);
}

/** Squared RGB distance between two palette indices (used to remap overflowing colours). */
export function c64ColorDistance(a, b) {
  const [ar, ag, ab] = C64_PALETTE_RGB[a], [br, bg, bb] = C64_PALETTE_RGB[b];
  return (ar-br)**2 + (ag-bg)**2 + (ab-bb)**2;
}

/** Closest index from `allowed` (palette indices) to palette index `ci`. */
export function closestAllowed(ci, allowed) {
  let best = allowed[0], bestD = Infinity;
  for (const a of allowed) {
    const d = c64ColorDistance(ci, a);
    if (d < bestD) { bestD = d; best = a; }
  }
  return best;
}

/**
 * Convert RGBA pixels to palette indices. Transparent pixels and pixels in the
 * background colour become BG.
 */
export function pixelsToIndices(pixels, w, h, bgIdx) {
  const out = new Uint8Array(w * h);
  const cache = new Map();
  for (let p = 0, i = 0; p < w * h; p++, i += 4) {
    if (pixels[i + 3] < 10) { out[p] = BG; continue; }
    const key = (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2];
    let ci = cache.get(key);
    if (ci === undefined) { ci = nearestC64Color(pixels[i], pixels[i + 1], pixels[i + 2]); cache.set(key, ci); }
    out[p] = ci === bgIdx ? BG : ci;
  }
  return out;
}

/** Convert palette indices back to RGBA; BG becomes transparent (the bg layer shows through). */
export function indicesToPixels(indices, bgIdx) {
  const out = new Uint8ClampedArray(indices.length * 4);
  for (let p = 0; p < indices.length; p++) {
    const ci = indices[p];
    if (ci === BG || ci === bgIdx) continue;
    const [r, g, b] = C64_PALETTE_RGB[ci];
    const i = p * 4;
    out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = 255;
  }
  return out;
}
