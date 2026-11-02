import { C64_PALETTE_RGB } from '../constants.js';
import { S } from '../state.js';
import { off, offCtx } from '../dom.js';
import { rgbaToHex } from '../color.js';
import { snapshotLayers, updateUndoRedo } from '../history.js';
import { render, setupCanvases } from '../render.js';
import { fitZoom } from '../view.js';
import { updateCursorForLock } from '../input.js';
import { resetAdjPanel } from '../adjustments.js';
import { renderLayerPanel } from '../layer-panel.js';
import { updateSizeSelect } from '../document.js';
import { showToast } from '../toast.js';
import { dropFloating, resetSelection } from '../selection.js';
import { makeBgLayer, updateC64UI } from './c64-ui.js';
import { BG, c64IndexOfHex, indicesToPixels, pixelsToIndices } from './colors.js';
import { MODES, PAGE_HEIGHT, currentMode, encodePages, enforcePages, modeRuleText, tallHeight } from './modes.js';
import { createZip } from '../zip.js';
import { detectFormat, formatForMode } from './formats.js';
import { decodeNufli, emptyNufliMemory, encodeNufliRegion } from './nufli.js';

// ══════════════════════════════════════════════════════════════
//  C64 documents: open, load, export
// ══════════════════════════════════════════════════════════════

/**
 * Switch the editor to a C64 mode document built from an index buffer
 * (or one buffer per frame for interlaced modes).
 */
export function openC64Document(modeId, indices, bgIdx, data = null, height = MODES[modeId].height) {
  const mode = MODES[modeId];
  S.c64Data    = data;
  S.c64Mode    = true;
  S.c64Format  = modeId;
  S.pixelAspect = mode.aspect;
  S.c64BgColor = rgbaToHex(...C64_PALETTE_RGB[bgIdx]);
  S.width      = mode.width;
  S.height     = mode.tall ? tallHeight(height) : mode.height;
  S.layerIdCtr = 0;
  const frames = mode.frames ? indices : [indices];
  S.layers = [
    ...frames.map((idx, f) => ({
      id: ++S.layerIdCtr, name: mode.frames ? `Frame ${f + 1}` : 'Layer 1', pixels: indicesToPixels(idx, bgIdx),
      visible: true, locked: false, opacity: 100, isBgLayer: false,
      ...(mode.frames ? { frame: f + 1 } : {}),
    })),
    makeBgLayer(S.c64BgColor),
  ];
  S.activeLayerIndex = 0;
  resetSelection();
  S.history = [snapshotLayers()];
  S.historyIndex = 0;

  setupCanvases();
  fitZoom();
  render();
  renderLayerPanel();
  updateSizeSelect();
  resetAdjPanel();
  updateUndoRedo();
  updateCursorForLock();
  updateC64UI();
}

/** Empty document in a C64 mode (tall modes accept a height). */
export function newC64Document(modeId, bgHex, height) {
  const mode = MODES[modeId];
  const bgIdx = c64IndexOfHex(bgHex);
  if (modeId === 'nufli') {
    // No displayer code without a loaded file: editable, but not savable
    const data = { mem: emptyNufliMemory(), extra: new Uint8Array(0), template: false };
    fillNufliBackground(data.mem, bgIdx);
    openC64Document(modeId, new Uint8Array(mode.width * mode.height).fill(BG), bgIdx, data);
    return;
  }
  const h = mode.tall ? tallHeight(height) : mode.height;
  const empty = () => new Uint8Array(mode.width * h).fill(BG);
  openC64Document(modeId, mode.frames ? Array.from({ length: mode.frames }, empty) : empty(), bgIdx, null, h);
}

