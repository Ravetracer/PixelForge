import { TR } from './tracer-state.js';

// ── Dithering algorithms ──────────────────────────────────────

// ── Bayer matrices ────────────────────────────────────────────

export const BAYER2 = [0, 2, 3, 1];

export const BAYER4 = [
   0,  8,  2, 10,
  12,  4, 14,  6,
   3, 11,  1,  9,
  15,  7, 13,  5,
];

export const BAYER8 = [
   0, 32,  8, 40,  2, 34, 10, 42,
  48, 16, 56, 24, 50, 18, 58, 26,
  12, 44,  4, 36, 14, 46,  6, 38,
  60, 28, 52, 20, 62, 30, 54, 22,
   3, 35, 11, 43,  1, 33,  9, 41,
  51, 19, 59, 27, 49, 17, 57, 25,
  15, 47,  7, 39, 13, 45,  5, 37,
  63, 31, 55, 23, 61, 29, 53, 21,
];

// ── Error-diffusion kernels ───────────────────────────────────

export const KERNELS = {
  'floyd-steinberg': [
    {dx:1,dy:0,w:7/16},{dx:-1,dy:1,w:3/16},{dx:0,dy:1,w:5/16},{dx:1,dy:1,w:1/16},
  ],
  'stucki': [
    {dx:1,dy:0,w:8/42},{dx:2,dy:0,w:4/42},
    {dx:-2,dy:1,w:2/42},{dx:-1,dy:1,w:4/42},{dx:0,dy:1,w:8/42},{dx:1,dy:1,w:4/42},{dx:2,dy:1,w:2/42},
    {dx:-2,dy:2,w:1/42},{dx:-1,dy:2,w:2/42},{dx:0,dy:2,w:4/42},{dx:1,dy:2,w:2/42},{dx:2,dy:2,w:1/42},
  ],
  'jarvis': [
    {dx:1,dy:0,w:7/48},{dx:2,dy:0,w:5/48},
    {dx:-2,dy:1,w:3/48},{dx:-1,dy:1,w:5/48},{dx:0,dy:1,w:7/48},{dx:1,dy:1,w:5/48},{dx:2,dy:1,w:3/48},
    {dx:-2,dy:2,w:1/48},{dx:-1,dy:2,w:3/48},{dx:0,dy:2,w:5/48},{dx:1,dy:2,w:3/48},{dx:2,dy:2,w:1/48},
  ],
  'sierra': [
    {dx:1,dy:0,w:5/32},{dx:2,dy:0,w:3/32},
    {dx:-2,dy:1,w:2/32},{dx:-1,dy:1,w:4/32},{dx:0,dy:1,w:5/32},{dx:1,dy:1,w:4/32},{dx:2,dy:1,w:2/32},
    {dx:-1,dy:2,w:2/32},{dx:0,dy:2,w:3/32},{dx:1,dy:2,w:2/32},
  ],
  'sierra2': [
    {dx:1,dy:0,w:4/16},{dx:2,dy:0,w:3/16},
    {dx:-2,dy:1,w:1/16},{dx:-1,dy:1,w:2/16},{dx:0,dy:1,w:3/16},{dx:1,dy:1,w:2/16},{dx:2,dy:1,w:1/16},
  ],
  'atkinson': [
    {dx:1,dy:0,w:1/8},{dx:2,dy:0,w:1/8},
    {dx:-1,dy:1,w:1/8},{dx:0,dy:1,w:1/8},{dx:1,dy:1,w:1/8},
    {dx:0,dy:2,w:1/8},
  ],
};

// ── Nearest palette colour ────────────────────────────────────

