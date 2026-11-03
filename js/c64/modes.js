import { S } from '../state.js';
import { BG, closestAllowed, nearestC64Color, c64IndexOfHex } from './colors.js';
import { decodeNufli } from './nufli.js';
import { SUPERHIRES_MODES } from './superhires.js';

// ══════════════════════════════════════════════════════════════
//  C64 graphics modes
//
//  Every mode works on "index buffers": one byte per pixel holding a
//  palette index 0–15, or BG for the global background colour.
//
//  mode.fits(get, x, y)  — colour rule check for the cell containing (x, y);
//                          get(px, py) returns the index at a pixel (BG = bg).
//  mode.encode(idx, bg)  — index buffer → VIC data model (bitmap, screens …);
//                          colours that do not fit are mapped to the nearest
//                          allowed colour.
//  mode.decode(model)    — VIC data model → index buffer.
// ══════════════════════════════════════════════════════════════

const CHARS_X = 40, CHARS_Y = 25;

// ── shared helpers ────────────────────────────────────────────

/** Distinct indices in a rectangle (optionally skipping BG). */
function colorsIn(get, x0, y0, w, h, skipBg) {
  const set = new Set();
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) {
      const c = get(x, y);
      if (!(skipBg && c === BG)) set.add(c);
    }
  return set;
}

