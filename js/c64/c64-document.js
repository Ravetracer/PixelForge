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
import { MODES, currentMode } from './modes.js';
import { detectFormat, formatForMode } from './formats.js';

// ══════════════════════════════════════════════════════════════
//  C64 documents: open, load, export
// ══════════════════════════════════════════════════════════════

/**
 * Switch the editor to a C64 mode document built from an index buffer
 * (or one buffer per frame for interlaced modes).
 */
export function openC64Document(modeId, indices, bgIdx) {
  const mode = MODES[modeId];
  S.c64Mode    = true;
  S.c64Format  = modeId;
  S.pixelAspect = mode.aspect;
  S.c64BgColor = rgbaToHex(...C64_PALETTE_RGB[bgIdx]);
  S.width      = mode.width;
  S.height     = mode.height;
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

/** Empty document in a C64 mode. */
export function newC64Document(modeId, bgHex) {
  const mode = MODES[modeId];
  const empty = () => new Uint8Array(mode.width * mode.height).fill(BG);
  openC64Document(modeId, mode.frames ? Array.from({ length: mode.frames }, empty) : empty(), c64IndexOfHex(bgHex));
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
  openC64Document(format.mode, indices, bgIdx);
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
  const idxList = pixelsList.map(p => pixelsToIndices(p, S.width, S.height, bgIdx));
  const decoded = mode.frames
    ? mode.decode(mode.encode(idxList, bgIdx))
    : idxList.map(idx => mode.decode(mode.encode(idx, bgIdx)));
  return decoded.map(idx => indicesToPixels(idx, bgIdx));
}

/** Save the picture in the native file format of the current mode. */
export function exportC64() {
  dropFloating();
  const mode = currentMode();
  if (!mode) return;
  const format = formatForMode(mode.id);
  if (!format) { showToast(`No file format for ${mode.label} yet`, 'error'); return; }
  if (S.width !== mode.width || S.height !== mode.height) {
    showToast(`${mode.label} requires ${mode.width}×${mode.height}`, 'error'); return;
  }
  const bgIdx = c64IndexOfHex(S.c64BgColor);
  const bytes = format.write(mode.encode(mode.frames ? frameIndices() : currentIndices(), bgIdx));
  const name = `image.${format.ext}`;
  const a = document.createElement('a');
  a.download = name;
  a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  a.click();
  URL.revokeObjectURL(a.href);
  showToast(`Exported as ${name}`, 'success');
}
