import { S } from './state.js';
import { $, canvasContainer, mainCanvas, miniPreviewCanvas, miniPreviewCtx, off, offCtx } from './dom.js';
import { layerPixelsForDisplay } from './selection.js';
import { interlaceImage } from './render.js';
import { renderCrt } from './crt.js';
import { makeDraggable } from './floating-panel.js';
import { showToast } from './toast.js';
import { PalRenderer } from './pal/pal-renderer.js';
import { loadPalSettings } from './pal/pal-settings.js';
import { initPalPanel, setPalPanelVisible } from './pal/pal-panel.js';

// ══════════════════════════════════════════════════════════════
//  Mini preview window
// ══════════════════════════════════════════════════════════════

let _pending = false;
let _frames = [];          // presented preview images: 1, or 2 while interlace flicker runs
let _animRaf = 0;
let _lastTick = -1;
let _shown = -1;
let _pal = null;           // PalRenderer, created on first use
let _palFailed = false;
let _palActive = false;    // PAL emulation renders the current preview
let _palSourceCount = 0;
const PAL_FRAME_MS = 20;   // C64 PAL: 50 frames per second

/** Schedule a preview update; several calls within one animation frame are merged. */
export function renderPreviewWindow() {
  if (!S.previewVisible || _pending) return;
  _pending = true;
  requestAnimationFrame(() => { _pending = false; drawPreview(); });
}

const isInterlacedDoc = () => S.layers.some(l => l.frame);

const MAX_CANVAS_SIDE = 8192;   // browser canvas safety limit

/** Preview scale: exactly the chosen one (only limited by the canvas size safety cap). */
function previewScale() {
  return Math.min(S.previewScale, MAX_CANVAS_SIDE / (S.width * S.pixelAspect), MAX_CANVAS_SIDE / S.height);
}

/**
 * Large previews (tall C64 pictures, high scales) scroll inside a view of at
 * most 60 % of the canvas area instead of covering the whole editor.
 */
function limitPreviewView() {
  const view = $('mini-preview-view');
  view.style.maxWidth  = Math.max(160, Math.floor(canvasContainer.clientWidth  * 0.6)) + 'px';
  view.style.maxHeight = Math.max(120, Math.floor(canvasContainer.clientHeight * 0.6)) + 'px';
}

function drawPreview() {
  if (!S.previewVisible) return;
  limitPreviewView();
  const scale = previewScale();
  const pw = Math.max(1, Math.round(S.width * S.pixelAspect * scale));
  const ph = Math.max(1, Math.round(S.height * scale));
  if (miniPreviewCanvas.width !== pw || miniPreviewCanvas.height !== ph) {
    miniPreviewCanvas.width  = pw;
    miniPreviewCanvas.height = ph;
  }
  const interlaced = isInterlacedDoc();
  $('btn-preview-flicker').disabled = !interlaced;
  const sources = previewSources(interlaced);
  _palActive = S.previewDisplay === 'pal' && ensurePalRenderer();
  _shown = -1;
  if (_palActive) {
    _frames = [];
    _palSourceCount = sources.length;
    _pal.setSources(sources, S.pixelAspect);
    if (!needsAnimation()) {
      _pal.resetPersistence();
      renderPalFrame(0);
    }
  } else {
    _frames = sources.map(src => presentFrame(src, pw, ph));
    showFrame(0);
  }
  updateAnimationLoop();
}

/** Create the WebGL2 PAL renderer on first use; fall back to the CRT look when unavailable. */
function ensurePalRenderer() {
  if (_pal) return true;
  if (!_palFailed) _pal = PalRenderer.create();
  if (_pal) return true;
  _palFailed = true;
  showToast('PAL emulation needs WebGL2 — using the CRT look instead', 'error');
  setPreviewDisplay('crt');
  return false;
}

/** One PAL video frame (50 Hz tick `tick`); interlaced pictures alternate their two frames. */
function renderPalFrame(tick) {
  const src = _palSourceCount === 2 ? tick % 2 : 0;
  const out = _pal.render(src, S.palAnimate ? tick : 0, miniPreviewCanvas.width, miniPreviewCanvas.height, S.palSettings);
  miniPreviewCtx.drawImage(out, 0, 0);
}

/** Source pictures: layer composite, IFLI blend, or both IFLI frames for flicker. */
function previewSources(interlaced) {
  if (interlaced && S.previewFlicker) return [1, 2].map(n => imageDataCanvas(interlaceImage([n])));
  if (interlaced) return [mainCanvas];
  return [layerComposite()];
}

function imageDataCanvas(imageData) {
  const c = document.createElement('canvas');
  c.width = imageData.width; c.height = imageData.height;
  c.getContext('2d').putImageData(imageData, 0, 0);
  return c;
}

/** Composite of all visible layers at native resolution. */
function layerComposite() {
  const c = document.createElement('canvas');
  c.width = S.width; c.height = S.height;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  for (let i = S.layers.length - 1; i >= 0; i--) {
    const layer = S.layers[i];
    if (!layer.visible || !layer.pixels) continue;
    offCtx.putImageData(new ImageData(new Uint8ClampedArray(layerPixelsForDisplay(layer)), S.width, S.height), 0, 0);
    ctx.globalAlpha = layer.opacity / 100;
    ctx.drawImage(off, 0, 0);
  }
  return c;
}

