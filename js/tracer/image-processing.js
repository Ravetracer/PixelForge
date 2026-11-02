import { C64_PALETTE_RGB } from '../constants.js';
import { hexToRgba } from '../color.js';
import { nearestC64Color } from '../c64/colors.js';
import { TR } from './tracer-state.js';

// ── Image enhancements ────────────────────────────────────────

export function applyEnhancements(pixels, w, h) {
  const { brightness: br, contrast: co, saturation: sa, vibrance: vi, invert: inv } = TR;
  if (br === 0 && co === 0 && sa === 0 && vi === 0 && !inv) return pixels;

  const out = new Uint8ClampedArray(pixels);
  const brightShift = br * 2.55;
  const contFactor  = co !== 0
    ? (259 * (co + 255)) / (255 * (259 - co))
    : 1;
  const satMul = 1 + sa / 100;

  for (let i = 0; i < w*h*4; i += 4) {
    let r = out[i], g = out[i+1], b = out[i+2];

    // Brightness
    if (br !== 0) { r += brightShift; g += brightShift; b += brightShift; }

    // Contrast
    if (co !== 0) {
      r = contFactor * (r - 128) + 128;
      g = contFactor * (g - 128) + 128;
      b = contFactor * (b - 128) + 128;
    }

    // Saturation
    if (sa !== 0) {
      const gray = 0.299*r + 0.587*g + 0.114*b;
      r = gray + (r - gray) * satMul;
      g = gray + (g - gray) * satMul;
      b = gray + (b - gray) * satMul;
    }

    // Vibrance — boosts saturation more on desaturated pixels
    if (vi !== 0) {
      const max = Math.max(r, g, b);
      const avg = (r + g + b) / 3;
      const satFactor = 1 - Math.abs(max - avg) * (2 / 255);
      const amt = (vi / 100) * satFactor;
      const gray = 0.299*r + 0.587*g + 0.114*b;
      r += (r - gray) * amt;
      g += (g - gray) * amt;
      b += (b - gray) * amt;
    }

    // Invert
    if (inv) { r = 255 - r; g = 255 - g; b = 255 - b; }

    out[i]   = Math.max(0, Math.min(255, r));
    out[i+1] = Math.max(0, Math.min(255, g));
    out[i+2] = Math.max(0, Math.min(255, b));
  }
  return out;
}

// ── C64 tile constraint pass ──────────────────────────────────

export function applyC64TileConstraints(pixels, w, h, bgHex) {
  const bgRgb = hexToRgba(bgHex);
  const bgIdx = nearestC64Color(bgRgb.r, bgRgb.g, bgRgb.b);
  const [bgR, bgG, bgB] = C64_PALETTE_RGB[bgIdx];

  const out = new Uint8ClampedArray(pixels.length);

  const tilesX = Math.ceil(w / 4);
  const tilesY = Math.ceil(h / 8);

  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      // Collect per-pixel C64 indices inside this tile, skip bg
      const freq = new Uint32Array(16);
      const pixIdx = new Uint8Array(4 * 8); // C64 idx per pixel slot

      let slot = 0;
      for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 4; col++) {
          const px = tx*4+col, py = ty*8+row;
          if (px >= w || py >= h) { pixIdx[slot++] = bgIdx; continue; }
          const p = (py*w+px)*4;
          const ci = nearestC64Color(pixels[p], pixels[p+1], pixels[p+2]);
          pixIdx[slot++] = ci;
          if (ci !== bgIdx) freq[ci]++;
        }
      }

      // Top 3 non-bg colours by frequency
      const sorted = [];
      for (let i = 0; i < 16; i++) if (i !== bgIdx && freq[i] > 0) sorted.push([i, freq[i]]);
      sorted.sort((a,b) => b[1]-a[1]);
      const allowed = new Set([bgIdx, ...(sorted.slice(0,3).map(e=>e[0]))]);
      const top3 = sorted.slice(0,3).map(e=>e[0]);

      // Remap pixels to allowed set
      slot = 0;
      for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 4; col++) {
          const px = tx*4+col, py = ty*8+row;
          if (px >= w || py >= h) { slot++; continue; }
          let ci = pixIdx[slot++];
          if (!allowed.has(ci)) {
            // find nearest allowed
            const [r,g,b] = C64_PALETTE_RGB[ci];
            let bestD = Infinity, bestC = bgIdx;
            for (const ac of allowed) {
              const [ar,ag,ab] = C64_PALETTE_RGB[ac];
              const d = 2*(r-ar)**2 + 4*(g-ag)**2 + 3*(b-ab)**2;
              if (d < bestD) { bestD = d; bestC = ac; }
            }
            ci = bestC;
          }
          const [nr,ng,nb] = C64_PALETTE_RGB[ci];
          const p = (py*w+px)*4;
          out[p]=nr; out[p+1]=ng; out[p+2]=nb; out[p+3]=255;
        }
      }
    }
  }

  // Fill background pixels (those mapped to bgIdx)
  for (let i = 0; i < w*h; i++) {
    const p = i*4;
    if (out[p]===0 && out[p+1]===0 && out[p+2]===0 && out[p+3]===0) {
      // was skipped (out-of-bounds tile) — fill bg
      out[p]=bgR; out[p+1]=bgG; out[p+2]=bgB; out[p+3]=255;
    }
  }
  return out;
}

// ── High-quality downscale via progressive halving ────────────

export function tracerDownscale(srcImg, cropX, cropY, cropW, cropH, dstW, dstH) {
  // First blit the cropped area onto a native-resolution canvas
  let cur = document.createElement('canvas');
  cur.width  = Math.round(cropW);
  cur.height = Math.round(cropH);
  const ctx = cur.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(srcImg, cropX, cropY, cropW, cropH, 0, 0, cur.width, cur.height);

  // Progressive halving until we're close to target
  while (cur.width / 2 >= dstW && cur.height / 2 >= dstH) {
    const next = document.createElement('canvas');
    next.width  = Math.max(dstW, Math.round(cur.width  / 2));
    next.height = Math.max(dstH, Math.round(cur.height / 2));
    const nc = next.getContext('2d');
    nc.imageSmoothingEnabled = true;
    nc.imageSmoothingQuality = 'high';
    nc.drawImage(cur, 0, 0, next.width, next.height);
    cur = next;
  }

  // Final resize to exact target
  const final = document.createElement('canvas');
  final.width = dstW; final.height = dstH;
  const fc = final.getContext('2d');
  fc.imageSmoothingEnabled = true;
  fc.imageSmoothingQuality = 'high';
  fc.drawImage(cur, 0, 0, dstW, dstH);
  return fc.getImageData(0, 0, dstW, dstH).data;
}
