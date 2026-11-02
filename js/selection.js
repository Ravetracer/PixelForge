import { S } from './state.js';
import { $, canvasContainer, selCanvas, selCtx } from './dom.js';
import { setPixel } from './pixels.js';
import { commitHistory } from './history.js';
import { linePixels } from './draw-algorithms.js';
import { render } from './render.js';
import { nearestC64Color } from './c64/colors.js';
import { currentMode, modeRuleText } from './c64/modes.js';
import { C64_PALETTE_RGB } from './constants.js';
import { showToast } from './toast.js';

// ══════════════════════════════════════════════════════════════
//  Selection model
//
//  S.selection — { mask: Uint8Array(width*height) } or null.
//  S.floating  — pixels lifted off the active layer (move, paste,
//                transform) that are not yet written back:
//                { layerId, x, y, w, h, pixels, mask, origin, prevSelection }
//                While floating, the selection is the float's mask at (x, y).
// ══════════════════════════════════════════════════════════════

const ANTS_FRAME_MS = 120;

let _antsOffset = 0;
let _antsRafId  = 0;
let _antsLastTs = 0;
let _outlineCache = null;   // { key, path }
let _draft = null;          // in-progress marquee/lasso drawn with the ants
let _clipboard = null;      // { w, h, pixels, x, y }
let _clipboardWriteFailed = false;

// ── Mask helpers ──────────────────────────────────────────────

function activeLayer() { return S.layers[S.activeLayerIndex] ?? null; }

function validSelection() {
  if (S.selection && S.selection.mask.length !== S.width * S.height) S.selection = null;
  return S.selection;
}

export function hasSelection() {
  return !!(S.floating || validSelection());
}

export function isSelected(x, y) {
  const f = S.floating;
  if (f) {
    const lx = x - f.x, ly = y - f.y;
    return lx >= 0 && ly >= 0 && lx < f.w && ly < f.h && f.mask[ly * f.w + lx] === 1;
  }
  const sel = validSelection();
  return !sel || sel.mask[y * S.width + x] === 1;
}

