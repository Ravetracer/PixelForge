import { S } from './state.js';
import { createLayer } from './layers.js';
import { $ } from './dom.js';
import { snapshotLayers, updateUndoRedo } from './history.js';
import { clearPreview, render, setupCanvases } from './render.js';
import { fitZoom } from './view.js';
import { updateCursorForLock } from './input.js';
import { resetAdjPanel } from './adjustments.js';
import { renderLayerPanel } from './layer-panel.js';
import { updateC64UI } from './c64/c64-ui.js';
import { newC64Document } from './c64/c64-document.js';
import { MODES } from './c64/modes.js';
import { resetSelection } from './selection.js';

// ══════════════════════════════════════════════════════════════
//  New image / size change
// ══════════════════════════════════════════════════════════════

function createNewImage(w, h, bg) {
  S.width = w; S.height = h;
  S.c64Mode    = false;
  S.c64Format  = null;
  S.pixelAspect = 1;
  S.layerIdCtr = 0;
  S.layers = [createLayer('Layer 1', bg)];
  S.activeLayerIndex = 0;
  resetSelection();
  S.history = [snapshotLayers()];
  S.historyIndex = 0;

  resetAdjPanel();
  setupCanvases();
  fitZoom();
  render();
  clearPreview();
  renderLayerPanel();
  updateUndoRedo();
  updateCursorForLock();
  updateC64UI();
}

export function updateSizeSelect() {
  const key = `${S.width}x${S.height}`;
  const sel = $('size-select');
  sel.value = [...sel.options].some(o => o.value === key) ? key : 'custom';
}

$('size-select').addEventListener('change', e => {
  if (e.target.value === 'custom') {
    $('new-width').value  = S.width;
    $('new-height').value = S.height;
    $('modal-overlay').classList.remove('hidden'); return;
  }
  const [w, h] = e.target.value.split('x').map(Number);
  if (w === S.width && h === S.height) return;
  $('new-width').value  = w;
  $('new-height').value = h;
  $('modal-overlay').classList.remove('hidden');
});

$('btn-new').addEventListener('click', () => {
  $('new-width').value  = S.width;
  $('new-height').value = S.height;
  $('modal-overlay').classList.remove('hidden');
});

$('modal-cancel').addEventListener('click', () => {
  $('modal-overlay').classList.add('hidden');
  updateSizeSelect();
});

$('modal-confirm').addEventListener('click', () => {
  const modeId = $('new-c64-mode').value;
  if (MODES[modeId]) {
    newC64Document(modeId, $('new-c64-bg').value);
  } else {
    const w = Math.max(1, Math.min(2048, parseInt($('new-width').value)  || 32));
    const h = Math.max(1, Math.min(2048, parseInt($('new-height').value) || 32));
    createNewImage(w, h, $('new-bg').value);
  }
  $('modal-overlay').classList.add('hidden');
  updateSizeSelect();
});

$('modal-overlay').addEventListener('click', e => {
  if (e.target === $('modal-overlay')) {
    $('modal-overlay').classList.add('hidden');
    updateSizeSelect();
  }
});
