import { BG, closestAllowed } from './colors.js';

// ══════════════════════════════════════════════════════════════
//  Super hires modes: hires bitmap with hires sprite layers in front.
//
//  SHI   Super Hires Interlace Editor (.shi): 96×200, two frames blended
//        without shift; front + back sprite layer per frame, ink/paper per
//        8×8 cell shared by both frames.
//  SHX   SHF-XL Edit (.shx): 144×168 hires FLI (ink/paper per 8×1) with
//        one sprite overlay layer.
//  SHIF  Crest SHIF-Editor (.shif): 96×167, two frames; per frame ink/paper
//        per 8×1 plus a front and a back sprite layer.
//
//  Sprite colours are global ("mode parameters", model.sprites):
//  SHI [front, back], SHX [sprite], SHIF [front 1, back 1, front 2, back 2].
//  The models are the unpacked file images (byte layouts: docs/c64-formats.md).
// ══════════════════════════════════════════════════════════════

const solid = (c, bg) => (c === BG ? bg : c);

// ── shared helpers ────────────────────────────────────────────

/** The two most frequent colours of a histogram outside `skip` (missing ones repeat). */
function topTwo(hist, skip, fallback) {
  let a = -1, b = -1;
  for (let c = 0; c < 16; c++) {
    if (!hist[c] || skip.includes(c)) continue;
    if (a < 0 || hist[c] > hist[a]) { b = a; a = c; }
    else if (b < 0 || hist[c] > hist[b]) b = c;
  }
  if (a < 0) a = fallback;
  return [a, b < 0 ? a : b];
}

/** Pixels of a cell histogram that neither the sprite colours nor the best two free colours cover. */
function leftover(hist, sprites) {
  let rest = 0, first = 0, second = 0;
  for (let c = 0; c < 16; c++) {
    const n = hist[c];
    if (!n || sprites.includes(c)) continue;
    rest += n;
    if (n > first) { second = first; first = n; } else if (n > second) second = n;
  }
  return rest - first - second;
}

/**
 * Colour histograms of all cells (cw × ch pixels) of one or more frames;
 * `merge` adds the frames into the same cells (shared ink/paper).
 */
function cellHistograms(frames, width, bg, cw, ch, merge) {
  const height = frames[0].length / width;
  const cols = width / cw, rows = Math.ceil(height / ch);
  const sets = merge ? [frames] : frames.map(f => [f]);
  return sets.map(set => {
    const hists = Array.from({ length: cols * rows }, () => new Uint16Array(16));
    for (const idx of set)
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) hists[((y / ch) | 0) * cols + ((x / cw) | 0)][solid(idx[y * width + x], bg)]++;
    return hists;
  });
}

/** Sprite colours (1 or 2) leaving the fewest pixels without an exact colour. */
function bestSprites(hists, count, bg) {
  let best = { cost: Infinity, set: Array(count).fill(bg) };
  const consider = set => {
    let cost = 0;
    for (const h of hists) { cost += leftover(h, set); if (cost >= best.cost) return; }
    best = { cost, set };
  };
  consider(best.set);
  for (let a = 0; a < 16; a++) {
    if (count === 1) { consider([a]); continue; }
    for (let b = a; b < 16; b++) consider([a, b]);
  }
  return best.set;
}

/** Colour sources for a pixel: front sprite, back sprite, bitmap ink (1) or paper (0). */
function sourceOf(c, front, back, ink, paper) {
  const allowed = back === null ? [ink, paper, front] : [ink, paper, front, back];
  const shown = closestAllowed(c, allowed);
  if (shown === ink) return { ink: true };
  if (shown === paper) return {};
  return shown === front ? { front: true } : { back: true };
}

function setBit(bytes, addr, x, on) {
  const mask = 0x80 >> (x & 7);
  if (on) bytes[addr] |= mask; else bytes[addr] &= ~mask;
}

const bit = (bytes, addr, x) => (bytes[addr] >> (7 - (x & 7))) & 1;

// ── SHI ───────────────────────────────────────────────────────

