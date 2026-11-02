// ══════════════════════════════════════════════════════════════
//  C64 picture file formats
//
//  format.detect(bytes, ext) → true if the file is in this format
//  format.read(bytes)        → VIC data model for format.mode
//  format.write(model)       → file bytes (including the 2-byte load address)
// ══════════════════════════════════════════════════════════════
import { NUF_SIZE, unpackNup } from './nufli.js';
import { SHIF_FRAME_SIZE, SHI_SIZE, SHX_SIZE } from './superhires.js';

const loadAddress = bytes => bytes.length >= 2 ? bytes[0] | (bytes[1] << 8) : -1;

function withLoadAddress(addr, size) {
  const out = new Uint8Array(size);
  out[0] = addr & 0xff; out[1] = addr >> 8;
  return out;
}

const koala = {
  id: 'koala', label: 'Koala Painter', mode: 'multicolor', ext: 'koa', loadAddress: 0x6000,
  detect(bytes, ext) {
    if (bytes.length === 10003 && loadAddress(bytes) === 0x6000) return true;
    // Koala files are also seen without load address, or with a different one
    return ['koa', 'kla'].includes(ext) && (bytes.length === 10003 || bytes.length === 10001);
  },
  read(bytes) {
    const o = bytes.length === 10001 ? 0 : 2;
    return {
      bitmap: bytes.slice(o, o + 8000),
      screen: bytes.slice(o + 8000, o + 9000),
      color:  bytes.slice(o + 9000, o + 10000),
      bg:     bytes[o + 10000] & 15,
    };
  },
  write(m) {
    const out = withLoadAddress(0x6000, 10003);
    out.set(m.bitmap, 2); out.set(m.screen, 8002); out.set(m.color, 9002);
    out[10002] = m.bg;
    return out;
  },
};

// ── Hires bitmaps ─────────────────────────────────────────────

/** Hires format with bitmap and screen RAM at fixed file offsets. */
function hiresFormat({ id, label, ext, load, sizes, bitmap, screen, size = sizes[0], extra, exts = [] }) {
  return {
    id, label, ext, mode: 'hires', loadAddress: load,
    // files with one of `exts` are accepted at any load address
    detect: (bytes, e) => (loadAddress(bytes) === load || exts.includes(e)) && sizes.includes(bytes.length),
    read: bytes => ({
      bitmap: bytes.slice(bitmap, bitmap + 8000),
      screen: screen === null ? new Uint8Array(1000).fill(0x10) : bytes.slice(screen, screen + 1000),
    }),
    write(m) {
      const out = withLoadAddress(load, size);
      out.set(m.bitmap, bitmap);
      if (screen !== null) out.set(m.screen, screen);
      extra?.(out, m);
      return out;
    },
  };
}

const artStudio = hiresFormat({ id: 'art-studio', label: 'Art Studio', ext: 'art', load: 0x2000,
  sizes: [9009, 9003, 9002], bitmap: 2, screen: 0x1f42 });
const interpaintHires = hiresFormat({ id: 'interpaint-hires', label: 'Interpaint Hires', ext: 'iph', load: 0x4000,
  sizes: [9002], bitmap: 2, screen: 0x1f42 });
const hiEddi = hiresFormat({ id: 'hi-eddi', label: 'Hi-Eddi', ext: 'hed', load: 0x2000,
  sizes: [9218], bitmap: 2, screen: 0x2002 });
const doodle = hiresFormat({ id: 'doodle', label: 'Doodle', ext: 'dd', load: 0x5c00,
  sizes: [9218, 9217, 9026, 9346], bitmap: 0x402, screen: 2, exts: ['dd', 'ddl'] });
const imageSystemHires = hiresFormat({ id: 'image-system-hires', label: 'Image System Hires', ext: 'ish', load: 0x4000,
  sizes: [9194], bitmap: 2, screen: 0x2002 });
