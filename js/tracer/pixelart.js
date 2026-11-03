// ══════════════════════════════════════════════════════════════
//  "Pixel art" tracing: turn a photo-like image into clean pixel
//  graphics that look hand-pixelled rather than downscaled.
//
//  1. edge-preserving smoothing (Kuwahara) on a work image at k× target size
//  2. edge detection (Sobel + non-maximum suppression) → thin edge map
//  3. per target pixel: majority vote of palette colours in its k×k block
//     (perceptual Lab distance) — flat areas, no muddy in-between colours
//  4. dark 1-px outlines where edges cross a block
//  5. cleanup: stray pixels, L-corners in outlines
// ══════════════════════════════════════════════════════════════

// ── perceptual colour matching (CIE Lab) ──────────────────────

function srgbToLinear(v) {
  v /= 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

export function rgbToLab(r, g, b) {
  const R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b);
  const f = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047);
  const y = f(R * 0.2126 + G * 0.7152 + B * 0.0722);
  const z = f((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/**
 * Nearest-palette lookup in LCh space, cached on a 5-bit-per-channel grid
 * (32768 entries) so millions of pixels stay fast.
 *
 * `huePriority` (0..1) shifts the weight from lightness to chroma/hue: plain
 * Lab distance maps a sandy orange to a grey of equal brightness, while a
 * pixel artist would keep the hue and pick the orange or light red.
 */
export function makePaletteMatcher(paletteRgb, huePriority = 0.6) {
  const labs = paletteRgb.map(([r, g, b]) => rgbToLab(r, g, b));
  const chroma = labs.map(([, a, b]) => Math.hypot(a, b));
  const kL = 1 - 0.65 * huePriority;      // lightness weight 1 … 0.35
  const kC = 1 + 1.5 * huePriority;       // chroma weight   1 … 2.5
  const cache = new Int16Array(32768).fill(-1);
  const nearestLab = (L, A, B) => {
    const C = Math.hypot(A, B);
    let best = 0, bestD = Infinity;
    for (let i = 0; i < labs.length; i++) {
      const [l, a, b] = labs[i];
      const dC = C - chroma[i];
      // ΔH² = Δa² + Δb² − ΔC²  (hue difference, independent of chroma)
      const dH2 = Math.max(0, (A - a) ** 2 + (B - b) ** 2 - dC * dC);
      const d = kL * (L - l) ** 2 + kC * dC * dC + dH2;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  };
  return {
    labs,
    nearest(r, g, b) {
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      let i = cache[key];
      if (i < 0) {
        const [L, A, B] = rgbToLab((r & 0xf8) | 4, (g & 0xf8) | 4, (b & 0xf8) | 4);
        i = cache[key] = nearestLab(L, A, B);
      }
      return i;
    },
    nearestLab,
  };
}

// ── 1. Kuwahara filter (edge-preserving smoothing) ────────────

/**
 * Kuwahara filter with radius r: each pixel takes the mean of the least
 * varying of its four (r+1)² quadrants. Integral images keep it O(n).
 */
export function kuwahara(px, w, h, r) {
  if (r < 1) return new Uint8ClampedArray(px);
  const W1 = w + 1;
  const sum = [new Float64Array(W1 * (h + 1)), new Float64Array(W1 * (h + 1)), new Float64Array(W1 * (h + 1))];
  const sumL = new Float64Array(W1 * (h + 1)), sumL2 = new Float64Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) {
    const rs = [0, 0, 0];
    let rl = 0, rl2 = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) rs[c] += px[i + c];
      const L = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      rl += L; rl2 += L * L;
      const o = (y + 1) * W1 + x + 1, up = y * W1 + x + 1;
      for (let c = 0; c < 3; c++) sum[c][o] = sum[c][up] + rs[c];
      sumL[o] = sumL[up] + rl; sumL2[o] = sumL2[up] + rl2;
    }
  }
  const rect = (arr, x0, y0, x1, y1) => arr[y1 * W1 + x1] - arr[y0 * W1 + x1] - arr[y1 * W1 + x0] + arr[y0 * W1 + x0];
  const out = new Uint8ClampedArray(px.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let bestVar = Infinity, best = null;
      for (const [qx0, qy0] of [[x - r, y - r], [x, y - r], [x - r, y], [x, y]]) {
        const x0 = Math.max(0, qx0), y0 = Math.max(0, qy0);
        const x1 = Math.min(w, qx0 + r + 1), y1 = Math.min(h, qy0 + r + 1);
        const n = (x1 - x0) * (y1 - y0);
        if (n <= 0) continue;
        const mean = rect(sumL, x0, y0, x1, y1) / n;
        const variance = rect(sumL2, x0, y0, x1, y1) / n - mean * mean;
        if (variance < bestVar) { bestVar = variance; best = [x0, y0, x1, y1, n]; }
      }
      const [x0, y0, x1, y1, n] = best;
      const o = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) out[o + c] = rect(sum[c], x0, y0, x1, y1) / n;
      out[o + 3] = 255;
    }
  }
  return out;
}