export const SHI_SIZE = 15355;
const SHI_SPRITES = [0x12c3, 0x26c3];          // front layer per frame; back = front + $100
const SHI_BITMAPS = [0x003, 0x963];
const SHI_SCREEN = 0x3ac3, SHI_FRONT = 0x3bef, SHI_BACK = 0x3bf3;

const shiSprite = (f, x, y) => SHI_SPRITES[f] + (((((y / 21) | 0) << 3) + ((x / 24) | 0)) << 6) + (y % 21) * 3 + ((x >> 3) % 3);
const shiCell = (x, y) => (y >> 3) * 12 + (x >> 3);

const shi = {
  id: 'shi', label: 'SHI (super hires interlace)', width: 96, height: 200, aspect: 1, charW: 8, bugChars: 0,
  frames: 2, frameShift: 0, bgIsColor: true,
  spriteColors: ['Front sprites', 'Back sprites'],

  /** 8×8 cell over both frames: 2 free colours (ink/paper) besides the sprite colours. */
  fits(get, x, y, getOther, sprites) {
    const cx = x & ~7, cy = y & ~7, free = new Set();
    for (const g of getOther ? [get, getOther] : [get])
      for (let yy = cy; yy < cy + 8; yy++) for (let xx = cx; xx < cx + 8; xx++) {
        const c = g(xx, yy);
        if (!sprites.includes(c)) free.add(c);
      }
    return free.size <= 2;
  },

  chooseSprites(frames, bg) {
    return bestSprites(cellHistograms(frames, 96, bg, 8, 8, true)[0], 2, bg);
  },

  /** Change the sprite colour registers of a model (the sprite bits stay). */
  setSprites(m, [front, back]) {
    m.bytes.fill(front, SHI_FRONT, SHI_FRONT + 4);
    m.bytes.fill(back, SHI_BACK, SHI_BACK + 4);
    m.sprites = [front, back];
  },

  encode(frames, bg, sprites = this.chooseSprites(frames, bg)) {
    const [front, back] = sprites;
    const bytes = new Uint8Array(SHI_SIZE);
    bytes[0] = 0xff; bytes[1] = 0x7f;
    bytes.fill(front, SHI_FRONT, SHI_FRONT + 4);
    bytes.fill(back, SHI_BACK, SHI_BACK + 4);
    bytes.set([front, back, 1, 15], SHI_BACK + 4);   // editor UI colours
    const hists = cellHistograms(frames, 96, bg, 8, 8, true)[0];
    hists.forEach((hist, cell) => {
      const [ink, paper] = topTwo(hist, sprites, bg);
      bytes[SHI_SCREEN + cell] = (ink << 4) | paper;
    });
    frames.forEach((idx, f) => {
      for (let y = 0; y < 200; y++) for (let x = 0; x < 96; x++) {
        const scr = bytes[SHI_SCREEN + shiCell(x, y)];
        const src = sourceOf(solid(idx[y * 96 + x], bg), front, back, scr >> 4, scr & 15);
        const sp = shiSprite(f, x, y);
        setBit(bytes, sp, x, src.front);
        setBit(bytes, sp + 0x100, x, src.back);
        setBit(bytes, SHI_BITMAPS[f] + (shiCell(x, y) << 3) + (y & 7), x, src.ink);
      }
    });
    return { bytes, sprites: [front, back] };
  },

  decode(m) {
    const { bytes } = m;
    return [0, 1].map(f => {
      const idx = new Uint8Array(96 * 200);
      for (let y = 0; y < 200; y++) for (let x = 0; x < 96; x++) {
        const sp = shiSprite(f, x, y), col = (x / 24) | 0;
        let c;
        if (bit(bytes, sp, x)) c = bytes[SHI_FRONT + col];
        else if (bit(bytes, sp + 0x100, x)) c = bytes[SHI_BACK + col];
        else {
          const scr = bytes[SHI_SCREEN + shiCell(x, y)];
          c = bit(bytes, SHI_BITMAPS[f] + (shiCell(x, y) << 3) + (y & 7), x) ? scr >> 4 : scr;
        }
        idx[y * 96 + x] = c & 15;
      }
      return idx;
    });
  },
};