function nearestInPalette(r, g, b, palRgb) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < palRgb.length; i++) {
    const [pr, pg, pb] = palRgb[i];
    const d = 2*(r-pr)**2 + 4*(g-pg)**2 + 3*(b-pb)**2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// ── Dithering dispatch ────────────────────────────────────────

export function applyDithering(pixels, w, h, palRgb) {
  const mode = TR.dithering;
  if (mode === 'none')          return quantizeToRgbPalette(pixels, w, h, palRgb);
  if (mode === 'checkerboard')  return checkerboardDither(pixels, w, h, palRgb);
  if (mode === 'bayer2')        return orderedDither(pixels, w, h, palRgb, BAYER2, 2, 4,   24);
  if (mode === 'bayer4')        return orderedDither(pixels, w, h, palRgb, BAYER4, 4, 16,  32);
  if (mode === 'bayer8')        return orderedDither(pixels, w, h, palRgb, BAYER8, 8, 64,  40);
  if (mode === 'bayer8a')       return adaptiveBayer8Dither(pixels, w, h, palRgb);
  const kernel = KERNELS[mode];
  if (kernel) return errorDiffusionDither(pixels, w, h, palRgb, kernel);
  return errorDiffusionDither(pixels, w, h, palRgb, KERNELS['floyd-steinberg']);
}

export function quantizeToRgbPalette(pixels, w, h, palRgb) {
  const out = new Uint8ClampedArray(pixels.length);
  for (let i = 0; i < w*h; i++) {
    const p = i*4;
    const idx = nearestInPalette(pixels[p], pixels[p+1], pixels[p+2], palRgb);
    const [r,g,b] = palRgb[idx];
    out[p]=r; out[p+1]=g; out[p+2]=b; out[p+3]=255;
  }
  return out;
}

export function checkerboardDither(pixels, w, h, palRgb) {
  const out = new Uint8ClampedArray(pixels.length);
  const shift = 22;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y*w+x)*4;
      const s = ((x + y) % 2 === 0) ? shift : -shift;
      const r = Math.max(0, Math.min(255, pixels[p]   + s));
      const g = Math.max(0, Math.min(255, pixels[p+1] + s));
      const b = Math.max(0, Math.min(255, pixels[p+2] + s));
      const idx = nearestInPalette(r, g, b, palRgb);
      const [nr,ng,nb] = palRgb[idx];
      out[p]=nr; out[p+1]=ng; out[p+2]=nb; out[p+3]=255;
    }
  }
  return out;
}

export function orderedDither(pixels, w, h, palRgb, matrix, size, matMax, strength) {
  const out = new Uint8ClampedArray(pixels.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y*w+x)*4;
      const t = matrix[(y % size) * size + (x % size)] / matMax - 0.5;
      const r = Math.max(0, Math.min(255, pixels[p]   + t * strength));
      const g = Math.max(0, Math.min(255, pixels[p+1] + t * strength));
      const b = Math.max(0, Math.min(255, pixels[p+2] + t * strength));
      const idx = nearestInPalette(r, g, b, palRgb);
      const [nr,ng,nb] = palRgb[idx];
      out[p]=nr; out[p+1]=ng; out[p+2]=nb; out[p+3]=255;
    }
  }
  return out;
}

export function adaptiveBayer8Dither(pixels, w, h, palRgb) {
  // Pre-compute per-pixel luminance for variance sampling
  const lum = new Float32Array(w*h);
  for (let i = 0; i < w*h; i++)
    lum[i] = 0.299*pixels[i*4] + 0.587*pixels[i*4+1] + 0.114*pixels[i*4+2];

  const out = new Uint8ClampedArray(pixels.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y*w+x)*4;
      // Local contrast in 5×5 window
      let minL = 255, maxL = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const v = lum[Math.max(0,Math.min(h-1,y+dy))*w + Math.max(0,Math.min(w-1,x+dx))];
          if (v < minL) minL = v;
          if (v > maxL) maxL = v;
        }
      }
      const contrast = (maxL - minL) / 255;
      const strength = 40 * (1 - contrast * 0.75);
      const t = BAYER8[(y%8)*8 + (x%8)] / 64 - 0.5;
      const r = Math.max(0, Math.min(255, pixels[p]   + t * strength));
      const g = Math.max(0, Math.min(255, pixels[p+1] + t * strength));
      const b = Math.max(0, Math.min(255, pixels[p+2] + t * strength));
      const idx = nearestInPalette(r, g, b, palRgb);
      const [nr,ng,nb] = palRgb[idx];
      out[p]=nr; out[p+1]=ng; out[p+2]=nb; out[p+3]=255;
    }
  }
  return out;
}

export function errorDiffusionDither(pixels, w, h, palRgb, kernel) {
  const buf = new Float32Array(w*h*3);
  for (let i = 0; i < w*h; i++) {
    buf[i*3]   = pixels[i*4];
    buf[i*3+1] = pixels[i*4+1];
    buf[i*3+2] = pixels[i*4+2];
  }
  const out = new Uint8ClampedArray(w*h*4);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y*w+x)*3;
      const oldR = Math.max(0, Math.min(255, buf[i]));
      const oldG = Math.max(0, Math.min(255, buf[i+1]));
      const oldB = Math.max(0, Math.min(255, buf[i+2]));
      const idx = nearestInPalette(oldR, oldG, oldB, palRgb);
      const [nr,ng,nb] = palRgb[idx];
      const p = (y*w+x)*4;
      out[p]=nr; out[p+1]=ng; out[p+2]=nb; out[p+3]=255;
      const er = oldR - nr, eg = oldG - ng, eb = oldB - nb;
      for (const {dx, dy, w: wt} of kernel) {
        const nx = x+dx, ny = y+dy;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        const j = (ny*w+nx)*3;
        buf[j]   += er * wt;
        buf[j+1] += eg * wt;
        buf[j+2] += eb * wt;
      }
    }
  }
  return out;
}
