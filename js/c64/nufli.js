import { BG, c64ColorDistance } from './colors.js';

// ══════════════════════════════════════════════════════════════
//  NUFLI (Crest NUFLI Editor .nuf) — hires FLI every 2 lines plus
//  8 sprites as underlays.
//
//  The document model is the raw memory image $2000–$79ff (23040 bytes)
//  exactly as stored in a .nuf file, so displayer code, sprite pointers
//  and structural table entries are preserved byte for byte.
//
//  Per pixel:  bitmap bit 1 → ink (in front of all sprites)
//              bitmap bit 0 → sprite colour if a sprite bit is set, else paper
//  Main area (char columns 3..38): 6 X-expanded hires underlay sprites,
//  one colour per 48-px column, changeable every 2 lines via a 6×101
//  register table. Bug area (columns 0..2): hires sprite 0 + multicolour
//  sprite 7; ink/paper are light grey except on the first 2 lines of a
//  char row. Column 39: ink/paper only.
// ══════════════════════════════════════════════════════════════

export const NUF_BASE = 0x2000;
export const NUF_SIZE = 0x5a00;        // $2000–$79ff
const W = 320, H = 200;
const at = addr => addr - NUF_BASE;

export function screenBase(y) {
  if (y < 128) return 0x4000 + ((7 - ((y >> 1) & 7)) << 10);
  return 0x2000 + ((((y >> 1) + (y >= 168 ? 1 : 0)) & 3) << 10);
}
const bitmapBase = y => (y < 128 ? 0x6000 : 0x2000);
const spriteBlock = (ptr, y) => (y < 128 ? 0x4000 : 0x0000) + ptr * 64;
export const tableAddr = (col, row) => 0x2400 + ((col & 6) << 9) + ((col & 1) << 7) + row;
const spriteRow = y => ((y + 47) >> 1) * 3 + (y < 123 ? 0 : y < 165 ? 1 : 2);

/** Fixed sprite pointers of the NUFLI displayer (upper screens $4000+k*$400, lower $2000+k*$400). */
const UPPER_PTRS = k => [0xe0 + k, 0x0a + 0x10 * k, 0x0b + 0x10 * k, 0x0c + 0x10 * k, 0x0d + 0x10 * k, 0x0e + 0x10 * k, 0xd0 + k, 0xd8 + k];
const LOWER_PTRS = k => [0xc8 + k, 0x84 + 0x10 * k, 0x85 + 0x10 * k, 0x86 + 0x10 * k, 0x87 + 0x10 * k, 0x88 + 0x10 * k, 0x89 + 0x10 * k, 0x80 + k];

// ── memory accessors ──────────────────────────────────────────

const cellOf = (x, y) => (y >> 3) * 40 + (x >> 3);
const screenAddr = (x, y) => screenBase(y) + cellOf(x, y);
const bitmapAddr = (x, y) => bitmapBase(y) + cellOf(x, y) * 8 + (y & 7);

/** Address and bit of the hires sprite pixel (sprite 0 in the bug area, 1..6 in the main area). */
function hiresSpriteBit(mem, x, y) {
  const col = x >> 3;
  const s = Math.floor((3 + col) / 6);
  const ptr = mem[at(screenBase(y) + 0x3f8 + s)];
  const sx = col < 3 ? x : ((x - 24) >> 1) % 24;
  return { s, addr: spriteBlock(ptr, y) + ((spriteRow(y) + (sx >> 3)) & 63), mask: 0x80 >> (sx & 7) };
}

/** Address and shift of the multicolour bug sprite (sprite 7) pixel pair. */
function mcSpritePair(mem, x, y) {
  const ptr = mem[at(screenBase(y) + 0x3ff)];
  return { addr: spriteBlock(ptr, y) + ((spriteRow(y) + (x >> 3)) & 63), shift: 6 - (x & 6) };
}

/**
 * Colour registers per raster line, from the initial values and the table.
 * regs[y] = [sprite0, U1..U6, $d025, sprite7 ($d02e), $d026]
 */
