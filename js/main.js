import { TOOL_NAMES } from './constants.js';
import { S } from './state.js';
import { createLayer } from './layers.js';
import { $, canvasContainer } from './dom.js';
import { snapshotLayers, updateUndoRedo } from './history.js';
import { render, setupCanvases } from './render.js';
import { fitZoom } from './view.js';
import { updateCursorForLock } from './input.js';
import { setPrimaryColor, setSecondaryColor } from './color-controls.js';
import { renderPalette } from './palette.js';
import { updateRefUI } from './reference.js';
import { renderLayerPanel } from './layer-panel.js';
import { setC64PickerColor, updateC64UI } from './c64/c64-ui.js';
import { TR } from './tracer/tracer-state.js';
import { tracerApplyPreset, tracerRenderPalette } from './tracer/settings.js';
import './color.js';
import './pixels.js';
import './draw-algorithms.js';
import './adjustments.js';
import './preview-window.js';
import './c64/disk-browser.js';
import './io.js';
import './document.js';
import './toolbar.js';
import './shortcuts.js';
import './toast.js';
import './tracer/tracer.js';
import './tracer/viewport.js';
import './tracer/dither.js';
import './tracer/image-processing.js';
import './help.js';

// ══════════════════════════════════════════════════════════════
//  Initialisation
// ══════════════════════════════════════════════════════════════

function init() {
  S.layerIdCtr = 0;
  S.layers = [createLayer('Layer 1')];
  S.activeLayerIndex = 0;
  S.history = [snapshotLayers()];
  S.historyIndex = 0;

  setupCanvases();
  fitZoom();
  render();
  renderPalette();
  renderLayerPanel();
  updateRefUI();

  setPrimaryColor(S.primaryColor);
  setSecondaryColor(S.secondaryColor);
  $('status-tool').textContent = TOOL_NAMES[S.tool];
  document.body.dataset.tool   = S.tool;
  updateUndoRedo();
  updateCursorForLock();
  updateC64UI();

  requestAnimationFrame(() => {
    canvasContainer.scrollLeft = (canvasContainer.scrollWidth  - canvasContainer.clientWidth)  / 2;
    canvasContainer.scrollTop  = (canvasContainer.scrollHeight - canvasContainer.clientHeight) / 2;
  });

  // Tracer: apply default preset (160×200 = C64)
  $('tracer-dst-preset').value = '160x200';
  tracerApplyPreset('160x200');
  setC64PickerColor('tracer-c64-bg-picker', TR.c64BgColor);
  TR.palette = [...S.palette];
  tracerRenderPalette();
}

init();
