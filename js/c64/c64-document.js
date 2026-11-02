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
import {
  MODES, currentMode, encodePages, enforcePages, joinPages, modeRuleText, pageCount, snapHeight, splitPages,
} from './modes.js';
import { createZip } from '../zip.js';
import { detectFormat, formatForMode } from './formats.js';
import { decodeNufli, encodeNufliRegion, newNufliMemory } from './nufli.js';

// ══════════════════════════════════════════════════════════════
//  C64 documents: open, load, export
// ══════════════════════════════════════════════════════════════

/**
 * Switch the editor to a C64 mode document built from an index buffer
 * (or one buffer per frame for interlaced modes) of any page-aligned height.
 */
export function openC64Document(modeId, indices, bgIdx, data = null, height = MODES[modeId].height) {
  const mode = MODES[modeId];
  S.c64Data    = data;
  S.c64Mode    = true;
  S.c64Format  = modeId;
  S.pixelAspect = mode.aspect;
  S.c64BgColor = rgbaToHex(...C64_PALETTE_RGB[bgIdx]);
  S.width      = mode.width;
  S.height     = height;
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

/** Empty document in a C64 mode; the height is snapped to the mode's steps. */
export function newC64Document(modeId, bgHex, height) {
  const mode = MODES[modeId];
  const bgIdx = c64IndexOfHex(bgHex);
  const h = snapHeight(mode, height);
  const empty = () => new Uint8Array(mode.width * h).fill(BG);
  let data = null;
  if (mode.id === 'nufli') {
    const mem = newNufliMemory(bgIdx);
    data = { pages: Array.from({ length: pageCount(mode, h) }, () => ({ mem: new Uint8Array(mem), extra: new Uint8Array(0) })) };
  } else if (mode.spriteColors) {
    data = { sprites: mode.spriteColors.map(() => bgIdx) };
  }
  openC64Document(modeId, mode.frames ? Array.from({ length: mode.frames }, empty) : empty(), bgIdx, data, h);
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
    for (const idx of mode.frames ? indices : [indices]) idx.forEach(c => count[c]++);
    bgIdx = count.slice(0, 16).indexOf(Math.max(...count.slice(0, 16)));
  }
  for (const idx of mode.frames ? indices : [indices])
    for (let i = 0; i < idx.length; i++) if (idx[i] === bgIdx) idx[i] = BG;
  openC64Document(format.mode, indices, bgIdx, modeData(mode, model));
  showToast(`Loaded ${name} — ${format.label} (${mode.label})`, 'success');
  return true;
}