export function lineRegisters(mem) {
  const sc = new Array(10).fill(0);
  sc[0] = mem[at(0x3ff7)] & 15;
  for (let i = 0; i < 6; i++) sc[1 + i] = mem[at(tableAddr(i, 0))] & 15;
  sc[7] = mem[at(0x3ff1)] & 15;
  sc[8] = mem[at(0x3ff6)] & 15;
  sc[9] = mem[at(0x3ff0)] & 15;
  const regs = [];
  for (let y = 0; y < H; y++) {
    if (y > 0) {
      for (let i = 0; i < 6; i++) {
        const b = mem[at(tableAddr(i, (y + 1) >> 1))];
        const hi = b >> 4;
        const bugLine = (y & 1) === (i === 0 ? 1 : 0);
        if (hi === 0 && (y & 1)) sc[1 + i] = b & 15;
        else if (hi === 5 && bugLine) sc[7] = b & 15;
        else if (hi === 6 && bugLine) sc[9] = b & 15;
        else if (hi === 7 && bugLine) sc[0] = b & 15;
        else if (hi === 14 && bugLine) sc[8] = b & 15;
      }
    }
    regs.push(sc.slice());
  }
  return regs;
}

/** Decode the memory image into a 320×200 index buffer. */
export function decodeNufli(mem) {
  const regs = lineRegisters(mem);
  const idx = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const sc = regs[y];
    for (let x = 0; x < W; x++) {
      const col = x >> 3;
      const attr = col >= 3 || (y & 6) === 0 ? mem[at(screenAddr(x, y))] : 0xff;
      const bit = mem[at(bitmapAddr(x, y))] & (0x80 >> (x & 7));
      let c;
      if (bit) c = attr >> 4;
      else {
        c = attr & 15;
        if (col < 39) {
          const sp = hiresSpriteBit(mem, x, y);
          if (mem[at(sp.addr)] & sp.mask) c = sc[sp.s];
          else if (col < 3) {
            const mc = mcSpritePair(mem, x, y);
            const v = (mem[at(mc.addr)] >> mc.shift) & 3;
            if (v) c = sc[6 + v];
          }
        }
      }
      idx[y * W + x] = c & 15;
    }
  }
  return idx;
}

/** Empty memory image: fixed sprite pointers, black everywhere, no displayer (cannot be saved). */
export function emptyNufliMemory() {
  const mem = new Uint8Array(NUF_SIZE);
  for (let k = 0; k < 8; k++) mem.set(UPPER_PTRS(k), at(0x4000 + k * 0x400 + 0x3f8));
  for (let k = 0; k < 4; k++) mem.set(LOWER_PTRS(k), at(0x2000 + k * 0x400 + 0x3f8));
  return mem;
}

// ── .nup packing (NUFLI Editor) ───────────────────────────────

/** .nup: `$fd ESC`, data read backwards from the end: `ESC COUNT(0=256) VALUE`, other bytes literal. */
export function unpackNup(bytes) {
  const esc = bytes[3];
  const out = new Uint8Array(NUF_SIZE);
  let o = NUF_SIZE - 1, src = bytes.length;
  const rd = () => { if (src <= 4) throw new Error('packed data ends early'); return bytes[--src]; };
  while (o >= 0) {
    const b = rd();
    if (b === esc) {
      const n = rd() || 256, v = rd();
      for (let i = 0; i < n && o >= 0; i++) out[o--] = v;
    } else out[o--] = b;
  }
  return out;
}

// ══════════════════════════════════════════════════════════════
//  Encoder: fit target pixels into the memory image
//
//  target  — Uint8Array(320×200) palette indices
//  weight  — Float32Array(320×200) importance per pixel (high = keep exactly)
//  rect    — {x0, y0, x1, y1} region that must be re-solved (inclusive)
//
//  Main area: dynamic programming over the underlay colour of each 48-px
//  sprite column per 2-line step (U-pair r covers lines 2r-1, 2r), with
//  ink/paper chosen per 8×2 block. Table slots holding other entries
//  (bug colours, sprite moves, border) keep their value, so the underlay
//  cannot change there. The bug area and column 39 keep the colour
//  register schedule and only choose bits / ink / paper.
// ══════════════════════════════════════════════════════════════

const DIST = (() => {
  const d = new Float64Array(256);
  for (let a = 0; a < 16; a++) for (let b = 0; b < 16; b++) d[a * 16 + b] = c64ColorDistance(a, b);
  return d;
})();