// ── 2. edges: Sobel + non-maximum suppression ─────────────────

/**
 * Thin edge map (1 = edge). `share` (0..1) is the fraction of pixels with the
 * strongest gradients that count as edge candidates — a percentile, so a few
 * very bright highlights do not suppress the outlines of the main subject.
 */
export function detectEdges(px, w, h, share, minStep = 24) {
  const L = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) L[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
  const mag = new Float32Array(w * h), dir = new Uint8Array(w * h);
  let max = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = -L[i - w - 1] - 2 * L[i - 1] - L[i + w - 1] + L[i - w + 1] + 2 * L[i + 1] + L[i + w + 1];
      const gy = -L[i - w - 1] - 2 * L[i - w] - L[i - w + 1] + L[i + w - 1] + 2 * L[i + w] + L[i + w + 1];
      const m = Math.hypot(gx, gy);
      mag[i] = m;
      if (m > max) max = m;
      // quantised gradient direction: 0 = horizontal, 1 = 45°, 2 = vertical, 3 = 135°
      const a = ((Math.atan2(gy, gx) * 180 / Math.PI) + 180) % 180;
      dir[i] = a < 22.5 || a >= 157.5 ? 0 : a < 67.5 ? 1 : a < 112.5 ? 2 : 3;
    }
  }
  const edges = new Uint8Array(w * h);
  // gradient magnitude at the (1 - share) percentile, via a 256-bin histogram
  const hist = new Uint32Array(256);
  for (let i = 0; i < w * h; i++) hist[Math.min(255, Math.floor(mag[i] / (max || 1) * 255))]++;
  let acc = 0, bin = 255;
  const wanted = share * w * h;
  while (bin > 0 && acc + hist[bin] < wanted) acc += hist[bin--];
  // …but never below a real brightness step (Sobel ≈ 4 × luminance step):
  // soft light rays and painterly texture are not object outlines
  const t = Math.max(4 * minStep, (bin / 255) * max);
  const step = [[1, 0], [1, 1], [0, 1], [-1, 1]];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const m = mag[i];
      if (m < t) continue;
      const [dx, dy] = step[dir[i]];
      if (m >= mag[i + dy * w + dx] && m >= mag[i - dy * w - dx]) edges[i] = 1;
    }
  }
  return edges;
}

// ── 3. majority downscale ─────────────────────────────────────

/**
 * Downscale a work image (w·k × h·k) to w×h palette indices: each target
 * pixel gets the palette colour most of its block votes for, weighted to
 * the block centre. Also returns the block's darkest frequent colour for outlines.
 */
export function majorityDownscale(work, k, w, h, matcher) {
  const ww = w * k;
  const out = new Uint8Array(w * h);
  const dark = new Uint8Array(w * h);
  const n = matcher.labs.length;
  const votes = new Float32Array(n);
  const weightAt = new Float32Array(k * k);
  const c = (k - 1) / 2;
  for (let j = 0; j < k; j++) for (let i = 0; i < k; i++)
    weightAt[j * k + i] = 1 + 0.5 * (1 - Math.max(Math.abs(i - c), Math.abs(j - c)) / (c || 1));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      votes.fill(0);
      for (let j = 0; j < k; j++) {
        for (let i = 0; i < k; i++) {
          const p = ((y * k + j) * ww + x * k + i) * 4;
          votes[matcher.nearest(work[p], work[p + 1], work[p + 2])] += weightAt[j * k + i];
        }
      }
      let best = 0, total = 0;
      for (let v = 0; v < n; v++) { total += votes[v]; if (votes[v] > votes[best]) best = v; }
      out[y * w + x] = best;
      // darkest colour holding a real share of the block (the "outside" of an edge)
      let darkest = best;
      for (let v = 0; v < n; v++)
        if (votes[v] >= total * 0.2 && matcher.labs[v][0] < matcher.labs[darkest][0]) darkest = v;
      dark[y * w + x] = darkest;
    }
  }
  return { indices: out, dark };
}