function maskBounds(mask, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (!mask[row + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Combine a new mask into the current selection ('replace' | 'add' | 'subtract'). */
function applyMask(mask, mode) {
  const cur = validSelection();
  if (mode === 'add' && cur) {
    for (let i = 0; i < mask.length; i++) mask[i] |= cur.mask[i];
  } else if (mode === 'subtract') {
    if (!cur) return;
    const out = new Uint8Array(cur.mask);
    for (let i = 0; i < mask.length; i++) if (mask[i]) out[i] = 0;
    mask = out;
  }
  S.selection = mask.some(v => v) ? { mask } : null;
  selectionChanged();
}

function selectionChanged() {
  _outlineCache = null;
  renderSelection();
  startAnts();
}

// ── Selection creation ────────────────────────────────────────

export function selectRect(x0, y0, x1, y1, mode) {
  const mask = new Uint8Array(S.width * S.height);
  const ax = Math.max(0, Math.min(x0, x1)), bx = Math.min(S.width - 1, Math.max(x0, x1));
  const ay = Math.max(0, Math.min(y0, y1)), by = Math.min(S.height - 1, Math.max(y0, y1));
  for (let y = ay; y <= by; y++) mask.fill(1, y * S.width + ax, y * S.width + bx + 1);
  applyMask(mask, mode);
}

/** Even-odd polygon fill sampled at pixel centres, plus the outline itself. */
export function selectPolygon(points, mode) {
  const W = S.width, H = S.height;
  const mask = new Uint8Array(W * H);
  const n = points.length;
  for (let y = 0; y < H; y++) {
    const yc = y + 0.5;
    const xs = [];
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const a = points[i], b = points[j];
      const ay = a.y + 0.5, by = b.y + 0.5;
      if ((ay > yc) !== (by > yc)) xs.push(a.x + 0.5 + (yc - ay) * (b.x - a.x) / (by - ay));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil(xs[k] - 0.5));
      const to   = Math.min(W - 1, Math.floor(xs[k + 1] - 0.5));
      if (to >= from) mask.fill(1, y * W + from, y * W + to + 1);
    }
  }
  for (let i = 0; i < n; i++) {
    const a = points[i], b = points[(i + 1) % n];
    for (const p of linePixels(a.x, a.y, b.x, b.y))
      if (p.x >= 0 && p.y >= 0 && p.x < W && p.y < H) mask[p.y * W + p.x] = 1;
  }
  applyMask(mask, mode);
}

/** Magic wand: exact colour match on the active layer (all transparent pixels match each other). */
export function selectWand(sx, sy, mode, contiguous) {
  const layer = activeLayer();
  if (!layer) return;
  const W = S.width, H = S.height, px = layer.pixels;
  const si = (sy * W + sx) * 4;
  const target = [px[si], px[si + 1], px[si + 2], px[si + 3]];
  const matches = i => target[3] === 0
    ? px[i + 3] === 0
    : px[i] === target[0] && px[i + 1] === target[1] && px[i + 2] === target[2] && px[i + 3] === target[3];
  const mask = new Uint8Array(W * H);

  if (!contiguous) {
    for (let p = 0; p < W * H; p++) if (matches(p * 4)) mask[p] = 1;
  } else {
    const stack = [sy * W + sx];
    while (stack.length) {
      const p = stack.pop();
      if (mask[p] || !matches(p * 4)) continue;
      mask[p] = 1;
      const x = p % W;
      if (x > 0)     stack.push(p - 1);
      if (x < W - 1) stack.push(p + 1);
      if (p >= W)    stack.push(p - W);
      if (p < W * (H - 1)) stack.push(p + W);
    }
  }
  applyMask(mask, mode);
}

export function selectAll() {
  dropFloating();
  applyMask(new Uint8Array(S.width * S.height).fill(1), 'replace');
}

export function deselect() {
  dropFloating();
  S.selection = null;
  selectionChanged();
}

export function invertSelection() {
  dropFloating();
  const cur = validSelection();
  const mask = new Uint8Array(S.width * S.height);
  for (let i = 0; i < mask.length; i++) mask[i] = cur && cur.mask[i] ? 0 : 1;
  applyMask(mask, 'replace');
}

/** Drop selection and floating pixels without writing anything (new document, load, …). */
export function resetSelection() {
  S.selection = null;
  S.floating = null;
  _draft = null;
  selectionChanged();
}

// ── Floating pixels ───────────────────────────────────────────

/**
 * Lift the selected pixels (or the whole layer when nothing is selected)
 * off the active layer into a floating buffer.
 * @param {boolean} copy  keep the source pixels in place (duplicate instead of cut)
 * @returns {boolean} true when something is floating afterwards
 */
export function liftSelection(copy = false) {
  if (S.floating) return true;
  const layer = activeLayer();
  if (!layer) return false;
  if (layer.locked) { showToast('Layer is locked', 'error'); return false; }

  const W = S.width;
  const sel = validSelection();
  const selMask = sel ? sel.mask : new Uint8Array(W * S.height).fill(1);
  const b = maskBounds(selMask, W, S.height);
  if (!b) return false;

  const origin = new Uint8ClampedArray(layer.pixels);
  const pixels = new Uint8ClampedArray(b.w * b.h * 4);
  const mask   = new Uint8Array(b.w * b.h);
  for (let y = 0; y < b.h; y++) {
    for (let x = 0; x < b.w; x++) {
      const p = (b.y + y) * W + (b.x + x);
      if (!selMask[p]) continue;
      const li = p * 4, fi = (y * b.w + x) * 4;
      pixels.set(layer.pixels.subarray(li, li + 4), fi);
      mask[y * b.w + x] = 1;
      if (!copy) layer.pixels.fill(0, li, li + 4);
    }
  }
  S.floating = { layerId: layer.id, x: b.x, y: b.y, w: b.w, h: b.h, pixels, mask, origin, prevSelection: sel };
  S.selection = null;
  selectionChanged();
  return true;
}

/** Write floating pixels back into their layer and keep them selected. */
export function dropFloating() {
  const f = S.floating;
  if (!f) return;
  S.floating = null;
  const layerIndex = S.layers.findIndex(l => l.id === f.layerId);
  if (layerIndex < 0) { selectionChanged(); return; }
  if (S.layers[layerIndex].locked) {
    S.floating = f;
    cancelFloating();
    showToast('Layer is locked — move cancelled', 'error');
    return;
  }

  // setPixel writes to the active layer and respects layer lock + C64 tile rules
  const prevActive = S.activeLayerIndex;
  S.activeLayerIndex = layerIndex;
  S.selection = null;
  S.c64Violation = false;
  const W = S.width, H = S.height;
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < f.h; y++) {
    const dy = f.y + y;
    if (dy < 0 || dy >= H) continue;
    for (let x = 0; x < f.w; x++) {
      const dx = f.x + x;
      if (dx < 0 || dx >= W || !f.mask[y * f.w + x]) continue;
      mask[dy * W + dx] = 1;
      const i = (y * f.w + x) * 4;
      if (f.pixels[i + 3] > 0) setPixel(dx, dy, f.pixels[i], f.pixels[i + 1], f.pixels[i + 2], f.pixels[i + 3]);
    }
  }
  S.activeLayerIndex = prevActive;
  S.selection = mask.some(v => v) ? { mask } : null;

  if (S.c64Mode && S.c64Violation) {
    showToast(`Some pixels skipped — ${modeRuleText(currentMode())}`, 'error');
    S.c64Violation = false;
  }
  const pixels = S.layers[layerIndex].pixels;
  if (pixels.some((v, i) => v !== f.origin[i])) commitHistory();
  render();
  selectionChanged();
}