/** Error of showing colour c at pixel p. */
const err = (ctx, p, c) => ctx.weight[p] * DIST[ctx.target[p] * 16 + c];

function blockPixels(cx, p) {
  const px = [];
  for (let l = 0; l < 2; l++) for (let i = 0; i < 8; i++) px.push((2 * p + l) * W + cx * 8 + i);
  return px;
}

function screenColors(mem, cx, p) {
  const v = mem[at(screenBase(2 * p) + (p >> 2) * 40 + cx)];
  return [v >> 4, v & 15];
}

/** Candidate colours for a set of pixels: their target colours plus extras. */
function candidates(ctx, pixels, extra) {
  const set = new Set(extra);
  for (const p of pixels) set.add(ctx.target[p]);
  return [...set];
}

/**
 * Best ink/paper for a main-area 8×2 block given the underlay colour of each line.
 * Sprite pixels are 2 hires px wide: a pair shows {ink, paper} (sprite off) or {ink, U} (sprite on).
 */
function solveMainBlock(ctx, cx, p, ua, ub) {
  const key = `${cx}:${p}:${ua}:${ub}`;
  const hit = ctx.blockCache.get(key);
  if (hit) return hit;
  const px = blockPixels(cx, p);
  const cands = candidates(ctx, px, screenColors(ctx.mem, cx, p));
  let best = { cost: Infinity };
  for (const ink of cands) for (const paper of cands) {
    let cost = 0;
    for (let l = 0; l < 2 && cost < best.cost; l++) {
      const u = l ? ub : ua;
      for (let k = 0; k < 8; k += 2) {
        const p0 = px[l * 8 + k], p1 = p0 + 1;
        const ei0 = err(ctx, p0, ink), ei1 = err(ctx, p1, ink);
        const off = Math.min(ei0, err(ctx, p0, paper)) + Math.min(ei1, err(ctx, p1, paper));
        const on = Math.min(ei0, err(ctx, p0, u)) + Math.min(ei1, err(ctx, p1, u));
        cost += Math.min(off, on);
      }
    }
    if (cost < best.cost) best = { cost, ink, paper };
  }
  ctx.blockCache.set(key, best);
  return best;
}

/** Underlay colour candidates for a sprite column: colours of its target pixels plus current values. */
function underlayCandidates(ctx, s, rA, rB, current) {
  const count = new Array(16).fill(0);
  const x0 = 24 + 48 * (s - 1);
  for (let y = Math.max(0, 2 * rA - 2); y <= Math.min(H - 1, 2 * rB + 1); y++)
    for (let x = x0; x < x0 + 48; x++) count[ctx.target[y * W + x]]++;
  const ranked = count.map((n, c) => [n, c]).filter(e => e[0]).sort((a, b) => b[0] - a[0]).map(e => e[1]);
  return [...new Set([...current, ...ranked.slice(0, ctx.maxUnderlayCandidates)])];
}

