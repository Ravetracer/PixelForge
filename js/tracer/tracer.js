import { C64_PALETTE_RGB } from '../constants.js';
import { S } from '../state.js';
import { $ } from '../dom.js';
import { hexToRgba } from '../color.js';
import { snapshotLayers, updateUndoRedo } from '../history.js';
import { render, setupCanvases } from '../render.js';
import { fitZoom } from '../view.js';
import { updateCursorForLock } from '../input.js';
import { renderLayerPanel } from '../layer-panel.js';
import { nearestC64Color } from '../c64/colors.js';
import { makeBgLayer, updateC64UI } from '../c64/c64-ui.js';
import { updateSizeSelect } from '../document.js';
import { showToast } from '../toast.js';
import { TR, tracerResultCtx, tracerResultEl, tracerWrap } from './tracer-state.js';
import { tracerFitToView, tracerRender, tracerResizeCanvas, tracerUpdateCropFromDst } from './viewport.js';
import { applyDithering } from './dither.js';
import { applyC64TileConstraints, applyEnhancements, tracerDownscale } from './image-processing.js';
import { resetSelection } from '../selection.js';

// ── open / close ──────────────────────────────────────────────

function openTracer() {
  $('tracer-overlay').classList.remove('hidden');
  tracerResizeCanvas();
  tracerRender();
}

function closeTracer() {
  $('tracer-overlay').classList.add('hidden');
}

$('btn-trace').addEventListener('click', openTracer);
$('tracer-close').addEventListener('click', closeTracer);
$('tracer-overlay').addEventListener('click', e => {
  if (e.target === $('tracer-overlay')) closeTracer();
});

// ── Load source image ─────────────────────────────────────────

$('tracer-load-src').addEventListener('click', () => $('tracer-file-input').click());
$('tracer-file-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {
      TR.srcImage  = img;
      TR.srcName   = file.name;
      tracerFitToView();
      tracerUpdateCropFromDst();
      tracerRender();
      tracerLivePreview();
      $('tracer-src-info').textContent = `${file.name} (${img.naturalWidth}×${img.naturalHeight})`;
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
  e.target.value = '';
});

// Drag-and-drop onto tracer canvas
tracerWrap.addEventListener('dragover', e => e.preventDefault());
tracerWrap.addEventListener('drop', e => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (file && (file.type === 'image/jpeg' || file.type === 'image/png')) {
    $('tracer-file-input').files; // (unused; trigger via FileReader)
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => {
        TR.srcImage = img; TR.srcName = file.name;
        tracerFitToView();
        tracerUpdateCropFromDst();
        tracerRender(); tracerLivePreview();
        $('tracer-src-info').textContent = `${file.name} (${img.naturalWidth}×${img.naturalHeight})`;
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }
});

// ── Build palette for tracing ─────────────────────────────────

function tracerBuildPalette() {
  if (TR.c64Mode) return C64_PALETTE_RGB;
  if (TR.colorMode === 'palette') {
    return TR.palette.map(hex => {
      const { r, g, b } = hexToRgba(hex);
      return [r, g, b];
    });
  }
  // full color: return null → skip palette quantization
  return null;
}

// ── Live preview ──────────────────────────────────────────────

let _tracerPreviewTimer = null;

export function tracerLivePreview() {
  clearTimeout(_tracerPreviewTimer);
  _tracerPreviewTimer = setTimeout(_tracerRunPreview, 80);
}

function _tracerRunPreview() {
  if (!TR.srcImage) return;
  const pixels = tracerDownscale(TR.srcImage, TR.cropX, TR.cropY, TR.cropW, TR.cropH, TR.dstW, TR.dstH);
  const result = _tracerProcess(pixels, TR.dstW, TR.dstH);
  _showTracerResult(result, TR.dstW, TR.dstH);
}