/** Undo for floating pixels: put everything back where it was. */
export function cancelFloating() {
  const f = S.floating;
  if (!f) return false;
  S.floating = null;
  const layer = S.layers.find(l => l.id === f.layerId);
  if (layer) layer.pixels.set(f.origin);
  S.selection = f.prevSelection;
  render();
  selectionChanged();
  return true;
}

export function moveFloating(dx, dy) {
  if (!liftSelection()) return;
  S.floating.x += dx;
  S.floating.y += dy;
  render();
  renderSelection();
}

/** Composite floating pixels into a copy of the layer, used by every renderer. */
export function layerPixelsForDisplay(layer) {
  const f = S.floating;
  if (!f || f.layerId !== layer.id) return layer.pixels;
  const out = new Uint8ClampedArray(layer.pixels);
  const W = S.width, H = S.height;
  for (let y = 0; y < f.h; y++) {
    const dy = f.y + y;
    if (dy < 0 || dy >= H) continue;
    for (let x = 0; x < f.w; x++) {
      const dx = f.x + x;
      const fi = (y * f.w + x) * 4;
      if (dx < 0 || dx >= W || !f.mask[y * f.w + x] || f.pixels[fi + 3] === 0) continue;
      out.set(f.pixels.subarray(fi, fi + 4), (dy * W + dx) * 4);
    }
  }
  return out;
}

// ── Transforms ────────────────────────────────────────────────

function remapFloating(newW, newH, srcOf) {
  const f = S.floating;
  const pixels = new Uint8ClampedArray(newW * newH * 4);
  const mask = new Uint8Array(newW * newH);
  for (let y = 0; y < newH; y++) {
    for (let x = 0; x < newW; x++) {
      const [sx, sy] = srcOf(x, y);
      const s = sy * f.w + sx, d = y * newW + x;
      mask[d] = f.mask[s];
      pixels.set(f.pixels.subarray(s * 4, s * 4 + 4), d * 4);
    }
  }
  // keep the centre in place
  f.x += Math.floor((f.w - newW) / 2);
  f.y += Math.floor((f.h - newH) / 2);
  Object.assign(f, { w: newW, h: newH, pixels, mask });
}

/**
 * Flip or rotate the selection. Without a selection the whole active
 * layer is transformed and written back immediately.
 * @param {'flipH'|'flipV'|'rotCW'|'rotCCW'|'rot180'} op
 */
