// ══════════════════════════════════════════════════════════════
//  D64 disk images (1541): directory and file extraction
// ══════════════════════════════════════════════════════════════

const FILE_TYPES = ['DEL', 'SEQ', 'PRG', 'USR', 'REL'];

/** Image sizes: 35/40/42 tracks, with or without error bytes. */
const D64_SIZES = { 174848: 35, 175531: 35, 196608: 40, 197376: 40, 205312: 42, 206114: 42 };

const sectorsPerTrack = t => (t <= 17 ? 21 : t <= 24 ? 19 : t <= 30 ? 18 : 17);

export function isD64(bytes) {
  return bytes.length in D64_SIZES;
}

function sectorOffset(t, s, tracks) {
  if (t < 1 || t > tracks || s >= sectorsPerTrack(t)) return -1;
  let o = 0;
  for (let i = 1; i < t; i++) o += sectorsPerTrack(i);
  return (o + s) * 256;
}

/** Follow a track/sector chain and return the file contents. */
function readChain(img, t, s, tracks) {
  const parts = [];
  const seen = new Set();
  let total = 0;
  while (t !== 0) {
    const key = t * 256 + s;
    const o = sectorOffset(t, s, tracks);
    if (o < 0 || seen.has(key)) break;   // broken or circular chain
    seen.add(key);
    const nextT = img[o], nextS = img[o + 1];
    const end = nextT === 0 ? Math.max(o + 2, o + nextS + 1) : o + 256;
    parts.push(img.subarray(o + 2, end));
    total += end - (o + 2);
    t = nextT; s = nextS;
  }
  const out = new Uint8Array(total);
  let p = 0;
  for (const part of parts) { out.set(part, p); p += part.length; }
  return out;
}

/** Raw PETSCII name bytes without the shifted-space padding. */
function trimName(bytes) {
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0xa0) end--;
  return bytes.slice(0, end);
}

/**
 * Parse a D64 image.
 * @returns {{ title: Uint8Array, id: Uint8Array, blocksFree: number,
 *             files: { name: Uint8Array, type: string, closed: boolean, locked: boolean,
 *                      blocks: number, data: Uint8Array }[] }}
 */
export function readD64(img) {
  const tracks = D64_SIZES[img.length];
  const bam = sectorOffset(18, 0, tracks);
  let blocksFree = 0;
  for (let t = 1; t <= 35; t++) if (t !== 18) blocksFree += img[bam + 4 * t];

  const files = [];
  const visited = new Set();
  let t = img[bam], s = img[bam + 1];
  while (t !== 0 && !visited.has(t * 256 + s)) {
    visited.add(t * 256 + s);
    const o = sectorOffset(t, s, tracks);
    if (o < 0) break;
    for (let e = 0; e < 8; e++) {
      const eo = o + e * 32;
      const typeByte = img[eo + 2];
      if (typeByte === 0) continue;                 // empty slot / scratched
      const type = FILE_TYPES[typeByte & 7] ?? '???';
      const data = (typeByte & 7) !== 0 ? readChain(img, img[eo + 3], img[eo + 4], tracks) : new Uint8Array(0);
      files.push({
        name: trimName(img.slice(eo + 5, eo + 21)),
        type,
        closed: !!(typeByte & 0x80),
        locked: !!(typeByte & 0x40),
        blocks: img[eo + 30] | (img[eo + 31] << 8),
        data,
      });
    }
    t = img[o]; s = img[o + 1];
  }

  return {
    title: trimName(img.slice(bam + 0x90, bam + 0xa0)),
    id: img.slice(bam + 0xa2, bam + 0xa7),
    blocksFree,
    files,
  };
}

/**
 * PETSCII → display string (upper-case/graphics charset). Letters and
 * punctuation map to ASCII, graphic characters to similar Unicode shapes.
 */
export function petsciiToString(bytes) {
  let s = '';
  for (const b of bytes) s += petsciiChar(b);
  return s;
}

const GRAPHICS = {
  0x60: '─', 0x61: '♠', 0x62: '│', 0x63: '─', 0x64: '─', 0x65: '▔', 0x66: '─', 0x67: '│',
  0x68: '│', 0x69: '╮', 0x6a: '╰', 0x6b: '╯', 0x6c: '▖', 0x6d: '╲', 0x6e: '╱', 0x6f: '▔',
  0x70: '╭', 0x71: '●', 0x72: '▁', 0x73: '♥', 0x74: '▏', 0x75: '╭', 0x76: '╳', 0x77: '○',
  0x78: '♣', 0x79: '▕', 0x7a: '♦', 0x7b: '┼', 0x7c: '▒', 0x7d: '│', 0x7e: 'π', 0x7f: '◥',
  0xa1: '▌', 0xa2: '▄', 0xa3: '▔', 0xa4: '▁', 0xa5: '▏', 0xa6: '▒', 0xa7: '▕', 0xa8: '▒',
  0xa9: '◤', 0xaa: '▕', 0xab: '├', 0xac: '▗', 0xad: '└', 0xae: '┐', 0xaf: '▂', 0xb0: '┌',
  0xb1: '┴', 0xb2: '┬', 0xb3: '┤', 0xb4: '▎', 0xb5: '▍', 0xb6: '▕', 0xb7: '▔', 0xb8: '▀',
  0xb9: '▃', 0xba: '✓', 0xbb: '▖', 0xbc: '▝', 0xbd: '┘', 0xbe: '▘', 0xbf: '▚',
};

function petsciiChar(b) {
  if (b === 0xa0) return ' ';
  if (b >= 0x20 && b <= 0x5a) return String.fromCharCode(b);
  if (b === 0x5b) return '[';
  if (b === 0x5c) return '£';
  if (b === 0x5d) return ']';
  if (b === 0x5e) return '↑';
  if (b === 0x5f) return '←';
  if (b >= 0xc0 && b <= 0xdf) return petsciiChar(b - 0x60);   // shifted letters → graphics range
  if (b >= 0xe0 && b <= 0xfe) return petsciiChar(b - 0x40);
  if (b === 0xff) return 'π';
  return GRAPHICS[b] ?? '·';
}