/** Decode a picture file; returns false if the format is not recognised. */
export function loadC64Bytes(bytes, name) {
  const format = detectFormat(bytes, name);
  if (!format) return false;
  const mode = MODES[format.mode];
  const model = format.read(bytes);
  const indices = mode.decode(model);
  let bgIdx = model.bg;
  if (bgIdx === undefined) {
    // Modes without a global background: use the most frequent colour as "background"
    const count = new Array(17).fill(0);
    indices.forEach(c => count[c]++);
    bgIdx = count.slice(0, 16).indexOf(Math.max(...count.slice(0, 16)));
  }
  for (const idx of mode.frames ? indices : [indices])
    for (let i = 0; i < idx.length; i++) if (idx[i] === bgIdx) idx[i] = BG;
  openC64Document(format.mode, indices, bgIdx, mode.stateful ? model : null);
  showToast(`Loaded ${name} — ${format.label} (${mode.label})`, 'success');
  return true;
}

/** Composite of all visible layers at native resolution. */
function compositePixels() {
  const tmp = document.createElement('canvas');
  tmp.width = S.width; tmp.height = S.height;
  const ctx = tmp.getContext('2d');
  for (let i = S.layers.length - 1; i >= 0; i--) {
    const layer = S.layers[i];
    if (!layer.visible) continue;
    offCtx.putImageData(new ImageData(new Uint8ClampedArray(layer.pixels), S.width, S.height), 0, 0);
    ctx.save(); ctx.globalAlpha = layer.opacity / 100;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0); ctx.restore();
  }
  return ctx.getImageData(0, 0, S.width, S.height).data;
}

/** Index buffer of the current picture (BG for background). */
export function currentIndices() {
  return pixelsToIndices(compositePixels(), S.width, S.height, c64IndexOfHex(S.c64BgColor));
}

/** Index buffers of the frame layers of an interlaced document, frame 1 first. */
export function frameIndices() {
  const bgIdx = c64IndexOfHex(S.c64BgColor);
  return S.layers.filter(l => l.frame).sort((a, b) => a.frame - b.frame)
    .map(l => pixelsToIndices(l.pixels, S.width, S.height, bgIdx));
}

/**
 * Snap RGBA pixel buffers (one per drawing layer / frame) to the palette and
 * the colour rules of the current mode. Frames are enforced together.
 */
export function enforceModeRules(pixelsList) {
  const mode = currentMode();
  const bgIdx = c64IndexOfHex(S.c64BgColor);
  if (mode.id === 'nufli') {
    // Full re-encode into a scratch copy of the memory image
    const mem = new Uint8Array(S.c64Data.mem);
    const target = solidIndices(pixelsList[0], bgIdx);
    encodeNufliRegion(mem, target, new Float32Array(target.length).fill(1), FULL_RECT);
    return [indicesToPixels(withBg(decodeNufli(mem), bgIdx), bgIdx)];
  }
  const idxList = pixelsList.map(p => pixelsToIndices(p, S.width, S.height, bgIdx));
  const decoded = mode.frames
    ? mode.decode(mode.encode(idxList, bgIdx))
    : idxList.map(idx => (mode.tall ? enforcePages(mode, idx, bgIdx, S.height) : mode.decode(mode.encode(idx, bgIdx))));
  return decoded.map(idx => indicesToPixels(idx, bgIdx));
}

/** Save the picture in the native file format of the current mode. */
export function exportC64() {
  dropFloating();
  const mode = currentMode();
  if (!mode) return;
  const format = formatForMode(mode.id);
  if (!format) { showToast(`No file format for ${mode.label} yet`, 'error'); return; }
  if (S.width !== mode.width || (!mode.tall && S.height !== mode.height)) {
    showToast(`${mode.label} requires ${mode.width}×${mode.height}`, 'error'); return;
  }
  if (mode.tall && S.height !== PAGE_HEIGHT) { exportPages(mode, format); return; }
  const bgIdx = c64IndexOfHex(S.c64BgColor);
  if (mode.stateful && !S.c64Data?.template) {
    showToast(`${mode.label} can only be saved for pictures loaded from a .nuf/.nup file`, 'error'); return;
  }
  const model = mode.stateful ? S.c64Data : mode.encode(mode.frames ? frameIndices() : currentIndices(), bgIdx);
  const bytes = format.write(model);
  const name = `image.${format.ext}`;
  const a = document.createElement('a');
  a.download = name;
  a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  a.click();
  URL.revokeObjectURL(a.href);
  showToast(`Exported as ${name}`, 'success');
}