export function transformSelection(op) {
  const wholeLayer = !hasSelection();
  if (!liftSelection()) return;
  const { w, h } = S.floating;
  switch (op) {
    case 'flipH':  remapFloating(w, h, (x, y) => [w - 1 - x, y]); break;
    case 'flipV':  remapFloating(w, h, (x, y) => [x, h - 1 - y]); break;
    case 'rot180': remapFloating(w, h, (x, y) => [w - 1 - x, h - 1 - y]); break;
    case 'rotCW':  remapFloating(h, w, (x, y) => [y, h - 1 - x]); break;
    case 'rotCCW': remapFloating(h, w, (x, y) => [w - 1 - y, x]); break;
  }
  if (wholeLayer) {
    dropFloating();
    S.selection = null;
    selectionChanged();
  } else {
    render();
    selectionChanged();
  }
}

/** Clear the selected pixels (or discard the floating pixels). */
export function deleteSelection() {
  const layer = activeLayer();
  if (!layer || !hasSelection()) return;
  if (layer.locked) { showToast('Layer is locked', 'error'); return; }
  if (S.floating) {
    // Floating pixels were lifted (cut) already — discarding them is the delete.
    S.floating.pixels.fill(0);
    dropFloating();
    return;
  }
  const mask = S.selection.mask;
  let changed = false;
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p] || layer.pixels[p * 4 + 3] === 0) continue;
    layer.pixels.fill(0, p * 4, p * 4 + 4);
    changed = true;
  }
  if (changed) { commitHistory(); render(); }
}

// ── Clipboard ─────────────────────────────────────────────────

function currentSelectionImage() {
  const f = S.floating;
  if (f) {
    const pixels = new Uint8ClampedArray(f.pixels);
    for (let p = 0; p < f.mask.length; p++) if (!f.mask[p]) pixels.fill(0, p * 4, p * 4 + 4);
    return { w: f.w, h: f.h, pixels, x: f.x, y: f.y };
  }
  const layer = activeLayer();
  if (!layer) return null;
  const W = S.width;
  const sel = validSelection();
  const selMask = sel ? sel.mask : new Uint8Array(W * S.height).fill(1);
  const b = maskBounds(selMask, W, S.height);
  if (!b) return null;
  const pixels = new Uint8ClampedArray(b.w * b.h * 4);
  for (let y = 0; y < b.h; y++)
    for (let x = 0; x < b.w; x++) {
      const p = (b.y + y) * W + b.x + x;
      if (selMask[p]) pixels.set(layer.pixels.subarray(p * 4, p * 4 + 4), (y * b.w + x) * 4);
    }
  return { w: b.w, h: b.h, pixels, x: b.x, y: b.y };
}

function imageToPngBlob(img) {
  const c = document.createElement('canvas');
  c.width = img.w; c.height = img.h;
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(img.pixels), img.w, img.h), 0, 0);
  return new Promise(resolve => c.toBlob(resolve, 'image/png'));
}

export async function copySelection() {
  const img = currentSelectionImage();
  if (!img) return false;
  _clipboard = img;
  _clipboardWriteFailed = false;
  showToast(`Copied ${img.w}×${img.h}`, 'success');
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': imageToPngBlob(img) })]);
  } catch {
    // No permission / unsupported: the internal clipboard still works inside PixelForge.
    _clipboardWriteFailed = true;
  }
  return true;
}

export async function cutSelection() {
  const layer = activeLayer();
  if (layer?.locked) { showToast('Layer is locked', 'error'); return; }
  if (await copySelection()) deleteSelection();
}

/** Visible viewport centre in image coordinates. */
function viewportCenter() {
  const xScale = S.zoom * S.pixelAspect;
  const wrap = $('canvas-wrapper');
  const cx = canvasContainer.scrollLeft + canvasContainer.clientWidth / 2 - wrap.offsetLeft;
  const cy = canvasContainer.scrollTop + canvasContainer.clientHeight / 2 - wrap.offsetTop;
  return {
    x: Math.max(0, Math.min(S.width - 1, Math.floor(cx / xScale))),
    y: Math.max(0, Math.min(S.height - 1, Math.floor(cy / S.zoom))),
  };
}