const hiresMono = hiresFormat({ id: 'hires-mono', label: 'Hires bitmap (mono)', ext: 'hbw', load: 0x2000,
  sizes: [8002], bitmap: 2, screen: null });

/** Doodle packed (.jj): `$FE VALUE COUNT` runs, other bytes literal; unpacks to screen RAM + bitmap ($400 + 8000 bytes). */
const doodlePacked = {
  id: 'doodle-packed', label: 'Doodle (packed)', ext: 'jj', mode: 'hires', loadAddress: 0x5c00,
  detect(bytes, ext) {
    if (ext !== 'jj' || loadAddress(bytes) !== 0x5c00) return false;
    return unpackDoodle(bytes)?.length >= DOODLE_PACKED_SIZE;
  },
  read(bytes) {
    const data = unpackDoodle(bytes);
    return { bitmap: data.slice(0x400, 0x400 + 8000), screen: data.slice(0, 1000) };
  },
};

const DOODLE_PACKED_SIZE = 0x400 + 8000;

function unpackDoodle(bytes) {
  const out = [];
  for (let i = 2; i < bytes.length && out.length < DOODLE_PACKED_SIZE; i++) {
    if (bytes[i] === 0xfe) {
      if (i + 2 >= bytes.length) return null;
      for (let n = 0; n < bytes[i + 2]; n++) out.push(bytes[i + 1]);
      i += 2;
    } else out.push(bytes[i]);
  }
  return Uint8Array.from(out);
}

// ── FLI ───────────────────────────────────────────────────────

const SCREENS = (bytes, offset) => Array.from({ length: 8 }, (_, k) => bytes.slice(offset + k * 0x400, offset + k * 0x400 + 1000));

function mostFrequent(values) {
  const count = new Array(16).fill(0);
  for (const v of values) count[v & 15]++;
  return count.indexOf(Math.max(...count));
}

/** FLI Graph / Blackmail: $3b00, per-line $d021 table, colour RAM, 8 screens, bitmap. */
function readFliGraph(data, o) {
  const bgLines = Array.from(data.slice(o, o + 200), v => v & 15);
  return {
    bitmap: data.slice(o + 0x2500, o + 0x2500 + 8000),
    screens: SCREENS(data, o + 0x500),
    color: data.slice(o + 0x100, o + 0x100 + 1000),
    bg: mostFrequent(bgLines),
    bgLines,
  };
}

const fliGraph = {
  id: 'fli-graph', label: 'FLI Graph / Blackmail', ext: 'bml', mode: 'fli', loadAddress: 0x3b00,
  detect: bytes => loadAddress(bytes) === 0x3b00 && bytes.length === 17474,
  read: bytes => readFliGraph(bytes, 2),
  write(m) {
    const out = withLoadAddress(0x3b00, 17474);
    out.fill(m.bg, 2, 202);
    out.set(m.color, 0x102);
    m.screens.forEach((scr, k) => out.set(scr, 0x502 + k * 0x400));
    out.set(m.bitmap, 0x2502);
    return out;
  },
};

/**
 * Packed FLI Graph (and FLIP) at $38f0: escape byte, last packed byte, unpacked end.
 * Read backwards: `ESC COUNT VALUE` (in reading order, COUNT 0 = 256), other bytes literal;
 * the output fills downwards from the end address.
 */
function unpackFliBackwards(bytes) {
  const esc = bytes[2];
  const end = bytes[5] | (bytes[6] << 8);
  const out = new Uint8Array(0x10000);
  let w = end, r = bytes.length - 1;
  const dataStart = 7;
  while (r >= dataStart && w >= 0) {
    const b = bytes[r--];
    if (b === esc && r - 1 >= dataStart) {
      const count = bytes[r--] || 256;
      const value = bytes[r--];
      for (let n = 0; n < count && w >= 0; n++) out[w--] = value;
    } else out[w--] = b;
  }
  return { mem: out, end, produced: end - w };
}