/** Re-solve one underlay column for U rows rA..rB (other rows stay fixed). */
function solveUnderlayColumn(ctx, s, rA, rB) {
  const { mem } = ctx;
  const col = s - 1;
  const cells = [];
  for (let c = 0; c < 6; c++) cells.push(3 + 6 * (s - 1) + c);
  const U = r => mem[at(tableAddr(col, r))];
  // current underlay value per U row (row r holds a $0x entry or keeps the previous value)
  const cur = [];
  for (let r = 0; r <= 100; r++) cur[r] = r === 0 || (U(r) >> 4) === 0 ? U(r) & 15 : cur[r - 1];
  const free = r => r === 0 || (U(r) >> 4) === 0;
  const cands = underlayCandidates(ctx, s, rA, rB, cur.slice(Math.max(0, rA - 1), rB + 2));

  const pairCost = (p, a, b) => {
    let sum = 0;
    for (const cx of cells) sum += solveMainBlock(ctx, cx, p, a, b).cost;
    return sum;
  };

  // DP over rows rA..rB; state = underlay colour at row r
  const before = rA > 0 ? cur[rA - 1] : null;
  let prev = new Map();
  for (const v of cands) {
    if (rA > 0 && !free(rA) && v !== before) continue;
    const c = rA > 0 ? pairCost(rA - 1, before, v) : 0;
    prev.set(v, { cost: c, path: [v] });
  }
  for (let r = rA + 1; r <= rB; r++) {
    const next = new Map();
    for (const v of cands) {
      let best = null;
      for (const [u, st] of prev) {
        if (!free(r) && v !== u) continue;
        const c = st.cost + pairCost(r - 1, u, v);
        if (!best || c < best.cost) best = { cost: c, path: st.path, u };
      }
      if (best) next.set(v, { cost: best.cost, path: [...best.path, v] });
    }
    prev = next;
  }
  // close with the fixed row after the window
  let final = null;
  for (const [v, st] of prev) {
    let c = st.cost;
    if (rB < 100) {
      if (!free(rB + 1) && cur[rB + 1] !== v) {
        // row rB+1 cannot change: it keeps v, so it must equal v for consistency
        continue;
      }
      c += pairCost(rB, v, cur[rB + 1]);
    }
    if (!final || c < final.cost) final = { cost: c, path: st.path };
  }
  if (!final) return;

  // write underlay colours
  final.path.forEach((v, i) => {
    const r = rA + i;
    if (free(r)) mem[at(tableAddr(col, r))] = v;
  });
  // the row after the window may have depended on the previous value through a locked slot
  const uAt = r => (r >= rA && r <= rB ? final.path[r - rA] : cur[r]);
  for (let p = Math.max(0, rA - 1); p <= Math.min(99, rB); p++)
    for (const cx of cells) writeMainBlock(ctx, cx, p, uAt(p), uAt(p + 1));
}

/** Write ink/paper, bitmap and sprite bits of a main-area block for given underlays. */
function writeMainBlock(ctx, cx, p, ua, ub) {
  const { mem } = ctx;
  const { ink, paper } = solveMainBlock(ctx, cx, p, ua, ub);
  mem[at(screenBase(2 * p) + (p >> 2) * 40 + cx)] = (ink << 4) | paper;
  for (let l = 0; l < 2; l++) {
    const y = 2 * p + l, u = l ? ub : ua;
    for (let k = 0; k < 8; k += 2) {
      const x = cx * 8 + k, p0 = y * W + x, p1 = p0 + 1;
      const ei0 = err(ctx, p0, ink), ei1 = err(ctx, p1, ink);
      const ep0 = err(ctx, p0, paper), ep1 = err(ctx, p1, paper);
      const eu0 = err(ctx, p0, u), eu1 = err(ctx, p1, u);
      const spriteOn = Math.min(ei0, eu0) + Math.min(ei1, eu1) < Math.min(ei0, ep0) + Math.min(ei1, ep1);
      const base0 = spriteOn ? eu0 : ep0, base1 = spriteOn ? eu1 : ep1;
      setBit(mem, bitmapAddr(x, y), 0x80 >> (x & 7), ei0 < base0);
      setBit(mem, bitmapAddr(x + 1, y), 0x80 >> ((x + 1) & 7), ei1 < base1);
      const sp = hiresSpriteBit(mem, x, y);
      setBit(mem, sp.addr, sp.mask, spriteOn);
    }
  }
}

function setBit(mem, addr, mask, on) {
  if (on) mem[at(addr)] |= mask; else mem[at(addr)] &= ~mask;
}

/** Column 39: plain ink/paper per 8×2 block. */
function solveLastColumn(ctx, p) {
  const { mem } = ctx;
  const px = blockPixels(39, p);
  const cands = candidates(ctx, px, screenColors(mem, 39, p));
  let best = { cost: Infinity };
  for (const ink of cands) for (const paper of cands) {
    let cost = 0;
    for (const q of px) cost += Math.min(err(ctx, q, ink), err(ctx, q, paper));
    if (cost < best.cost) best = { cost, ink, paper };
  }
  mem[at(screenBase(2 * p) + (p >> 2) * 40 + 39)] = (best.ink << 4) | best.paper;
  for (const q of px) {
    const x = q % W, y = (q / W) | 0;
    setBit(mem, bitmapAddr(x, y), 0x80 >> (x & 7), err(ctx, q, best.ink) < err(ctx, q, best.paper));
  }
}