// ── SHX (SHF-XL) ──────────────────────────────────────────────

export const SHX_SIZE = 15362;
const SHX_COLOR = 0x3eb;                        // $43e9
/** Sprite pointers p1..p6 per FLI screen (pointer 0 = $ef, pointer 7 = $00). */
const SHX_POINTERS = [
  [0x80, 0x84, 0x85, 0x89, 0x8a, 0x8e], [0x8f, 0x93, 0x94, 0x98, 0x99, 0x9d],
  [0x9e, 0xa2, 0xa3, 0xa7, 0xa8, 0xac], [0xad, 0xb1, 0xb2, 0xb6, 0xb7, 0xbb],
  [0xbc, 0xc0, 0xc1, 0xc5, 0xc6, 0xca], [0xcb, 0xcf, 0xd0, 0xd4, 0xd5, 0xd9],
  [0xda, 0xde, 0xdf, 0xe3, 0xe4, 0xe8], [0xe9, 0xea, 0xeb, 0xec, 0xed, 0xee],
];

const shxCell = (x, y) => (y >> 3) * 40 + 11 + (x >> 3);        // picture uses screen columns 11..28
const shxScreen = (x, y) => 2 + ((y & 7) << 10) + shxCell(x, y);
const shxBitmap = (x, y) => 0x2002 + (shxCell(x, y) << 3) + (y & 7);
function shxSprite(x, y) {
  const col = x >> 3, s = (col / 3) | 0;
  let n = ((y - 1) & 7) * 15 + s;               // the sprite pointer lags one line behind the screen
  if (n < 0x69) n += ((s + 1) >> 1) * 3;
  return 0x2002 + (n << 6) + (y % 21) * 3 + (col % 3);
}

/** File image without picture data: screens, sprite pointers, the solid sprite block $ef. */
function newShxBytes() {
  const bytes = new Uint8Array(SHX_SIZE);
  bytes[0] = 0x00; bytes[1] = 0x40;
  for (let k = 0; k < 8; k++) {
    bytes.fill(0xbb, 2 + k * 0x400, 2 + k * 0x400 + 1000);
    bytes.set([0xef, ...SHX_POINTERS[k], 0x00], 2 + k * 0x400 + 0x3f8);
  }
  bytes[0x3ea] = 0x0b;
  bytes.fill(0xff, 2 + 0x3bc0, 2 + 0x3bff);
  return bytes;
}

const shx = {
  id: 'shx', label: 'SHF-XL (super hires FLI)', width: 144, height: 168, aspect: 1, charW: 8, bugChars: 0,
  bgIsColor: true,
  spriteColors: ['Sprite overlay'],

  /** 8×1 run: 2 free colours (ink/paper) besides the overlay colour. */
  fits(get, x, y, _other, sprites) {
    const free = new Set();
    for (let xx = x & ~7; xx < (x & ~7) + 8; xx++) { const c = get(xx, y); if (c !== sprites[0]) free.add(c); }
    return free.size <= 2;
  },

  chooseSprites(idx, bg) {
    return bestSprites(cellHistograms([idx], 144, bg, 8, 1, true)[0], 1, bg);
  },

  setSprites(m, [sprite]) {
    m.bytes[SHX_COLOR] = sprite;
    m.sprites = [sprite];
  },

  encode(idx, bg, sprites = this.chooseSprites(idx, bg)) {
    const [sprite] = sprites;
    const bytes = newShxBytes();
    bytes[SHX_COLOR] = sprite;
    const hists = cellHistograms([idx], 144, bg, 8, 1, true)[0];
    for (let y = 0; y < 168; y++) for (let cx = 0; cx < 18; cx++) {
      const [ink, paper] = topTwo(hists[y * 18 + cx], sprites, bg);
      bytes[shxScreen(cx * 8, y)] = (ink << 4) | paper;
      for (let x = cx * 8; x < cx * 8 + 8; x++) {
        const src = sourceOf(solid(idx[y * 144 + x], bg), sprite, null, ink, paper);
        setBit(bytes, shxSprite(x, y), x, src.front);
        setBit(bytes, shxBitmap(x, y), x, src.ink);
      }
    }
    return { bytes, sprites: [sprite] };
  },

  decode(m) {
    const { bytes } = m;
    const idx = new Uint8Array(144 * 168);
    for (let y = 0; y < 168; y++) for (let x = 0; x < 144; x++) {
      let c;
      if (bit(bytes, shxSprite(x, y), x)) c = bytes[SHX_COLOR];
      else { const scr = bytes[shxScreen(x, y)]; c = bit(bytes, shxBitmap(x, y), x) ? scr >> 4 : scr; }
      idx[y * 144 + x] = c & 15;
    }
    return idx;
  },
};