const fliGraphPacked = {
  id: 'fli-graph-packed', label: 'FLI Graph (packed)', ext: 'bml', mode: 'fli', loadAddress: 0x38f0,
  detect(bytes) {
    if (loadAddress(bytes) !== 0x38f0 || bytes.length < 100) return false;
    const end = bytes[5] | (bytes[6] << 8);
    return end === 0x7f3f;
  },
  read(bytes) {
    const { mem, produced } = unpackFliBackwards(bytes);
    if (produced >= 17472) return readFliGraph(mem, 0x3b00);
    // FLIP variant: no $d021 table, colour RAM at $3c00
    return {
      bitmap: mem.slice(0x6000, 0x6000 + 8000), screens: SCREENS(mem, 0x4000),
      color: mem.slice(0x3c00, 0x3c00 + 1000), bg: 0,
    };
  },
};

/** FLI Designer: $3c00, colour RAM, 8 screens, bitmap; background not stored (black). */
const fliDesigner = {
  id: 'fli-designer', label: 'FLI Designer', ext: 'fd2', mode: 'fli', loadAddress: 0x3c00,
  detect: bytes => loadAddress(bytes) === 0x3c00 && (bytes.length === 17409 || bytes.length === 17218),
  read: bytes => ({
    bitmap: bytes.slice(0x2402, 0x2402 + 8000), screens: SCREENS(bytes, 0x402),
    color: bytes.slice(2, 1002), bg: 0,
  }),
};

// ── AFLI ──────────────────────────────────────────────────────

/** AFLI editor (.afl): $4000, 8 screens then hires bitmap. */
const afl = {
  id: 'afl', label: 'AFLI Editor', ext: 'afl', mode: 'afli', loadAddress: 0x4000,
  detect: (bytes, ext) => loadAddress(bytes) === 0x4000 && bytes.length === 16385 && ext !== 'him',
  read: bytes => ({ bitmap: bytes.slice(0x2002, 0x2002 + 8000), screens: SCREENS(bytes, 2) }),
  write(m) {
    const out = withLoadAddress(0x4000, 16385);
    m.screens.forEach((scr, k) => out.set(scr, 2 + k * 0x400));
    out.set(m.bitmap, 0x2002);
    return out;
  },
};

// ── IFLI (two FLI frames sharing one colour RAM) ─────────────

const fliFrame = (bytes, screens, bitmap) => ({ screens: SCREENS(bytes, screens), bitmap: bytes.slice(bitmap, bitmap + 8000) });
const ascii = text => Array.from(text, c => c.charCodeAt(0));
const hasBytes = (bytes, offset, expected) => expected.every((v, i) => bytes[offset + i] === v);

const GUNPAINT_SIG = ascii('GUNPAINT (JZ)   ');

/** Gunpaint: $4000, frame 1, $d021 table, colour RAM, frame 2; signature in unused screen bytes. */
const gunpaint = {
  id: 'gunpaint', label: 'Gunpaint', ext: 'gun', mode: 'ifli', loadAddress: 0x4000,
  detect: bytes => loadAddress(bytes) === 0x4000 && (bytes.length === 33603 || bytes.length === 33602),
  read(bytes) {
    // $d021 per line: lines 0..176 at $7f4f, 177..196 at $87e8, 197..199 repeat the last value
    const bgLines = [];
    for (let y = 0; y < 200; y++) {
      const v = y < 177 ? bytes[0x3f51 + y] : bytes[0x47ea + Math.min(y - 177, 19)];
      bgLines.push(v & 15);
    }
    return {
      frames: [fliFrame(bytes, 2, 0x2002), fliFrame(bytes, 0x4402, 0x6402)],
      color: bytes.slice(0x4002, 0x4002 + 1000),
      bg: mostFrequent(bgLines),
      bgLines,
    };
  },
  write(m) {
    const out = withLoadAddress(0x4000, 33603);
    m.frames[0].screens.forEach((scr, k) => out.set(scr, 2 + k * 0x400));
    out.set(m.frames[0].bitmap, 0x2002);
    out.fill(m.bg, 0x3f51, 0x3f51 + 177);
    out.set(m.color, 0x4002);
    m.frames[1].screens.forEach((scr, k) => out.set(scr, 0x4402 + k * 0x400));
    out.fill(m.bg, 0x47ea, 0x47ea + 20);
    out.set(m.frames[1].bitmap, 0x6402);
    out.set(GUNPAINT_SIG, 0x3ea);
    return out;
  },
};

