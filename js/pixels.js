import { S } from './state.js';
import { hexToRgba, rgbaToHex } from './color.js';
import { symmetricPoints } from './brush.js';
import { canPaintInMode } from './c64/modes.js';

// ══════════════════════════════════════════════════════════════
//  Pixel operations
// ══════════════════════════════════════════════════════════════

export function initPixels(w, h, bg = 'transparent') {
  const p = new Uint8ClampedArray(w * h * 4);
  if (bg === 'white') {
    for (let i = 0; i < p.length; i += 4) { p[i]=p[i+1]=p[i+2]=255; p[i+3]=255; }
  } else if (bg === 'black') {
    for (let i = 3; i < p.length; i += 4) p[i] = 255;
  } else if (bg && bg.startsWith('#')) {
    const { r, g, b } = hexToRgba(bg);
    for (let i = 0; i < p.length; i += 4) { p[i]=r; p[i+1]=g; p[i+2]=b; p[i+3]=255; }
  }
  return p;
}

export function pixelIdx(x, y) { return (y * S.width + x) * 4; }

export function setPixel(x, y, r, g, b, a = 255) {
  if (x < 0 || x >= S.width || y < 0 || y >= S.height) return;
  // Respect layer lock — checked at the active-layer level
  if (S.layers[S.activeLayerIndex]?.locked) return;
  // Painting is clipped to the active selection
  if (S.selection && !S.selection.mask[y * S.width + x]) return;
  // C64 modes: respect the colour rules of the current graphics mode
  if (S.c64Mode && !canPaintInMode(x, y, r, g, b, a)) {
    S.c64Violation = true;
    return;
  }
  const i = pixelIdx(x, y);
  S.pixels[i]=r; S.pixels[i+1]=g; S.pixels[i+2]=b; S.pixels[i+3]=a;
}

export function getPixelRGBA(x, y) {
  if (x < 0 || x >= S.width || y < 0 || y >= S.height) return null;
  const i = pixelIdx(x, y);
  return [S.pixels[i], S.pixels[i+1], S.pixels[i+2], S.pixels[i+3]];
}

// Pixel-perfect pencil/eraser: removes the L-corner pixel when a diagonal step
// follows an orthogonal one, producing clean diagonal strokes.
export function paintPixelPerfect(x, y, r, g, b, a = 255) {
  if (S.pp2X >= 0 && S.pp1X >= 0) {
    const dxNew = Math.abs(x - S.pp2X);
    const dyNew = Math.abs(y - S.pp2Y);
    if (dxNew === 1 && dyNew === 1) {
      // x,y is diagonally adjacent to pp2; check if pp1 is the L-corner
      if ((S.pp1X === S.pp2X && S.pp1Y === y) || (S.pp1X === x && S.pp1Y === S.pp2Y)) {
        // Restore the L-corner pixel from pre-stroke snapshot
        const layer = S.layers[S.activeLayerIndex];
        if (S.preDragSnapshot && layer) {
          for (const [cx, cy] of symmetricPoints(S.pp1X, S.pp1Y)) {
            if (cx < 0 || cx >= S.width || cy < 0 || cy >= S.height) continue;
            const si = pixelIdx(cx, cy);
            layer.pixels[si]   = S.preDragSnapshot[si];
            layer.pixels[si+1] = S.preDragSnapshot[si+1];
            layer.pixels[si+2] = S.preDragSnapshot[si+2];
            layer.pixels[si+3] = S.preDragSnapshot[si+3];
          }
        }
        S.pp1X = S.pp2X; S.pp1Y = S.pp2Y;
      }
    }
  }
  for (const [sx, sy] of symmetricPoints(x, y)) setPixel(sx, sy, r, g, b, a);
  S.pp2X = S.pp1X; S.pp2Y = S.pp1Y;
  S.pp1X = x; S.pp1Y = y;
}