// ── SHIF (Crest SHIF-Editor) ──────────────────────────────────

export const SHIF_FRAME_SIZE = 8176;
const SHIF_BACK = 0x800, SHIF_BITMAP = 0x1000, SHIF_COLOR = 0x1800;
const shifOffset = (x, y) => y * 12 + (x >> 3);

const shif = {
  id: 'shif', label: 'SHIF (super hires interlace FLI)', width: 96, height: 167, aspect: 1, charW: 8, bugChars: 0,
  frames: 2, frameShift: 0, bgIsColor: true, heightStep: 1,
  spriteColors: ['Front sprites 1', 'Back sprites 1', 'Front sprites 2', 'Back sprites 2'],

  /** 8×1 run of one frame: 2 free colours (ink/paper) besides that frame's sprite colours. */
  fits(get, x, y, _other, sprites, frame = 1) {
    const own = sprites.slice((frame - 1) * 2, frame * 2), free = new Set();
    for (let xx = x & ~7; xx < (x & ~7) + 8; xx++) { const c = get(xx, y); if (!own.includes(c)) free.add(c); }
    return free.size <= 2;
  },

  chooseSprites(frames, bg) {
    return cellHistograms(frames, 96, bg, 8, 1, false).flatMap(hists => bestSprites(hists, 2, bg));
  },

  setSprites(m, sprites) {
    m.sprites = [...sprites];
  },

  encode(frames, bg, sprites = this.chooseSprites(frames, bg)) {
    const hists = cellHistograms(frames, 96, bg, 8, 1, false);
    const out = frames.map((idx, f) => {
      const [front, back] = sprites.slice(f * 2, f * 2 + 2);
      const bytes = new Uint8Array(SHIF_FRAME_SIZE);
      bytes[SHIF_FRAME_SIZE - 1] = 0xff;
      for (let y = 0; y < 167; y++) for (let cx = 0; cx < 12; cx++) {
        const [ink, paper] = topTwo(hists[f][y * 12 + cx], [front, back], bg);
        const o = y * 12 + cx;
        bytes[SHIF_COLOR + o] = (ink << 4) | paper;
        for (let x = cx * 8; x < cx * 8 + 8; x++) {
          const src = sourceOf(solid(idx[y * 96 + x], bg), front, back, ink, paper);
          setBit(bytes, o, x, src.front);
          setBit(bytes, SHIF_BACK + o, x, src.back);
          setBit(bytes, SHIF_BITMAP + o, x, src.ink);
        }
      }
      return bytes;
    });
    return { frames: out, sprites: [...sprites] };
  },

  decode(m) {
    return m.frames.map((bytes, f) => {
      const [front, back] = m.sprites.slice(f * 2, f * 2 + 2);
      const idx = new Uint8Array(96 * 167);
      for (let y = 0; y < 167; y++) for (let x = 0; x < 96; x++) {
        const o = shifOffset(x, y);
        let c;
        if (bit(bytes, o, x)) c = front;
        else if (bit(bytes, SHIF_BACK + o, x)) c = back;
        else c = bit(bytes, SHIF_BITMAP + o, x) ? bytes[SHIF_COLOR + o] >> 4 : bytes[SHIF_COLOR + o];
        idx[y * 96 + x] = c & 15;
      }
      return idx;
    });
  },
};

export const SUPERHIRES_MODES = { shi, shx, shif };