// ── 4. outlines ───────────────────────────────────────────────

/**
 * Target pixels crossed by an edge in the work image get a dark outline
 * colour: the block's darker side, darkened further towards the palette's
 * shadow tones. `shadeOf(index)` returns the outline colour index.
 */
export function applyOutlines(indices, dark, edges, k, w, h, matcher, shadeOf) {
  const ww = w * k;
  const outlined = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let count = 0;
      for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) count += edges[(y * k + j) * ww + x * k + i];
      if (count < Math.max(1, k * 0.6)) continue;
      const p = y * w + x;
      const shade = shadeOf(dark[p]);
      if (matcher.labs[shade][0] < matcher.labs[indices[p]][0] - 4) {
        indices[p] = shade;
        outlined[p] = 1;
      }
    }
  }
  return outlined;
}

// ── 5. cleanup ────────────────────────────────────────────────

/** Drop outline fragments shorter than `minLen` pixels (8-connected) — texture, not contours. */
export function pruneShortOutlines(indices, outlined, w, h, restore, minLen = 3) {
  const seen = new Uint8Array(w * h);
  for (let start = 0; start < w * h; start++) {
    if (!outlined[start] || seen[start]) continue;
    const comp = [start], stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const p = stack.pop(), x = p % w, y = (p / w) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (outlined[q] && !seen[q]) { seen[q] = 1; stack.push(q); comp.push(q); }
      }
    }
    if (comp.length < minLen) for (const p of comp) { outlined[p] = 0; indices[p] = restore[p]; }
  }
}

/** Remove L-corners in 1-px outlines so diagonals stay one pixel wide. */
export function cleanOutlineCorners(indices, outlined, w, h, restore) {
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      if (!outlined[p]) continue;
      const hN = outlined[p - 1] + outlined[p + 1], vN = outlined[p - w] + outlined[p + w];
      if (hN !== 1 || vN !== 1) continue;
      const hx = outlined[p - 1] ? -1 : 1, vy = outlined[p - w] ? -1 : 1;
      // the two neighbours touch diagonally → this pixel is a redundant corner
      if (!outlined[p + vy * w + hx]) {
        outlined[p] = 0;
        indices[p] = restore[p];
      }
    }
  }
}

/** Replace isolated pixels (no 4-neighbour shares their colour) by the dominant neighbour colour. */
export function removeStrayPixels(indices, w, h, protect) {
  const src = new Uint8Array(indices);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      if (protect?.[p]) continue;
      const c = src[p];
      if (src[p - 1] === c || src[p + 1] === c || src[p - w] === c || src[p + w] === c) continue;
      const count = new Map();
      for (const q of [p - w - 1, p - w, p - w + 1, p - 1, p + 1, p + w - 1, p + w, p + w + 1])
        count.set(src[q], (count.get(src[q]) ?? 0) + 1);
      const [best, n] = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
      if (n >= 4) indices[p] = best;
    }
  }
}

// ── checkerboard mix colours ──────────────────────────────────

/**
 * Extend a palette with 50 % mixes of colour pairs that are close in
 * lightness. A mix is drawn as a 2-colour checkerboard — the controlled
 * pattern dithering C64 pixel artists use for in-between tones.
 * Returns entries { rgb, a, b } (a === b for plain palette colours).
 */
export function buildMixPalette(paletteRgb, maxDeltaL = 28) {
  const labs = paletteRgb.map(([r, g, b]) => rgbToLab(r, g, b));
  const entries = paletteRgb.map((rgb, i) => ({ rgb, a: i, b: i }));
  for (let a = 0; a < paletteRgb.length; a++) {
    for (let b = a + 1; b < paletteRgb.length; b++) {
      if (Math.abs(labs[a][0] - labs[b][0]) > maxDeltaL) continue;
      const [r1, g1, b1] = paletteRgb[a], [r2, g2, b2] = paletteRgb[b];
      entries.push({ rgb: [(r1 + r2) >> 1, (g1 + g2) >> 1, (b1 + b2) >> 1], a, b });
    }
  }
  return entries;
}

// ── auto palette: median cut ──────────────────────────────────