const FUNPAINT_SIG = ascii('FUNPAINT (MT) ');
const FUNPAINT_SIZE = 33694;

/** Funpaint II forward RLE from offset 18: `ESC COUNT VALUE` (COUNT 0 = nothing), other bytes literal. */
function unpackFunpaint(bytes) {
  const out = new Uint8Array(FUNPAINT_SIZE);
  out.set(bytes.subarray(0, 18));
  const esc = bytes[17];
  let w = 18;
  for (let r = 18; r < bytes.length && w < FUNPAINT_SIZE; r++) {
    if (bytes[r] === esc && r + 2 < bytes.length) {
      const count = bytes[r + 1], value = bytes[r + 2];
      for (let n = 0; n < count && w < FUNPAINT_SIZE; n++) out[w++] = value;
      r += 2;
    } else out[w++] = bytes[r];
  }
  return out;
}

/** Funpaint II: $3ff0 header, frame 1, colour RAM, frame 2 (not $400-aligned in the file). */
const funpaint = {
  id: 'funpaint', label: 'Funpaint II', ext: 'fp2', mode: 'ifli', loadAddress: 0x3ff0,
  detect: bytes => loadAddress(bytes) === 0x3ff0 && hasBytes(bytes, 2, FUNPAINT_SIG),
  read(bytes) {
    const data = bytes[16] ? unpackFunpaint(bytes) : bytes;
    return {
      frames: [fliFrame(data, 0x12, 0x2012), fliFrame(data, 0x43fa, 0x63fa)],
      color: data.slice(0x4012, 0x4012 + 1000),
      bg: 0,
    };
  },
};

/** Pixel Perfect unpacked layout starting at $3c00 (offset `o` of address $3c00). */
function readPixelPerfect(data, o) {
  return {
    frames: [fliFrame(data, o + 0x400, o + 0x2400), fliFrame(data, o + 0x4400, o + 0x6400)],
    color: data.slice(o, o + 1000),
    bg: data[o + 0x437f] & 15,
  };
}

/** Pixel Perfect (.pp): $3c00, colour RAM, frame 1, bg, frame 2. */
const pixelPerfect = {
  id: 'pixel-perfect', label: 'Pixel Perfect', ext: 'pp', mode: 'ifli', loadAddress: 0x3c00,
  detect: bytes => loadAddress(bytes) === 0x3c00 && bytes.length === 33602,
  read: bytes => readPixelPerfect(bytes, 2),
};

/** Pixel Perfect packed (.ppp): $3bfc, `$10 $10 $10 ESC`, forward RLE `ESC COUNT VALUE` = COUNT+1 × VALUE. */
const pixelPerfectPacked = {
  id: 'pixel-perfect-packed', label: 'Pixel Perfect (packed)', ext: 'ppp', mode: 'ifli', loadAddress: 0x3bfc,
  detect: bytes => loadAddress(bytes) === 0x3bfc && hasBytes(bytes, 2, [0x10, 0x10, 0x10]),
  read(bytes) {
    const esc = bytes[5];
    const out = new Uint8Array(33600);
    let w = 0;
    for (let r = 6; r < bytes.length && w < out.length; r++) {
      if (bytes[r] === esc && r + 2 < bytes.length) {
        const count = bytes[r + 1] + 1, value = bytes[r + 2];
        for (let n = 0; n < count && w < out.length; n++) out[w++] = value;
        r += 2;
      } else out[w++] = bytes[r];
    }
    return readPixelPerfect(out, 0);
  },
};

