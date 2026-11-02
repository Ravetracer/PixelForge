// ══════════════════════════════════════════════════════════════
//  Colour utilities
// ══════════════════════════════════════════════════════════════

export function hexToRgba(hex) {
  const v = hex.replace('#', '');
  const full = v.length === 3 ? v.split('').map(c => c+c).join('') : v;
  return {
    r: parseInt(full.slice(0,2), 16),
    g: parseInt(full.slice(2,4), 16),
    b: parseInt(full.slice(4,6), 16),
    a: 255,
  };
}

export function rgbaToHex(r, g, b) {
  return '#' + [r, g, b].map(n => n.toString(16).padStart(2,'0')).join('');
}

export function isValidHex(h) { return /^#[0-9a-fA-F]{6}$/.test(h); }