/**
 * Bug area (x 0..23) for one 2-line pair with the register schedule kept.
 * On the first pair of each char row ink/paper are real; elsewhere light grey.
 */
function solveBugPair(ctx, p, regs) {
  const { mem } = ctx;
  const realAttr = (p & 3) === 0;
  for (let cx = 0; cx < 3; cx++) {
    const px = blockPixels(cx, p);
    const inkPaper = realAttr ? candidates(ctx, px, screenColors(mem, cx, p)) : [15];
    let best = null;
    for (const ink of inkPaper) for (const paper of inkPaper) {
      const plan = bugBlockPlan(ctx, cx, p, ink, paper, regs);
      if (!best || plan.cost < best.cost) best = { ...plan, ink, paper };
    }
    if (realAttr) mem[at(screenBase(2 * p) + (p >> 2) * 40 + cx)] = (best.ink << 4) | best.paper;
    for (const op of best.ops) setBit(mem, op.addr, op.mask, op.on);
    for (const mc of best.mc) mem[at(mc.addr)] = (mem[at(mc.addr)] & ~(3 << mc.shift)) | (mc.v << mc.shift);
  }
}

function bugBlockPlan(ctx, cx, p, ink, paper, regs) {
  const { mem } = ctx;
  let cost = 0;
  const ops = [], mc = [];
  for (let l = 0; l < 2; l++) {
    const y = 2 * p + l, sc = regs[y];
    for (let k = 0; k < 8; k += 2) {
      const x = cx * 8 + k;
      const q0 = y * W + x, q1 = q0 + 1;
      let best = null;
      for (let v = 0; v < 4; v++) {
        const base = v ? sc[6 + v] : paper;
        const opts = q => [[err(ctx, q, ink), 1, 0], [err(ctx, q, sc[0]), 0, 1], [err(ctx, q, base), 0, 0]]
          .reduce((a, b) => (b[0] < a[0] ? b : a));
        const o0 = opts(q0), o1 = opts(q1);
        const c = o0[0] + o1[0];
        if (!best || c < best.c) best = { c, v, o0, o1 };
      }
      cost += best.c;
      const pair = mcSpritePair(mem, x, y);
      mc.push({ addr: pair.addr, shift: pair.shift, v: best.v });
      [[x, best.o0], [x + 1, best.o1]].forEach(([xx, o]) => {
        ops.push({ addr: bitmapAddr(xx, y), mask: 0x80 >> (xx & 7), on: !!o[1] });
        const sp = hiresSpriteBit(mem, xx, y);
        ops.push({ addr: sp.addr, mask: sp.mask, on: !!o[2] });
      });
    }
  }
  return { cost, ops, mc };
}

/**
 * Fit `target` into `mem` inside `rect`. Pixels with high weight outside the
 * edit are kept if at all possible.
 */
export function encodeNufliRegion(mem, target, weight, rect, opts = {}) {
  const ctx = { mem, target, weight, blockCache: new Map(), maxUnderlayCandidates: opts.maxUnderlayCandidates ?? 6 };
  const pA = Math.max(0, rect.y0 >> 1), pB = Math.min(99, rect.y1 >> 1);
  const cA = Math.max(0, rect.x0 >> 3), cB = Math.min(39, rect.x1 >> 3);

  // main area: one DP per touched sprite column
  for (let s = 1; s <= 6; s++) {
    const c0 = 3 + 6 * (s - 1), c1 = c0 + 5;
    if (cB < c0 || cA > c1) continue;
    ctx.blockCache.clear();
    solveUnderlayColumn(ctx, s, Math.max(0, pA - 1), Math.min(100, pB + 2));
  }
  if (cB >= 39) for (let p = pA; p <= pB; p++) solveLastColumn(ctx, p);
  if (cA <= 2) {
    const regs = lineRegisters(mem);
    for (let p = pA; p <= pB; p++) solveBugPair(ctx, p, regs);
  }
}

/** Index buffer for the editor: BG marks the document background colour. */
export function nufliIndices(mem, bgIdx) {
  const idx = decodeNufli(mem);
  for (let i = 0; i < idx.length; i++) if (idx[i] === bgIdx) idx[i] = BG;
  return idx;
}