// ── NUFLI ─────────────────────────────────────────────────────

/** NUFLI Editor (.nuf): memory $2000–$79ff incl. displayer; model = memory image (+ trailing bytes of loaded files). */
const nuf = {
  id: 'nuf', label: 'NUFLI Editor', ext: 'nuf', mode: 'nufli', loadAddress: 0x2000,
  detect: bytes => loadAddress(bytes) === 0x2000 && bytes.length >= 2 + NUF_SIZE && bytes.length <= 2 + NUF_SIZE + 256,
  read: bytes => ({ mem: bytes.slice(2, 2 + NUF_SIZE), extra: bytes.slice(2 + NUF_SIZE) }),
  write(m) {
    const out = withLoadAddress(0x2000, 2 + NUF_SIZE + m.extra.length);
    out.set(m.mem, 2);
    out.set(m.extra, 2 + NUF_SIZE);
    return out;
  },
};

/** NUFLI Editor packed (.nup): $0fff, `$fd ESC`, backwards RLE. */
const nup = {
  id: 'nup', label: 'NUFLI Editor (packed)', ext: 'nup', mode: 'nufli', loadAddress: 0x0fff,
  detect: bytes => loadAddress(bytes) === 0x0fff && bytes[2] === 0xfd && bytes.length > 100,
  read: bytes => ({ mem: unpackNup(bytes), extra: new Uint8Array(0) }),
};

// ── Super hires ───────────────────────────────────────────────

/**
 * SHI packing (forward from offset 3): a control byte c < $80 is followed by
 * c literal bytes; c >= $80 repeats the next byte c−$80 times.
 */
function unpackShi(bytes) {
  const out = new Uint8Array(SHI_SIZE);
  out.set(bytes.subarray(0, 3));
  let w = 3, r = 3;
  while (w < SHI_SIZE) {
    if (r >= bytes.length) return null;
    const c = bytes[r++];
    if (c < 0x80) {
      if (r + c > bytes.length) return null;
      for (let i = 0; i < c && w < SHI_SIZE; i++) out[w++] = bytes[r++];
    } else {
      const v = bytes[r++];
      for (let i = 0; i < c - 0x80 && w < SHI_SIZE; i++) out[w++] = v;
    }
  }
  return out;
}

function packShi(data) {
  const out = [...data.subarray(0, 2), 1];
  let lit = [];
  const flush = () => { if (lit.length) { out.push(lit.length, ...lit); lit = []; } };
  for (let i = 3; i < data.length;) {
    let n = 1;
    while (i + n < data.length && data[i + n] === data[i] && n < 0x7f) n++;
    if (n >= 3) { flush(); out.push(0x80 + n, data[i]); i += n; continue; }
    lit.push(data[i++]);
    if (lit.length === 0x7f) flush();
  }
  flush();
  return Uint8Array.from(out);
}

/** Super Hires Interlace Editor V1.3B (.shi): $7fff, packed flag, 96×200 interlace. */
const shiFormat = {
  id: 'shi', label: 'Super Hires Interlace Editor', ext: 'shi', mode: 'shi', loadAddress: 0x7fff,
  detect(bytes) {
    if (loadAddress(bytes) !== 0x7fff) return false;
    if (bytes[2] === 0) return bytes.length === SHI_SIZE;
    return bytes[2] === 1 && unpackShi(bytes) !== null;
  },
  read(bytes) {
    const data = bytes[2] === 0 ? bytes.slice(0, SHI_SIZE) : unpackShi(bytes);
    return { bytes: data, sprites: [data[0x3bef] & 15, data[0x3bf3] & 15] };
  },
  write: m => packShi(m.bytes),
};