/**
 * Tall FLI/AFLI pictures: one standard file per 200-line page (the last page
 * padded with background). Several pages are downloaded as one ZIP.
 */
function exportPages(mode, format) {
  const bgIdx = c64IndexOfHex(S.c64BgColor);
  const pages = encodePages(mode, currentIndices(), bgIdx, S.height).map(m => format.write(m));
  if (pages.length === 1) {
    download(pages[0], `image.${format.ext}`, 'application/octet-stream');
    showToast(`Exported as image.${format.ext} (${S.height} lines, padded to ${PAGE_HEIGHT})`, 'success');
    return;
  }
  const files = pages.map((data, i) => ({ name: `image_${i + 1}.${format.ext}`, data }));
  download(createZip(files), `image_${format.ext}_${S.height}.zip`, 'application/zip');
  showToast(`Exported ${pages.length} × ${format.label} pages (${S.height} lines) as ZIP`, 'success');
}

function download(bytes, name, type) {
  const a = document.createElement('a');
  a.download = name;
  a.href = URL.createObjectURL(new Blob([bytes], { type }));
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── NUFLI: re-encode after each edit ──────────────────────────

const FULL_RECT = { x0: 0, y0: 0, x1: 319, y1: 199 };
const KEEP_WEIGHT = 1000;   // existing pixels: keep unless impossible

/** RGBA → palette indices with the background as a real colour. */
function solidIndices(pixels, bgIdx) {
  const idx = pixelsToIndices(pixels, S.width, S.height, bgIdx);
  for (let i = 0; i < idx.length; i++) if (idx[i] === BG) idx[i] = bgIdx;
  return idx;
}

function withBg(idx, bgIdx) {
  for (let i = 0; i < idx.length; i++) if (idx[i] === bgIdx) idx[i] = BG;
  return idx;
}

function fillNufliBackground(mem, bgIdx) {
  // bug-area sprite colours = background, so the FLI-bug strip blends in
  for (const addr of [0x3ff0, 0x3ff1, 0x3ff6, 0x3ff7]) mem[addr - 0x2000] = bgIdx;
  const target = new Uint8Array(320 * 200).fill(bgIdx);
  encodeNufliRegion(mem, target, new Float32Array(target.length).fill(1), FULL_RECT);
}

/**
 * Called by commitHistory before a snapshot is taken: fit the pixels that
 * changed since `prev` into the NUFLI memory image and show the result.
 */
export function afterC64Edit(prev) {
  const mode = currentMode();
  if (mode?.id !== 'nufli' || !S.c64Data || !prev) return;
  const li = S.layers.findIndex(l => !l.isBgLayer);
  const before = prev.layers.find(l => !l.isBgLayer)?.pixels;
  if (li < 0 || !before || before.length !== S.layers[li].pixels.length) return;

  const bgIdx = c64IndexOfHex(S.c64BgColor);
  const target = solidIndices(S.layers[li].pixels, bgIdx);
  const old = solidIndices(before, bgIdx);
  const weight = new Float32Array(target.length);
  const rect = { x0: 320, y0: 200, x1: -1, y1: -1 };
  for (let p = 0; p < target.length; p++) {
    if (target[p] === old[p]) { weight[p] = KEEP_WEIGHT; continue; }
    weight[p] = 1;
    const x = p % 320, y = (p / 320) | 0;
    rect.x0 = Math.min(rect.x0, x); rect.x1 = Math.max(rect.x1, x);
    rect.y0 = Math.min(rect.y0, y); rect.y1 = Math.max(rect.y1, y);
  }
  if (rect.x1 < 0) return;

  encodeNufliRegion(S.c64Data.mem, target, weight, rect);
  const shown = decodeNufli(S.c64Data.mem);
  let adjusted = 0;
  for (let p = 0; p < shown.length; p++) if (shown[p] !== target[p]) adjusted++;
  S.layers[li].pixels.set(indicesToPixels(withBg(shown, bgIdx), bgIdx));
  render();
  if (adjusted) showToast(`${adjusted} pixel${adjusted > 1 ? 's' : ''} adjusted — ${modeRuleText(mode)}`, 'error');
}