/** Scale a source to the preview size, either plain over a checkerboard or with the CRT look. */
function presentFrame(src, pw, ph) {
  const out = document.createElement('canvas');
  out.width = pw; out.height = ph;
  const ctx = out.getContext('2d');
  if (S.previewDisplay === 'crt') {
    renderCrt(ctx, src, pw, ph, ph / S.height);
    return out;
  }
  const sz = Math.max(2, Math.min(16, S.previewScale));
  for (let y = 0; y < ph; y += sz)
    for (let x = 0; x < pw; x += sz) {
      ctx.fillStyle = ((Math.floor(x / sz) + Math.floor(y / sz)) % 2 === 0) ? '#555' : '#888';
      ctx.fillRect(x, y, sz, sz);
    }
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0, pw, ph);
  return out;
}

function showFrame(i) {
  if (i === _shown || !_frames[i]) return;
  _shown = i;
  miniPreviewCtx.clearRect(0, 0, miniPreviewCanvas.width, miniPreviewCanvas.height);
  miniPreviewCtx.drawImage(_frames[i], 0, 0);
}

/** The preview runs at 50 Hz while interlace flicker or the animated PAL signal is shown. */
function needsAnimation() {
  if (!S.previewVisible) return false;
  if (_palActive) return S.palAnimate || _palSourceCount === 2;
  return _frames.length === 2;
}

function updateAnimationLoop() {
  const run = needsAnimation();
  if (run && !_animRaf) {
    _lastTick = -1;
    const tick = ts => {
      if (!needsAnimation()) { _animRaf = 0; return; }
      const n = Math.floor(ts / PAL_FRAME_MS);
      if (n !== _lastTick) {
        _lastTick = n;
        if (_palActive) renderPalFrame(n);
        else showFrame(n % 2);
      }
      _animRaf = requestAnimationFrame(tick);
    };
    _animRaf = requestAnimationFrame(tick);
  } else if (!run && _animRaf) {
    cancelAnimationFrame(_animRaf);
    _animRaf = 0;
  }
}

// ── Display mode (plain / CRT / PAL) and flicker toggle, remembered per browser ──

const DISPLAY_MODES = ['plain', 'crt', 'pal'];

function loadPreviewPrefs() {
  try {
    const stored = localStorage.getItem('pf.previewDisplay');
    S.previewDisplay = DISPLAY_MODES.includes(stored) ? stored
      : localStorage.getItem('pf.previewCrt') === '1' ? 'crt' : 'plain';
    S.previewFlicker = localStorage.getItem('pf.previewFlicker') === '1';
  } catch { /* storage unavailable */ }
  $('btn-preview-flicker').classList.toggle('active', S.previewFlicker);
  applyDisplayModeUi();
}

function applyDisplayModeUi() {
  $('preview-display-select').value = S.previewDisplay;
  $('mini-preview').classList.toggle('crt', S.previewDisplay !== 'plain');
  $('btn-preview-pal-settings').classList.toggle('hidden', S.previewDisplay !== 'pal');
  if (S.previewDisplay !== 'pal') setPalPanelVisible(false);
}

function setPreviewDisplay(mode) {
  S.previewDisplay = mode;
  applyDisplayModeUi();
  try { localStorage.setItem('pf.previewDisplay', mode); } catch { /* storage unavailable */ }
  renderPreviewWindow();
}

$('preview-display-select').addEventListener('change', e => setPreviewDisplay(e.target.value));
$('btn-preview-pal-settings').addEventListener('click', e => {
  e.stopPropagation();
  setPalPanelVisible($('pal-panel').classList.contains('hidden'));
});
$('btn-preview-flicker').addEventListener('click', e => {
  e.stopPropagation();
  S.previewFlicker = !S.previewFlicker;
  $('btn-preview-flicker').classList.toggle('active', S.previewFlicker);
  try { localStorage.setItem('pf.previewFlicker', S.previewFlicker ? '1' : '0'); } catch { /* storage unavailable */ }
  renderPreviewWindow();
});
loadPalSettings();
initPalPanel(renderPreviewWindow);
loadPreviewPrefs();

// ══════════════════════════════════════════════════════════════
//  Preview window — scale, hide/show, drag
// ══════════════════════════════════════════════════════════════

const _pvBox = $('mini-preview-box');

export function setPreviewVisible(v) {
  S.previewVisible = v;
  _pvBox.classList.toggle('hidden', !v);
  $('btn-preview').classList.toggle('active', v);
  if (v) renderPreviewWindow();
}

$('btn-preview').addEventListener('click', () => setPreviewVisible(!S.previewVisible));
$('btn-hide-preview').addEventListener('click', e => { e.stopPropagation(); setPreviewVisible(false); });

$('preview-scale-select').addEventListener('change', e => {
  if (e.target.value === 'custom') {
    $('preview-scale-custom').classList.remove('hidden');
    $('preview-scale-custom').select();
  } else {
    $('preview-scale-custom').classList.add('hidden');
    S.previewScale = parseInt(e.target.value);
    renderPreviewWindow();
  }
});

$('preview-scale-custom').addEventListener('change', e => {
  const v = Math.max(1, Math.min(64, parseInt(e.target.value) || 4));
  e.target.value = v;
  S.previewScale = v;
  renderPreviewWindow();
});

// Drag (kept inside the editor area); double-click on the header or ⟲ resets the position
const { resetPosition: resetPreviewPosition } = makeDraggable(_pvBox, $('mini-preview-header'));
$('btn-reset-preview-pos').addEventListener('click', e => { e.stopPropagation(); resetPreviewPosition(); });