/** Paste an image as floating pixels on the active layer. */
export function pasteImage(img) {
  const layer = activeLayer();
  if (!layer) return;
  if (layer.locked) { showToast('Layer is locked', 'error'); return; }
  dropFloating();

  let { x, y } = img;
  if (x === undefined || x + img.w > S.width || y + img.h > S.height) {
    const c = viewportCenter();
    x = Math.max(0, Math.min(c.x - Math.floor(img.w / 2), S.width - img.w));
    y = Math.max(0, Math.min(c.y - Math.floor(img.h / 2), S.height - img.h));
  }
  const pixels = new Uint8ClampedArray(img.pixels);
  if (S.c64Mode) {
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] === 0) continue;
      const [r, g, b] = C64_PALETTE_RGB[nearestC64Color(pixels[i], pixels[i + 1], pixels[i + 2])];
      pixels[i] = r; pixels[i + 1] = g; pixels[i + 2] = b; pixels[i + 3] = 255;
    }
  }
  S.floating = {
    layerId: layer.id, x, y, w: img.w, h: img.h, pixels,
    mask: new Uint8Array(img.w * img.h).fill(1),
    origin: new Uint8ClampedArray(layer.pixels),
    prevSelection: validSelection(),
  };
  S.selection = null;
  document.querySelector('.tool-btn[data-tool="move"]')?.click();
  render();
  selectionChanged();
}

function decodeImageFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      resolve({ w: img.width, h: img.height, pixels: ctx.getImageData(0, 0, img.width, img.height).data });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Unreadable image')); };
    img.src = url;
  });
}

/** Handler for the document 'paste' event: system clipboard image first, internal buffer as fallback. */
export async function handlePasteEvent(e) {
  const item = [...(e.clipboardData?.items ?? [])].find(i => i.type.startsWith('image/'));
  if (item && !_clipboardWriteFailed) {
    e.preventDefault();
    try {
      const img = await decodeImageFile(item.getAsFile());
      // Same image we copied ourselves → keep its original position.
      if (_clipboard && _clipboard.w === img.w && _clipboard.h === img.h) { img.x = _clipboard.x; img.y = _clipboard.y; }
      pasteImage(img);
    } catch (err) {
      showToast('Could not paste image: ' + err.message, 'error');
    }
    return;
  }
  if (_clipboard) { e.preventDefault(); pasteImage(_clipboard); }
}

// ── Marching ants ─────────────────────────────────────────────

function outlinePath(mask, w, h, ox, oy, xs, ys) {
  const path = new Path2D();
  const at = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
  // horizontal edges
  for (let y = 0; y <= h; y++) {
    let start = -1;
    for (let x = 0; x <= w; x++) {
      const edge = x < w && at(x, y) !== at(x, y - 1);
      if (edge && start < 0) start = x;
      if (!edge && start >= 0) {
        path.moveTo((ox + start) * xs + 0.5, (oy + y) * ys + 0.5);
        path.lineTo((ox + x) * xs + 0.5, (oy + y) * ys + 0.5);
        start = -1;
      }
    }
  }
  // vertical edges
  for (let x = 0; x <= w; x++) {
    let start = -1;
    for (let y = 0; y <= h; y++) {
      const edge = y < h && at(x, y) !== at(x - 1, y);
      if (edge && start < 0) start = y;
      if (!edge && start >= 0) {
        path.moveTo((ox + x) * xs + 0.5, (oy + start) * ys + 0.5);
        path.lineTo((ox + x) * xs + 0.5, (oy + y) * ys + 0.5);
        start = -1;
      }
    }
  }
  return path;
}

function selectionOutline() {
  const xs = S.zoom * S.pixelAspect, ys = S.zoom;
  const f = S.floating, sel = validSelection();
  if (!f && !sel) return null;
  const key = f ? `f:${f.x},${f.y},${f.w},${f.h},${xs}` : `s:${xs}:${S.width}x${S.height}`;
  if (_outlineCache?.key === key && _outlineCache.src === (f ?? sel)) return _outlineCache.path;
  const path = f
    ? outlinePath(f.mask, f.w, f.h, f.x, f.y, xs, ys)
    : outlinePath(sel.mask, S.width, S.height, 0, 0, xs, ys);
  _outlineCache = { key, src: f ?? sel, path };
  return path;
}