/** Indices sorted by frequency (most frequent first), ignoring `exclude`. */
function byFrequency(values, exclude = []) {
  const count = new Map();
  for (const v of values) if (!exclude.includes(v)) count.set(v, (count.get(v) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
}

/** Distinct values in order of first appearance, ignoring `exclude`. */
function distinctInOrder(values, exclude = []) {
  return [...new Set(values.filter(v => !exclude.includes(v)))];
}

/** Pixel indices of a w×h block at (x0, y0) in a 2D index buffer of width W. */
function block(idx, W, x0, y0, w, h) {
  const out = [];
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) out.push(idx[y * W + x]);
  return out;
}

/** Replace BG by the real background index (modes where bg is an ordinary colour). */
const solid = (c, bg) => (c === BG ? bg : c);

function newBitmap() { return new Uint8Array(8000); }
function newScreens() { return Array.from({ length: 8 }, () => new Uint8Array(1000)); }

// ── Multicolor bitmap (Koala) — 160×200, 4×8 cell: bg + 3 colours ─

const multicolor = {
  id: 'multicolor', label: 'Multicolor bitmap', width: 160, height: 200, aspect: 2, charW: 4, bugChars: 0,

  fits(get, x, y) {
    const cx = x - (x % 4), cy = y - (y % 8);
    return colorsIn(get, cx, cy, 4, 8, true).size <= 3;
  },

  encode(idx, bg) {
    const m = { bitmap: newBitmap(), screen: new Uint8Array(1000), color: new Uint8Array(1000), bg };
    for (let cy = 0; cy < CHARS_Y; cy++) for (let cx = 0; cx < CHARS_X; cx++) {
      const cell = cy * CHARS_X + cx;
      const px = block(idx, 160, cx * 4, cy * 8, 4, 8);
      // ≤3 colours: order of appearance (stable output); more: keep the most frequent
      const distinct = distinctInOrder(px, [BG, bg]);
      const [c1 = bg, c2 = bg, c3 = bg] = distinct.length <= 3 ? distinct : byFrequency(px, [BG, bg]);
      m.screen[cell] = (c1 << 4) | c2;
      m.color[cell] = c3;
      const allowed = [bg, c1, c2, c3];
      for (let row = 0; row < 8; row++) {
        let byte = 0;
        for (let col = 0; col < 4; col++) {
          const c = solid(px[row * 4 + col], bg);
          const bits = allowed.indexOf(c === bg ? bg : closestAllowed(c, allowed));
          byte |= (c === bg ? 0 : bits) << (6 - col * 2);
        }
        m.bitmap[cell * 8 + row] = byte;
      }
    }
    return m;
  },

  decode(m) {
    const idx = new Uint8Array(160 * 200);
    for (let cy = 0; cy < CHARS_Y; cy++) for (let cx = 0; cx < CHARS_X; cx++) {
      const cell = cy * CHARS_X + cx;
      const cols = [BG, m.screen[cell] >> 4, m.screen[cell] & 15, m.color[cell] & 15];
      for (let row = 0; row < 8; row++) {
        const byte = m.bitmap[cell * 8 + row];
        for (let col = 0; col < 4; col++)
          idx[(cy * 8 + row) * 160 + cx * 4 + col] = cols[(byte >> (6 - col * 2)) & 3];
      }
    }
    return idx;
  },
};

// ── Hires bitmap — 320×200, 8×8 cell: 2 colours ───────────────

const hires = {
  id: 'hires', label: 'Hires bitmap', width: 320, height: 200, aspect: 1, charW: 8, bugChars: 0,
  bgIsColor: true,   // no free background: bg counts as one of the 2 cell colours

  fits(get, x, y) {
    const cx = x - (x % 8), cy = y - (y % 8);
    return colorsIn(get, cx, cy, 8, 8, false).size <= 2;
  },

  encode(idx, bg) {
    const m = { bitmap: newBitmap(), screen: new Uint8Array(1000) };
    for (let cy = 0; cy < CHARS_Y; cy++) for (let cx = 0; cx < CHARS_X; cx++) {
      const cell = cy * CHARS_X + cx;
      const px = block(idx, 320, cx * 8, cy * 8, 8, 8).map(c => solid(c, bg));
      encodeHiresRows(px, 8, m.bitmap, cell * 8, bg, (fg, back) => { m.screen[cell] = (fg << 4) | back; });
    }
    return m;
  },

  decode(m) {
    const idx = new Uint8Array(320 * 200);
    for (let cy = 0; cy < CHARS_Y; cy++) for (let cx = 0; cx < CHARS_X; cx++) {
      const cell = cy * CHARS_X + cx;
      for (let row = 0; row < 8; row++)
        decodeHiresByte(m.bitmap[cell * 8 + row], m.screen[cell], idx, (cy * 8 + row) * 320 + cx * 8);
    }
    return idx;
  },
};

/**
 * Encode `rows` rows of 8 hires pixels (already BG-resolved) into bitmap bytes.
 * Pixels outside the two chosen colours are mapped to the nearer one.
 */
function encodeHiresRows(px, rows, bitmap, offset, bg, setColors) {
  const [fg = bg, back = fg === bg ? fg : bg] = byFrequency(px);
  const allowed = [back, fg];
  for (let row = 0; row < rows; row++) {
    let byte = 0;
    for (let col = 0; col < 8; col++) {
      const c = px[row * 8 + col];
      if (closestAllowed(c, allowed) === fg && fg !== back) byte |= 0x80 >> col;
    }
    bitmap[offset + row] = byte;
  }
  setColors(fg, back);
}

function decodeHiresByte(byte, screenByte, idx, offset) {
  const fg = screenByte >> 4, back = screenByte & 15;
  for (let col = 0; col < 8; col++) idx[offset + col] = (byte & (0x80 >> col)) ? fg : back;
}

// ── FLI — multicolor with a screen RAM per raster line ─────────
//    4×1 cell: 2 free colours; 4×8 cell: 1 shared colour (colour RAM); bg global.
//    The first 3 character columns show the FLI bug and only hold background.
//    IFLI = two FLI frames sharing one colour RAM, so the helpers take several frames.

/** FLI colour rule for the 4×8 cell at (x, y) over all frames sharing its colour RAM. */
function fliCellFits(getters, x, y) {
  const cx = x - (x % 4), cy = y - (y % 8);
  const rows = [];
  const all = new Set();
  for (const get of getters) {
    for (let r = 0; r < 8; r++) {
      const s = colorsIn(get, cx, cy + r, 4, 1, true);
      rows.push(s);
      s.forEach(c => all.add(c));
    }
  }
  if (rows.every(s => s.size <= 2)) return true;
  // one colour may come from colour RAM for the whole 4×8 cell
  return [...all].some(k => rows.every(s => s.size - (s.has(k) ? 1 : 0) <= 2));
}

/** Encode FLI frames (index buffers, 160×200) that share one colour RAM. */
function encodeFliFrames(frames, bg, bugChars) {
  const out = frames.map(() => ({ bitmap: newBitmap(), screens: newScreens() }));
  const color = new Uint8Array(1000);
  for (let cy = 0; cy < CHARS_Y; cy++) for (let cx = bugChars; cx < CHARS_X; cx++) {
    const cell = cy * CHARS_X + cx;
    // rows of all frames: frame f, line r → rows[f * 8 + r]
    const rows = [];
    for (const idx of frames)
      for (let r = 0; r < 8; r++) rows.push(block(idx, 160, cx * 4, cy * 8 + r, 4, 1).map(c => solid(c, bg)));
    // colour RAM: the candidate leaving the fewest pixels without an exact colour
    const candidates = [bg, ...byFrequency(rows.flat(), [bg])];
    let best = { cost: Infinity };
    for (const k of candidates) {
      let cost = 0;
      const rowCols = rows.map(px => {
        const [a = bg, b = bg] = byFrequency(px, [bg, k]);
        cost += px.filter(c => c !== bg && c !== k && c !== a && c !== b).length;
        return [a, b];
      });
      if (cost < best.cost) best = { cost, k, rowCols };
      if (cost === 0) break;
    }
    color[cell] = best.k;
    rows.forEach((px, i) => {
      const f = out[i >> 3], r = i & 7;
      const [a, b] = best.rowCols[i];
      f.screens[r][cell] = (a << 4) | b;
      const allowed = [bg, a, b, best.k];
      let byte = 0;
      px.forEach((c, col) => {
        const bits = c === bg ? 0 : allowed.indexOf(closestAllowed(c, allowed));
        byte |= bits << (6 - col * 2);
      });
      f.bitmap[cell * 8 + r] = byte;
    });
  }
  return { frames: out, color };
}

/** Decode one FLI frame; `m` supplies bg and the optional per-line bg table. */
function decodeFliFrame(bitmap, screens, color, m, bugChars) {
  const idx = new Uint8Array(160 * 200).fill(BG);
  for (let cy = 0; cy < CHARS_Y; cy++) for (let cx = bugChars; cx < CHARS_X; cx++) {
    const cell = cy * CHARS_X + cx;
    for (let row = 0; row < 8; row++) {
      const y = cy * 8 + row;
      const scr = screens[row][cell];
      // Per-line background: lines differing from the global bg keep their real colour
      const lineBg = m.bgLines && m.bgLines[y] !== m.bg ? m.bgLines[y] : BG;
      const cols = [lineBg, scr >> 4, scr & 15, color[cell] & 15];
      const byte = bitmap[cell * 8 + row];
      for (let col = 0; col < 4; col++)
        idx[y * 160 + cx * 4 + col] = cols[(byte >> (6 - col * 2)) & 3];
    }
  }
  return idx;
}

const fli = {
  id: 'fli', label: 'FLI (multicolor)', width: 160, height: 200, aspect: 2, charW: 4, bugChars: 3,
  fits: (get, x, y) => fliCellFits([get], x, y),
  encode(idx, bg) {
    const { frames: [f], color } = encodeFliFrames([idx], bg, this.bugChars);
    return { ...f, color, bg };
  },
  decode(m) { return decodeFliFrame(m.bitmap, m.screens, m.color, m, this.bugChars); },
};

// ── IFLI — two FLI frames shown alternately, frame 2 shifted 1 hires pixel right ─

const ifli = {
  id: 'ifli', label: 'IFLI (interlaced FLI)', width: 160, height: 200, aspect: 2, charW: 4, bugChars: 3,
  frames: 2, frameShift: 1,   // frame 2 is shown one hires pixel to the right
  /** `getOther` reads the other frame: both share the colour RAM of each 4×8 cell. */
  fits: (get, x, y, getOther) => fliCellFits(getOther ? [get, getOther] : [get], x, y),
  encode(frameIdx, bg) {
    const { frames, color } = encodeFliFrames(frameIdx, bg, this.bugChars);
    return { frames, color, bg };
  },
  decode(m) { return m.frames.map(f => decodeFliFrame(f.bitmap, f.screens, m.color, m, this.bugChars)); },
  /**
   * Colours each frame can show: one bitmask per raster line and character
   * column (index y * 40 + cx) — background, the line's two screen colours
   * and the cell's colour RAM; the FLI bug columns show background only.
   */
  allowedColors(m) {
    return m.frames.map(f => {
      const masks = new Uint16Array(200 * CHARS_X);
      for (let cy = 0; cy < CHARS_Y; cy++) for (let cx = 0; cx < CHARS_X; cx++) {
        const cell = cy * CHARS_X + cx;
        for (let r = 0; r < 8; r++) {
          let bits = 1 << m.bg;
          if (cx >= this.bugChars) {
            const scr = f.screens[r][cell];
            bits |= (1 << (scr >> 4)) | (1 << (scr & 15)) | (1 << (m.color[cell] & 15));
          }
          masks[(cy * 8 + r) * CHARS_X + cx] = bits;
        }
      }
      return masks;
    });
  },
};

// ── AFLI — hires with a screen RAM per raster line (8×1 cell: 2 colours) ─

const afli = {
  id: 'afli', label: 'AFLI (hires FLI)', width: 320, height: 200, aspect: 1, charW: 8, bugChars: 3,
  bgIsColor: true,

  fits(get, x, y) {
    return colorsIn(get, x - (x % 8), y, 8, 1, false).size <= 2;
  },

  encode(idx, bg) {
    const m = { bitmap: newBitmap(), screens: newScreens() };
    for (let cy = 0; cy < CHARS_Y; cy++) for (let cx = 0; cx < CHARS_X; cx++) {
      const cell = cy * CHARS_X + cx;
      for (let r = 0; r < 8; r++) {
        if (cx < this.bugChars) { m.screens[r][cell] = (bg << 4) | bg; continue; }
        const px = block(idx, 320, cx * 8, cy * 8 + r, 8, 1).map(c => solid(c, bg));
        encodeHiresRows(px, 1, m.bitmap, cell * 8 + r, bg, (fg, back) => { m.screens[r][cell] = (fg << 4) | back; });
      }
    }
    return m;
  },

  decode(m) {
    const idx = new Uint8Array(320 * 200);
    for (let cy = 0; cy < CHARS_Y; cy++) for (let cx = 0; cx < CHARS_X; cx++) {
      const cell = cy * CHARS_X + cx;
      for (let row = 0; row < 8; row++)
        decodeHiresByte(m.bitmap[cell * 8 + row], m.screens[row][cell], idx, (cy * 8 + row) * 320 + cx * 8);
    }
    for (let y = 0; y < 200; y++) idx.fill(BG, y * 320, y * 320 + 24);
    return idx;
  },
};

// ── NUFLI — hires FLI every 2 lines + sprite underlays (see nufli.js) ─
//    The model is the .nuf memory image kept in S.c64Data; the colour rules are
//    too entangled for a per-pixel check, so each edit is re-encoded afterwards.

const nufli = {
  id: 'nufli', label: 'NUFLI', width: 320, height: 200, aspect: 1, charW: 8, bugChars: 0,
  bgIsColor: true, stateful: true,
  decode: m => decodeNufli(m.mem),
};

export const MODES = { multicolor, hires, fli, afli, ifli, nufli, ...SUPERHIRES_MODES };

// ── Tall pictures: pages of the native height ─────────────────
//    The colour rules are local to character cells and lines, and a page
//    (mode.height lines, e.g. 200 = 25 character rows) holds whole cells, so
//    a picture of any height is encoded, checked and saved page by page with
//    the standard encoders. Every page becomes one file of the mode's format.

export const TALL_MAX_HEIGHT = 2000;

/** Height steps of a mode: whole character rows (8 lines) unless the mode says otherwise. */
export const heightStep = mode => mode.heightStep ?? 8;

/** Snap a requested height to the steps and range allowed for a mode. */
export function snapHeight(mode, h) {
  const step = heightStep(mode);
  const max = Math.floor(TALL_MAX_HEIGHT / step) * step;
  return Math.max(step, Math.min(max, Math.round((h || mode.height) / step) * step));
}

/** Number of pages (files) a picture of this height needs. */
export const pageCount = (mode, height) => Math.ceil(height / mode.height);

/** Split an index buffer into pages of `pageH` lines; the last page is padded with `fill`. */
export function splitPages(idx, width, height, pageH, fill = BG) {
  const pages = [];
  for (let y0 = 0; y0 < height; y0 += pageH) {
    const page = new Uint8Array(width * pageH).fill(fill);
    page.set(idx.subarray(y0 * width, Math.min(height, y0 + pageH) * width));
    pages.push(page);
  }
  return pages;
}

/** Join page buffers back into one buffer of `height` lines (padding dropped). */
export function joinPages(pages, width, height, pageH) {
  const out = new Uint8Array(width * height);
  pages.forEach((page, i) => {
    const rows = Math.min(pageH, height - i * pageH);
    out.set(page.subarray(0, rows * width), i * pageH * width);
  });
  return out;
}

/**
 * Encode a picture of any height: one VIC data model per page.
 * `input` is an index buffer, or one buffer per frame for interlaced modes.
 */
export function encodePages(mode, input, bg, height, params) {
  const split = idx => splitPages(idx, mode.width, height, mode.height);
  if (!mode.frames) return split(input).map(page => mode.encode(page, bg, params));
  const perFrame = input.map(split);
  return perFrame[0].map((_, i) => mode.encode(perFrame.map(pages => pages[i]), bg, params));
}

/** Snap a picture of any height to the mode's colour rules; same shape as `input`. */
export function enforcePages(mode, input, bg, height, params) {
  const decoded = encodePages(mode, input, bg, height, params).map(m => mode.decode(m));
  const join = pages => joinPages(pages, mode.width, height, mode.height);
  if (!mode.frames) return join(decoded);
  return input.map((_, f) => join(decoded.map(frames => frames[f])));
}

export function currentMode() {
  return S.c64Mode ? MODES[S.c64Format] ?? null : null;
}

// ── Colour rule check while painting ──────────────────────────

const _idxCache = new Map();

function indexAt(px, i) {
  if (px[i + 3] < 10) return BG;
  const key = (px[i] << 16) | (px[i + 1] << 8) | px[i + 2];
  let ci = _idxCache.get(key);
  if (ci === undefined) { ci = nearestC64Color(px[i], px[i + 1], px[i + 2]); _idxCache.set(key, ci); }
  return ci;
}

/** Can (x, y) on the active layer take this colour without breaking the mode's colour rules? */
export function canPaintInMode(x, y, r, g, b, a) {
  const mode = currentMode();
  if (!mode || !mode.fits) return true;
  const bgIdx = c64IndexOfHex(S.c64BgColor);
  const toIdx = c => (c === bgIdx ? BG : c);
  const newIdx = a < 10 ? BG : toIdx(nearestC64Color(r, g, b));
  const px = S.pixels, W = S.width;
  const get = (gx, gy) => {
    if (gx === x && gy === y) return newIdx;
    if (gx < 0 || gy < 0 || gx >= W || gy >= S.height) return BG;
    return toIdx(indexAt(px, (gy * W + gx) * 4));
  };
  // FLI bug columns can only show background
  if (x < mode.bugChars * mode.charW) return newIdx === BG;
  // In hires-type modes bg is an ordinary colour of the cell
  const resolve = mode.bgIsColor ? (g => (gx, gy) => { const c = g(gx, gy); return c === BG ? bgIdx : c; }) : (g => g);
  const sprites = S.c64Data?.sprites ?? [];
  // Interlaced modes: the other frame shares parts of the cell (colour RAM, SHI ink/paper)
  if (mode.frames) {
    const active = S.layers[S.activeLayerIndex];
    const other = S.layers.find(l => l.frame && l !== active)?.pixels;
    const getOther = other && resolve((gx, gy) => toIdx(indexAt(other, (gy * W + gx) * 4)));
    return mode.fits(resolve(get), x, y, getOther, sprites, active?.frame);
  }
  return mode.fits(resolve(get), x, y, null, sprites);
}

/** Human-readable explanation of the rule, used in toasts. */
export function modeRuleText(mode) {
  switch (mode.id) {
    case 'multicolor': return 'max 3 colours + background per 4×8 cell';
    case 'hires':      return 'max 2 colours per 8×8 cell';
    case 'fli':        return 'max 2 colours per 4×1 row + 1 shared per 4×8 cell (left 3 columns: background only)';
    case 'afli':       return 'max 2 colours per 8×1 row (left 3 columns: background only)';
    case 'nufli':      return 'NUFLI: ink + paper per 8×2 block plus one underlay colour per 48-px column';
    case 'shi':        return 'max 2 colours per 8×8 cell (shared by both frames) + front/back sprite colours';
    case 'shx':        return 'max 2 colours per 8×1 row + the sprite overlay colour';
    case 'shif':       return 'max 2 colours per 8×1 row per frame + that frame\'s front/back sprite colours';
    case 'ifli':       return 'max 2 colours per 4×1 row per frame + 1 shared by both frames per 4×8 cell (left 3 columns: background only)';
    default:           return 'colour limit of this mode';
  }
}