function _tracerProcess(pixels, w, h) {
  pixels = applyEnhancements(pixels, w, h);
  const palRgb = tracerBuildPalette();
  let result;
  if (palRgb) {
    result = applyDithering(pixels, w, h, palRgb);
  } else {
    result = new Uint8ClampedArray(pixels);
  }
  if (TR.c64Mode) {
    result = applyC64TileConstraints(result, w, h, TR.c64BgColor);
  }
  return result;
}

function _showTracerResult(pixels, w, h) {
  // Fit result into the result canvas area (max ~220px wide)
  const maxW = 220, maxH = 180;
  const scale = Math.min(maxW / w, maxH / h, 4);
  const dw = Math.round(w * scale), dh = Math.round(h * scale);

  tracerResultEl.width  = dw;
  tracerResultEl.height = dh;

  // Draw native pixels into an offscreen canvas then scale up
  const tmp = document.createElement('canvas');
  tmp.width = w; tmp.height = h;
  tmp.getContext('2d').putImageData(new ImageData(pixels, w, h), 0, 0);

  tracerResultCtx.imageSmoothingEnabled = false;
  tracerResultCtx.drawImage(tmp, 0, 0, dw, dh);
  $('tracer-result-info').textContent = `${w} × ${h} px`;
}

// ── Execute trace → load into main canvas ─────────────────────

$('tracer-execute').addEventListener('click', () => {
  if (!TR.srcImage) { showToast('Load a source image first', 'error'); return; }

  const pixels = tracerDownscale(TR.srcImage, TR.cropX, TR.cropY, TR.cropW, TR.cropH, TR.dstW, TR.dstH);
  const result = _tracerProcess(pixels, TR.dstW, TR.dstH);

  const w = TR.dstW, h = TR.dstH;
  const doC64 = TR.c64Mode;
  const bgColor = TR.c64BgColor;

  // Build new canvas state
  S.width  = w;
  S.height = h;
  S.c64Mode    = doC64;
  S.c64Format  = doC64 ? 'multicolor' : null;
  S.pixelAspect = doC64 ? 2 : 1;
  S.c64BgColor = bgColor;
  S.layerIdCtr  = 0;

  if (doC64) {
    // Separate foreground from background pixels
    const bgRgbArr = hexToRgba(bgColor);
    const bgIdx = nearestC64Color(bgRgbArr.r, bgRgbArr.g, bgRgbArr.b);
    const [bgR, bgG, bgB] = C64_PALETTE_RGB[bgIdx];
    const fgPixels = new Uint8ClampedArray(result.length);
    for (let i = 0; i < w*h; i++) {
      const p = i*4;
      const isBg = result[p]===bgR && result[p+1]===bgG && result[p+2]===bgB;
      fgPixels[p]   = isBg ? 0 : result[p];
      fgPixels[p+1] = isBg ? 0 : result[p+1];
      fgPixels[p+2] = isBg ? 0 : result[p+2];
      fgPixels[p+3] = isBg ? 0 : 255;
    }
    S.layers = [
      { id: ++S.layerIdCtr, name: 'Traced',       pixels: fgPixels,                    visible: true, locked: false, opacity: 100, isBgLayer: false },
      makeBgLayer(bgColor),
    ];
  } else {
    S.layers = [{
      id: ++S.layerIdCtr, name: 'Traced',
      pixels: new Uint8ClampedArray(result),
      visible: true, locked: false, opacity: 100,
    }];
  }

  S.activeLayerIndex = 0;
  resetSelection();
  S.history     = [snapshotLayers()];
  S.historyIndex = 0;

  setupCanvases();
  fitZoom();
  render();
  renderLayerPanel();
  updateSizeSelect();
  updateUndoRedo();
  updateCursorForLock();
  updateC64UI();

  closeTracer();
  showToast(`Traced to ${w}×${h}${doC64 ? ' [C64]' : ''}`, 'success');
});

// ── Keyboard shortcut ─────────────────────────────────────────

// (wired into the main keydown handler below, just a hook)
export function openTracerIfNotOpen() {
  if (!$('tracer-overlay').classList.contains('hidden')) return;
  openTracer();
}