/** SHF-XL Edit (.shx): $4000, unpacked hires FLI + sprite overlay, 144×168. */
const shxFormat = {
  id: 'shx', label: 'SHF-XL Edit', ext: 'shx', mode: 'shx', loadAddress: 0x4000,
  detect: bytes => loadAddress(bytes) === 0x4000 && bytes.length === SHX_SIZE,
  read: bytes => ({ bytes: bytes.slice(), sprites: [bytes[0x3eb] & 15] }),
  write: m => m.bytes.slice(),
};

/**
 * SHIF frame block: [word W][ESC][data], W − $9402 bytes after the word.
 * The data is read backwards (`ESC COUNT(0=256) VALUE` in reading order,
 * else literal) and fills the 8176-byte frame from its end.
 */
function unpackShifFrame(bytes, o) {
  if (o + 3 > bytes.length) return null;
  const len = (bytes[o] | (bytes[o + 1] << 8)) - 0x9402;
  if (len <= 1 || o + 2 + len > bytes.length) return null;
  const esc = bytes[o + 2], lo = o + 3;
  const out = new Uint8Array(SHIF_FRAME_SIZE);
  let w = SHIF_FRAME_SIZE - 1, r = o + 2 + len;
  while (w >= 0) {
    if (r <= lo) return null;
    const v = bytes[--r];
    if (v === esc) {
      if (r - 2 < lo) return null;
      let n = bytes[--r] || 256;
      const value = bytes[--r];
      while (n-- && w >= 0) out[w--] = value;
    } else out[w--] = v;
  }
  return { frame: out, next: o + 2 + len };
}

function packShifFrame(frame) {
  const count = new Array(256).fill(0);
  frame.forEach(v => count[v]++);
  const esc = count.indexOf(Math.min(...count));
  const tokens = [];                       // reading order (from the frame's end)
  for (let i = frame.length - 1; i >= 0;) {
    let n = 1;
    while (i - n >= 0 && frame[i - n] === frame[i] && n < 256) n++;
    if (n >= 3 || frame[i] === esc) { tokens.push(esc, n & 0xff, frame[i]); i -= n; }
    else tokens.push(frame[i--]);
  }
  const len = 1 + tokens.length;
  return Uint8Array.from([(0x9402 + len) & 0xff, (0x9402 + len) >> 8, esc, ...tokens.reverse()]);
}

/** Crest SHIF-Editor (.shif): two packed frame blocks + front/back colours per frame. */
const shifFormat = {
  id: 'shif', label: 'SHIF-Editor', ext: 'shif', mode: 'shif', loadAddress: null,
  detect(bytes) {
    const a = unpackShifFrame(bytes, 0);
    const b = a && unpackShifFrame(bytes, a.next);
    return !!b && b.next + 4 === bytes.length;
  },
  read(bytes) {
    const a = unpackShifFrame(bytes, 0), b = unpackShifFrame(bytes, a.next);
    return { frames: [a.frame, b.frame], sprites: Array.from(bytes.slice(-4), v => v & 15) };
  },
  write(m) {
    const [a, b] = m.frames.map(packShifFrame);
    const out = new Uint8Array(a.length + b.length + 4);
    out.set(a); out.set(b, a.length); out.set(m.sprites, a.length + b.length);
    return out;
  },
};

/** All known formats; the first writable one per mode is its save format. */
export const FORMATS = [
  koala,
  artStudio, interpaintHires, hiEddi, doodle, doodlePacked, imageSystemHires, hiresMono,
  fliGraph, fliGraphPacked, fliDesigner,
  afl,
  gunpaint, funpaint, pixelPerfect, pixelPerfectPacked,
  nuf, nup,
  shiFormat, shxFormat, shifFormat,
];

/** Default save format per mode. */
export function formatForMode(modeId) {
  return FORMATS.find(f => f.mode === modeId && f.write) ?? null;
}

/** Find the format of a file, or null for unknown / packed / program files. */
export function detectFormat(bytes, name = '') {
  const ext = (name.split('.').pop() || '').toLowerCase().trim();
  return FORMATS.find(f => f.detect(bytes, ext)) ?? null;
}

export { loadAddress };
