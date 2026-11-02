import { S } from './state.js';
import { getPixelRGBA, pixelIdx, setPixel } from './pixels.js';

// ══════════════════════════════════════════════════════════════
//  Drawing algorithms
// ══════════════════════════════════════════════════════════════

export function* linePixels(x0, y0, x1, y1) {
  let dx = Math.abs(x1-x0), sx = x0 < x1 ? 1 : -1;
  let dy = Math.abs(y1-y0), sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  for (;;) {
    yield { x: x0, y: y0 };
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2*err;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 <  dx) { err += dx; y0 += sy; }
  }
}

function* rectOutlinePixels(x0, y0, x1, y1) {
  const [mnX,mxX] = [Math.min(x0,x1), Math.max(x0,x1)];
  const [mnY,mxY] = [Math.min(y0,y1), Math.max(y0,y1)];
  for (let x = mnX; x <= mxX; x++) {
    yield { x, y: mnY };
    if (mxY !== mnY) yield { x, y: mxY };
  }
  for (let y = mnY+1; y < mxY; y++) {
    yield { x: mnX, y };
    if (mxX !== mnX) yield { x: mxX, y };
  }
}

function* rectFillPixels(x0, y0, x1, y1) {
  const [mnX,mxX] = [Math.min(x0,x1), Math.max(x0,x1)];
  const [mnY,mxY] = [Math.min(y0,y1), Math.max(y0,y1)];
  for (let y = mnY; y <= mxY; y++)
    for (let x = mnX; x <= mxX; x++)
      yield { x, y };
}

function* circleOutlinePixels(cx, cy, r) {
  if (r <= 0) { yield { x:cx, y:cy }; return; }
  let x = 0, y = r, d = 1 - r;
  function* pts(px, py) {
    const all = [[cx+px,cy+py],[cx-px,cy+py],[cx+px,cy-py],[cx-px,cy-py]];
    if (px !== py) all.push([cx+py,cy+px],[cx-py,cy+px],[cx+py,cy-px],[cx-py,cy-px]);
    for (const [sx,sy] of all) yield { x:sx, y:sy };
  }
  yield* pts(x, y);
  while (x < y) {
    x++;
    d += (d < 0) ? 2*x+1 : 2*(x - --y)+1;
    yield* pts(x, y);
  }
}

function* circleFillPixels(cx, cy, r) {
  if (r <= 0) { yield { x:cx, y:cy }; return; }
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++)
      if (dx*dx + dy*dy <= r*r)
        yield { x:cx+dx, y:cy+dy };
}

export function floodFill(sx, sy, r, g, b, a) {
  if (S.layers[S.activeLayerIndex]?.locked) return;
  const px = getPixelRGBA(sx, sy);
  if (!px) return;
  const [tr,tg,tb,ta] = px;
  if (tr===r && tg===g && tb===b && ta===a) return;

  const stack = [[sx,sy]];
  const visited = new Uint8Array(S.width * S.height);

  while (stack.length) {
    const [x,y] = stack.pop();
    if (x<0||x>=S.width||y<0||y>=S.height) continue;
    if (visited[y*S.width+x]) continue;
    if (S.selection && !S.selection.mask[y*S.width+x]) continue;
    const i = pixelIdx(x,y);
    if (S.pixels[i]!==tr||S.pixels[i+1]!==tg||S.pixels[i+2]!==tb||S.pixels[i+3]!==ta) continue;
    visited[y*S.width+x] = 1;
    S.pixels[i]=r; S.pixels[i+1]=g; S.pixels[i+2]=b; S.pixels[i+3]=a;
    stack.push([x+1,y],[x-1,y],[x,y+1],[x,y-1]);
  }
}

export function getShapeGenerator(tool, x0, y0, x1, y1) {
  switch (tool) {
    case 'line':        return linePixels(x0,y0,x1,y1);
    case 'rect':        return rectOutlinePixels(x0,y0,x1,y1);
    case 'rect-fill':   return rectFillPixels(x0,y0,x1,y1);
    case 'circle': {
      const r = Math.round(Math.hypot(x1-x0, y1-y0));
      return circleOutlinePixels(x0, y0, r);
    }
    case 'circle-fill': {
      const r = Math.round(Math.hypot(x1-x0, y1-y0));
      return circleFillPixels(x0, y0, r);
    }
    default: return [][Symbol.iterator]();
  }
}

/** Replace every pixel of the clicked colour on the active layer (all transparent pixels count as one colour). */
export function replaceColor(sx, sy, r, g, b, a) {
  if (S.layers[S.activeLayerIndex]?.locked) return;
  const px = getPixelRGBA(sx, sy);
  if (!px) return;
  const [tr, tg, tb, ta] = px;
  const matches = i => ta === 0
    ? S.pixels[i + 3] === 0
    : S.pixels[i] === tr && S.pixels[i + 1] === tg && S.pixels[i + 2] === tb && S.pixels[i + 3] === ta;
  for (let y = 0; y < S.height; y++)
    for (let x = 0; x < S.width; x++)
      if (matches(pixelIdx(x, y))) setPixel(x, y, r, g, b, a);
}