/** Document state kept next to the pixels: NUFLI memory, super hires sprite colours. */
function modeData(mode, model) {
  if (mode.stateful) return { pages: [model] };
  if (mode.spriteColors) return { sprites: [...model.sprites] };
  return null;
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

/** Mode parameters for the encoders (super hires sprite colours). */
export const modeParams = () => S.c64Data?.sprites;

/**
 * Snap RGBA pixel buffers (one per drawing layer / frame) to the palette and
 * the colour rules of the current mode. Frames are enforced together.
 */
export function enforceModeRules(pixelsList) {
  const mode = currentMode();
  const bgIdx = c64IndexOfHex(S.c64BgColor);
  if (mode.id === 'nufli') {
    // Full re-encode into scratch copies of the memory images
    const target = solidIndices(pixelsList[0], bgIdx);
    const shown = nufliPages(target, bgIdx).map((page, i) => {
      const mem = new Uint8Array(S.c64Data.pages[i].mem);
      encodeNufliRegion(mem, page, new Float32Array(page.length).fill(1), FULL_RECT);
      return decodeNufli(mem);
    });
    return [indicesToPixels(withBg(joinPages(shown, 320, S.height, PAGE_H), bgIdx), bgIdx)];
  }
  const idxList = pixelsList.map(p => pixelsToIndices(p, S.width, S.height, bgIdx));
  const decoded = mode.frames
    ? enforcePages(mode, idxList, bgIdx, S.height, modeParams())
    : idxList.map(idx => enforcePages(mode, idx, bgIdx, S.height, modeParams()));
  return decoded.map(idx => indicesToPixels(idx, bgIdx));
}

/**
 * Save the picture in the native file format of the current mode: one file
 * per page of the mode's native height (the last page padded with
 * background). Several pages are downloaded as one ZIP.
 */
export function exportC64() {
  dropFloating();
  const mode = currentMode();
  if (!mode) return;
  const format = formatForMode(mode.id);
  if (!format) { showToast(`No file format for ${mode.label} yet`, 'error'); return; }
  if (S.width !== mode.width) { showToast(`${mode.label} requires a width of ${mode.width}`, 'error'); return; }
  const bgIdx = c64IndexOfHex(S.c64BgColor);
  const models = mode.stateful
    ? S.c64Data.pages
    : encodePages(mode, mode.frames ? frameIndices() : currentIndices(), bgIdx, S.height, modeParams());
  const files = models.map(m => format.write(m));
  if (files.length === 1) {
    download(files[0], `image.${format.ext}`, 'application/octet-stream');
    const padded = S.height < mode.height ? ` (${S.height} lines, padded to ${mode.height})` : '';
    showToast(`Exported as image.${format.ext}${padded}`, 'success');
    return;
  }
  const zipped = files.map((data, i) => ({ name: `image_${i + 1}.${format.ext}`, data }));
  download(createZip(zipped), `image_${format.ext}_${S.height}.zip`, 'application/zip');
  showToast(`Exported ${files.length} × ${format.label} pages (${S.height} lines) as ZIP`, 'success');
}

function download(bytes, name, type) {
  const a = document.createElement('a');
  a.download = name;
  a.href = URL.createObjectURL(new Blob([bytes], { type }));
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── NUFLI: re-encode after each edit ──────────────────────────

const PAGE_H = 200;
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

/** Split a NUFLI picture into 200-line pages (padding = background). */
const nufliPages = (idx, bgIdx, height = S.height) => splitPages(idx, 320, height, PAGE_H, bgIdx);

/**
 * Called by commitHistory before a snapshot is taken: fit the pixels that
 * changed since `prev` into the NUFLI memory images and show the result.
 */
export function afterC64Edit(prev) {
  const mode = currentMode();
  if (mode?.id !== 'nufli' || !S.c64Data || !prev) return;
  const li = S.layers.findIndex(l => !l.isBgLayer);
  const before = prev.layers.find(l => !l.isBgLayer)?.pixels;
  if (li < 0 || !before || before.length !== S.layers[li].pixels.length) return;

  const bgIdx = c64IndexOfHex(S.c64BgColor);
  const targets = nufliPages(solidIndices(S.layers[li].pixels, bgIdx), bgIdx);
  const olds = nufliPages(solidIndices(before, bgIdx), bgIdx);
  let changed = false, adjusted = 0;
  targets.forEach((target, i) => {
    const { weight, rect } = editWeights(target, olds[i]);
    if (!rect) return;
    changed = true;
    const mem = S.c64Data.pages[i].mem;
    encodeNufliRegion(mem, target, weight, rect);
    const rows = Math.min(PAGE_H, S.height - i * PAGE_H);
    const shown = decodeNufli(mem).subarray(0, rows * 320);
    for (let p = 0; p < shown.length; p++) if (shown[p] !== target[p]) adjusted++;
    S.layers[li].pixels.set(indicesToPixels(withBg(shown, bgIdx), bgIdx), i * PAGE_H * 320 * 4);
  });
  if (!changed) return;
  render();
  if (adjusted) showToast(`${adjusted} pixel${adjusted > 1 ? 's' : ''} adjusted — ${modeRuleText(mode)}`, 'error');
}

/** Encoder weights for one page: changed pixels are free, the others should stay. */
function editWeights(target, old) {
  const weight = new Float32Array(target.length);
  const rect = { x0: 320, y0: PAGE_H, x1: -1, y1: -1 };
  for (let p = 0; p < target.length; p++) {
    if (target[p] === old[p]) { weight[p] = KEEP_WEIGHT; continue; }
    weight[p] = 1;
    const x = p % 320, y = (p / 320) | 0;
    rect.x0 = Math.min(rect.x0, x); rect.x1 = Math.max(rect.x1, x);
    rect.y0 = Math.min(rect.y0, y); rect.y1 = Math.max(rect.y1, y);
  }
  return { weight, rect: rect.x1 < 0 ? null : rect };
}