function strokeAnts(path) {
  selCtx.save();
  selCtx.lineWidth = 1;
  selCtx.strokeStyle = 'rgba(255,255,255,0.95)';
  selCtx.setLineDash([]);
  selCtx.stroke(path);
  selCtx.strokeStyle = 'rgba(0,0,0,0.95)';
  selCtx.setLineDash([4, 4]);
  selCtx.lineDashOffset = -_antsOffset;
  selCtx.stroke(path);
  selCtx.restore();
}

/** Show an in-progress marquee/lasso ({type:'rect', x0,y0,x1,y1} | {type:'lasso', pts}). */
export function setSelectionDraft(draft) {
  _draft = draft;
  renderSelection();
  startAnts();
}

function draftPath() {
  if (!_draft) return null;
  const xs = S.zoom * S.pixelAspect, ys = S.zoom;
  const path = new Path2D();
  if (_draft.type === 'rect') {
    const x = Math.min(_draft.x0, _draft.x1), y = Math.min(_draft.y0, _draft.y1);
    const w = Math.abs(_draft.x1 - _draft.x0) + 1, h = Math.abs(_draft.y1 - _draft.y0) + 1;
    path.rect(x * xs + 0.5, y * ys + 0.5, w * xs, h * ys);
  } else {
    _draft.pts.forEach((p, i) => {
      const px = (p.x + 0.5) * xs, py = (p.y + 0.5) * ys;
      i ? path.lineTo(px, py) : path.moveTo(px, py);
    });
    path.closePath();
  }
  return path;
}

function selectionStatusText() {
  if (_draft?.type === 'rect')
    return `${Math.abs(_draft.x1 - _draft.x0) + 1}×${Math.abs(_draft.y1 - _draft.y0) + 1} sel`;
  if (S.floating) return `${S.floating.w}×${S.floating.h} @ ${S.floating.x},${S.floating.y}`;
  const sel = validSelection();
  if (!sel) return '';
  const b = maskBounds(sel.mask, S.width, S.height);
  return b ? `${b.w}×${b.h} sel` : '';
}

export function renderSelection() {
  if (selCanvas.width !== $('preview-canvas').width || selCanvas.height !== $('preview-canvas').height) {
    selCanvas.width = $('preview-canvas').width;
    selCanvas.height = $('preview-canvas').height;
    _outlineCache = null;
  }
  selCtx.clearRect(0, 0, selCanvas.width, selCanvas.height);
  drawMirrorGuides();
  const path = selectionOutline();
  if (path) strokeAnts(path);
  const dp = draftPath();
  if (dp) strokeAnts(dp);
  const status = $('status-sel');
  if (status) status.textContent = selectionStatusText();
}

function drawMirrorGuides() {
  if (!S.mirrorX && !S.mirrorY) return;
  selCtx.save();
  selCtx.strokeStyle = 'rgba(203,166,247,0.85)';
  selCtx.lineWidth = 1;
  selCtx.setLineDash([6, 4]);
  selCtx.beginPath();
  if (S.mirrorX) { const x = Math.round(selCanvas.width / 2) + 0.5; selCtx.moveTo(x, 0); selCtx.lineTo(x, selCanvas.height); }
  if (S.mirrorY) { const y = Math.round(selCanvas.height / 2) + 0.5; selCtx.moveTo(0, y); selCtx.lineTo(selCanvas.width, y); }
  selCtx.stroke();
  selCtx.restore();
}

function antsFrame(ts) {
  if (!hasSelection() && !_draft) { _antsRafId = 0; renderSelection(); return; }
  if (ts - _antsLastTs >= ANTS_FRAME_MS) {
    _antsLastTs = ts;
    _antsOffset = (_antsOffset + 1) % 8;
    renderSelection();
  }
  _antsRafId = requestAnimationFrame(antsFrame);
}

function startAnts() {
  if (!_antsRafId) _antsRafId = requestAnimationFrame(antsFrame);
}
