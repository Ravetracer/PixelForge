import { S } from './state.js';
import { $, off, offCtx } from './dom.js';
import { initPixels } from './pixels.js';
import { commitHistory } from './history.js';
import { render } from './render.js';
import { updateCursorForLock } from './input.js';
import { renderLayerPanel } from './layer-panel.js';
import { showToast } from './toast.js';
import { dropFloating } from './selection.js';

// ══════════════════════════════════════════════════════════════
//  Layer factory
// ══════════════════════════════════════════════════════════════

export function createLayer(name, bg = 'transparent') {
  const id = ++S.layerIdCtr;
  return {
    id,
    name: name || `Layer ${id}`,
    pixels: initPixels(S.width, S.height, bg),
    visible: true,
    locked: false,
    opacity: 100,
  };
}

// ══════════════════════════════════════════════════════════════
//  Layer management
// ══════════════════════════════════════════════════════════════

export function addLayer() {
  dropFloating();
  if (S.c64Mode) return;
  S.layers.splice(S.activeLayerIndex, 0, createLayer());
  // activeLayerIndex stays the same — it now points to the new layer
  commitHistory();
  render(); renderLayerPanel(); updateCursorForLock();
}

export function duplicateActiveLayer() {
  dropFloating();
  if (S.c64Mode) return;
  const src = S.layers[S.activeLayerIndex];
  if (!src) return;
  S.layers.splice(S.activeLayerIndex, 0, {
    id: ++S.layerIdCtr,
    name: src.name + ' copy',
    pixels: new Uint8ClampedArray(src.pixels),
    visible: src.visible,
    locked: false,
    opacity: src.opacity,
  });
  commitHistory();
  render(); renderLayerPanel();
}

export function deleteLayer(index) {
  dropFloating();
  if (S.c64Mode) return;
  if (S.layers[index]?.isBgLayer) { showToast('Cannot delete the C64 background layer', 'error'); return; }
  if (S.layers.length <= 1) { showToast('Cannot delete the last layer', 'error'); return; }
  S.layers.splice(index, 1);
  S.activeLayerIndex = Math.min(S.activeLayerIndex, S.layers.length - 1);
  commitHistory();
  render(); renderLayerPanel(); updateCursorForLock();
}

export function moveLayerUp(index) {
  dropFloating();
  if (index <= 0 || S.layers[index]?.isBgLayer || S.layers[index-1]?.isBgLayer) return;
  [S.layers[index-1], S.layers[index]] = [S.layers[index], S.layers[index-1]];
  if (S.activeLayerIndex === index)        S.activeLayerIndex = index - 1;
  else if (S.activeLayerIndex === index-1) S.activeLayerIndex = index;
  commitHistory();
  render(); renderLayerPanel();
}

export function moveLayerDown(index) {
  dropFloating();
  if (index >= S.layers.length-1 || S.layers[index]?.isBgLayer || S.layers[index+1]?.isBgLayer) return;
  [S.layers[index], S.layers[index+1]] = [S.layers[index+1], S.layers[index]];
  if (S.activeLayerIndex === index)        S.activeLayerIndex = index + 1;
  else if (S.activeLayerIndex === index+1) S.activeLayerIndex = index;
  commitHistory();
  render(); renderLayerPanel();
}

export function mergeVisibleLayers() {
  dropFloating();
  if (S.c64Mode) return;
  if (S.layers.length <= 1) { showToast('Nothing to merge', 'error'); return; }
  // Composite all visible layers using a temporary canvas for correct alpha blending
  const tmp = document.createElement('canvas');
  tmp.width = S.width; tmp.height = S.height;
  const ctx = tmp.getContext('2d');
  for (let i = S.layers.length-1; i >= 0; i--) {
    const layer = S.layers[i];
    if (!layer.visible) continue;
    offCtx.putImageData(new ImageData(new Uint8ClampedArray(layer.pixels), S.width, S.height), 0, 0);
    ctx.save();
    ctx.globalAlpha = layer.opacity / 100;
    ctx.drawImage(off, 0, 0);
    ctx.restore();
  }
  S.layers = [{
    id: ++S.layerIdCtr,
    name: 'Merged',
    pixels: new Uint8ClampedArray(ctx.getImageData(0, 0, S.width, S.height).data),
    visible: true, locked: false, opacity: 100,
  }];
  S.activeLayerIndex = 0;
  commitHistory();
  render(); renderLayerPanel(); updateCursorForLock();
  showToast('Visible layers merged', 'success');
}

export function setActiveLayer(index) {
  if (index === S.activeLayerIndex) return;
  dropFloating();
  S.activeLayerIndex = index;
  renderLayerPanel();
  updateCursorForLock();
  updateStatusLayer();
}

export function updateStatusLayer() {
  const layer = S.layers[S.activeLayerIndex];
  $('status-layer').textContent = layer ? layer.name : '—';
}