/** Median-cut palette of `n` colours from RGBA pixels (sampled). */
export function medianCut(px, n) {
  const step = Math.max(1, Math.floor(px.length / 4 / 60000));
  const pts = [];
  for (let i = 0; i < px.length; i += 4 * step) pts.push([px[i], px[i + 1], px[i + 2]]);
  let boxes = [pts];
  while (boxes.length < n) {
    let bi = -1, bestRange = -1, bestCh = 0;
    boxes.forEach((b, i) => {
      if (b.length < 2) return;
      for (let ch = 0; ch < 3; ch++) {
        let lo = 255, hi = 0;
        for (const p of b) { if (p[ch] < lo) lo = p[ch]; if (p[ch] > hi) hi = p[ch]; }
        if (hi - lo > bestRange) { bestRange = hi - lo; bi = i; bestCh = ch; }
      }
    });
    if (bi < 0 || bestRange <= 0) break;
    const b = boxes[bi].sort((p, q) => p[bestCh] - q[bestCh]);
    const mid = b.length >> 1;
    boxes.splice(bi, 1, b.slice(0, mid), b.slice(mid));
  }
  return boxes.filter(b => b.length).map(b => {
    const s = [0, 0, 0];
    for (const p of b) { s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; }
    return s.map(v => Math.round(v / b.length));
  });
}

// ── Interlace: two frames shown alternately ───────────────────
//    The eye sees the average of both frames, but colours of different
//    lightness flicker at 25 Hz. Pairs are limited by their lightness gap.

const lightness = paletteRgb => paletteRgb.map(([r, g, b]) => rgbToLab(r, g, b)[0]);

/** Palette index pairs [a, b] (a ≤ b) whose lightness differs by at most `maxGap` (Lab L). */
export function flickerPairs(paletteRgb, maxGap) {
  const L = lightness(paletteRgb), pairs = [];
  for (let a = 0; a < L.length; a++)
    for (let b = a; b < L.length; b++) if (Math.abs(L[a] - L[b]) <= maxGap) pairs.push([a, b]);
  return pairs;
}

const FLICKER_WEIGHT = 0.02;   // per L²: among equal mixes, prefer frames of similar lightness
const FLICKER_EXCESS = 1;      // per L² beyond the limit: only worth it at hard edges, never in areas
const ROW_COHERENCE  = 50;     // cost of a frame colour differing from the row above
const FRAME_ORDER    = 20;     // cost of frame 1 showing the lighter colour: keeps the frames' roles fixed

/**
 * IFLI: hires pixel x shows avg(frame1[x>>1], frame2[(x-1)>>1]); hires pixel 0
 * shows frame 1 over the background. Per row, a DP over frame-2 colours picks
 * both frames so the mix matches `target` (RGBA, w2 wide) while
 * - hires pixels mixing colours more than `maxGap` apart in lightness are
 *   avoided (a hard edge may still flicker on one pixel, as on a real C64),
 * - frame 1 takes the darker colour of each pair and each frame keeps the
 *   colours of the row above where the target allows it (no stripes),
 * - optional `allowed` bitmasks ([frame1, frame2], one per line and 4-pixel
 *   column) restrict the colours, e.g. to what the FLI encoder can show.
 * Returns two (w2/2)-wide index buffers.
 */
export function splitInterlaced(targetRgb, w2, h, paletteRgb, { maxGap = 100, bg = 0, allowed = null } = {}) {
  const n = paletteRgb.length, w = w2 >> 1, cols = w >> 2;
  const L = lightness(paletteRgb);
  const mixLab = [], pairCost = new Float64Array(n * n);
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
    const [r1, g1, b1] = paletteRgb[a], [r2, g2, b2] = paletteRgb[b];
    mixLab.push(rgbToLab((r1 + r2) >> 1, (g1 + g2) >> 1, (b1 + b2) >> 1));
    const gap = Math.abs(L[a] - L[b]);
    pairCost[a * n + b] = FLICKER_WEIGHT * gap * gap + (gap > maxGap ? FLICKER_EXCESS * (gap - maxGap) ** 2 : 0)
      + (L[a] > L[b] ? FRAME_ORDER : 0);
  }
  const f1 = new Uint8Array(w * h), f2 = new Uint8Array(w * h);
  const tLab = new Float32Array(w2 * 3);
  const cost = (x, a, b) => {
    const m = mixLab[a * n + b];
    return pairCost[a * n + b] + (tLab[x * 3] - m[0]) ** 2 + (tLab[x * 3 + 1] - m[1]) ** 2 + (tLab[x * 3 + 2] - m[2]) ** 2;
  };
  // per-pixel cost of using colour c in a frame: forbidden by the mask, or a change against the row above
  const unary = (out, frame, mask, y, i) => {
    for (let c = 0; c < n; c++) {
      if (mask && !(mask[y * cols + (i >> 2)] & (1 << c))) out[c] = Infinity;
      else out[c] = y > 0 && frame[(y - 1) * w + i] !== c ? ROW_COHERENCE : 0;
    }
  };
  const u1 = new Float64Array(n), u2 = new Float64Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w2; x++) {
      const i = (y * w2 + x) * 4;
      const [Lt, At, Bt] = rgbToLab(targetRgb[i], targetRgb[i + 1], targetRgb[i + 2]);
      tLab[x * 3] = Lt; tLab[x * 3 + 1] = At; tLab[x * 3 + 2] = Bt;
    }
    // state: frame-2 colour of fat pixel i-1 (hires x = 2i shows frame1[i] and frame2[i-1])
    let dp = new Float64Array(n).fill(Infinity);
    dp[bg] = 0;
    const back = [];
    for (let i = 0; i < w; i++) {
      unary(u1, f1, allowed?.[0], y, i);
      unary(u2, f2, allowed?.[1], y, i);
      // best previous frame-2 colour for each frame-1 colour a (independent of b)
      const viaA = new Float64Array(n).fill(Infinity), prevOf = new Int16Array(n);
      for (let a = 0; a < n; a++) {
        if (u1[a] === Infinity) continue;
        for (let prev2 = 0; prev2 < n; prev2++) {
          if (dp[prev2] === Infinity) continue;
          const c = dp[prev2] + cost(2 * i, a, prev2);
          if (c < viaA[a]) { viaA[a] = c; prevOf[a] = prev2; }
        }
        viaA[a] += u1[a];
      }
      const next = new Float64Array(n).fill(Infinity);
      const choice = new Int16Array(n * 2);
      for (let b = 0; b < n; b++) {
        if (u2[b] === Infinity) continue;
        for (let a = 0; a < n; a++) {
          if (viaA[a] === Infinity) continue;
          const c = viaA[a] + cost(2 * i + 1, a, b) + u2[b];
          if (c < next[b]) { next[b] = c; choice[b * 2] = prevOf[a]; choice[b * 2 + 1] = a; }
        }
      }
      back.push(choice);
      dp = next;
    }
    let s = 0;
    for (let b = 1; b < n; b++) if (dp[b] < dp[s]) s = b;
    for (let i = w - 1; i >= 0; i--) {
      const ch = back[i];
      f2[y * w + i] = s;
      f1[y * w + i] = ch[s * 2 + 1];
      s = ch[s * 2];
    }
  }
  return [f1, f2];
}

/**
 * Split a picture into two interlace frames shown on top of each other
 * (no shift, SHI/SHIF): every pixel becomes the palette pair whose average
 * is closest, limited to pairs at most `maxGap` apart in lightness.
 * Frame 1 gets the darker colour, so both frames stay coherent.
 */
export function splitBlend(targetRgb, w, h, paletteRgb, maxGap = 100) {
  const n = paletteRgb.length;
  const lum = lightness(paletteRgb);
  const pairs = [];
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
    if (lum[a] > lum[b] || (lum[a] === lum[b] && a > b)) continue;
    if (lum[b] - lum[a] > maxGap) continue;
    const [r1, g1, b1] = paletteRgb[a], [r2, g2, b2] = paletteRgb[b];
    pairs.push({ a, b, lab: rgbToLab((r1 + r2) >> 1, (g1 + g2) >> 1, (b1 + b2) >> 1) });
  }
  const f1 = new Uint8Array(w * h), f2 = new Uint8Array(w * h);
  const cache = new Map();
  for (let p = 0; p < w * h; p++) {
    const key = (targetRgb[p * 4] << 16) | (targetRgb[p * 4 + 1] << 8) | targetRgb[p * 4 + 2];
    let best = cache.get(key);
    if (!best) {
      const [L, A, B] = rgbToLab(targetRgb[p * 4], targetRgb[p * 4 + 1], targetRgb[p * 4 + 2]);
      let d = Infinity;
      for (const pair of pairs) {
        const e = (L - pair.lab[0]) ** 2 + (A - pair.lab[1]) ** 2 + (B - pair.lab[2]) ** 2;
        if (e < d) { d = e; best = pair; }
      }
      cache.set(key, best);
    }
    f1[p] = best.a; f2[p] = best.b;
  }
  return [f1, f2];
}
