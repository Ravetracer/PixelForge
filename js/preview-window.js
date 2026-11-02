import { S } from './state.js';
import { $, canvasContainer, mainCanvas, miniPreviewCanvas, miniPreviewCtx, off, offCtx } from './dom.js';
import { layerPixelsForDisplay } from './selection.js';
import { interlaceImage } from './render.js';
import { renderCrt } from './crt.js';

// ══════════════════════════════════════════════════════════════
//  Mini preview window
// ══════════════════════════════════════════════════════════════

let _pending = false;
let _frames = [];          // presented preview images: 1, or 2 while interlace flicker runs
let _flickerRaf = 0;
let _shown = -1;
const PAL_FRAME_MS = 20;   // C64 PAL: 50 frames per second

/** Schedule a preview update; several calls within one animation frame are merged. */
export function renderPreviewWindow() {
  if (!S.previewVisible || _pending) return;
  _pending = true;
  requestAnimationFrame(() => { _pending = false; drawPreview(); });
}

const isInterlacedDoc = () => S.layers.some(l => l.frame);

/**
 * Effective preview scale: the chosen scale, reduced (uniformly, keeping the
 * aspect ratio) so the window fits into the canvas area — tall C64 pictures
 * would otherwise cover the whole canvas. Whole factors keep pixels crisp.
 */
function previewFitScale() {
  const maxW = Math.min(1024, canvasContainer.clientWidth * 0.6 || 1024);
  const maxH = Math.min(1024, canvasContainer.clientHeight * 0.6 || 1024);
  const fit = Math.min(S.previewScale, maxW / (S.width * S.pixelAspect), maxH / S.height);
  return fit >= 1 ? Math.floor(fit) : fit;
}

function drawPreview() {
  if (!S.previewVisible) return;
  const scale = previewFitScale();
  const pw = Math.max(1, Math.round(S.width * S.pixelAspect * scale));
  const ph = Math.max(1, Math.round(S.height * scale));
  if (miniPreviewCanvas.width !== pw || miniPreviewCanvas.height !== ph) {
    miniPreviewCanvas.width  = pw;
    miniPreviewCanvas.height = ph;
  }
  const interlaced = isInterlacedDoc();
  $('btn-preview-flicker').disabled = !interlaced;
  _frames = previewSources(interlaced).map(src => presentFrame(src, pw, ph));
  _shown = -1;
  showFrame(0);
  updateFlickerLoop();
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
  if (S.previewCrt) {
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

/** Interlace flicker: alternate the two frames at PAL frame rate, like the real C64 does. */
function updateFlickerLoop() {
  const run = S.previewVisible && _frames.length === 2;
  if (run && !_flickerRaf) {
    const tick = ts => {
      if (!S.previewVisible || _frames.length !== 2) { _flickerRaf = 0; return; }
      showFrame(Math.floor(ts / PAL_FRAME_MS) % 2);
      _flickerRaf = requestAnimationFrame(tick);
    };
    _flickerRaf = requestAnimationFrame(tick);
  } else if (!run && _flickerRaf) {
    cancelAnimationFrame(_flickerRaf);
    _flickerRaf = 0;
  }
}

// ── CRT / flicker toggles (remembered per browser) ────────────

function loadPreviewPrefs() {
  try {
    S.previewCrt = localStorage.getItem('pf.previewCrt') === '1';
    S.previewFlicker = localStorage.getItem('pf.previewFlicker') === '1';
  } catch { /* storage unavailable */ }
  $('btn-preview-crt').classList.toggle('active', S.previewCrt);
  $('btn-preview-flicker').classList.toggle('active', S.previewFlicker);
  $('mini-preview').classList.toggle('crt', S.previewCrt);
}

function togglePreviewOption(key, buttonId, storageKey) {
  S[key] = !S[key];
  $(buttonId).classList.toggle('active', S[key]);
  $('mini-preview').classList.toggle('crt', S.previewCrt);
  try { localStorage.setItem(storageKey, S[key] ? '1' : '0'); } catch { /* storage unavailable */ }
  renderPreviewWindow();
}

$('btn-preview-crt').addEventListener('click', e => { e.stopPropagation(); togglePreviewOption('previewCrt', 'btn-preview-crt', 'pf.previewCrt'); });
$('btn-preview-flicker').addEventListener('click', e => { e.stopPropagation(); togglePreviewOption('previewFlicker', 'btn-preview-flicker', 'pf.previewFlicker'); });
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

// Drag logic
let _pvDragging = false, _pvDragOffX = 0, _pvDragOffY = 0, _pvParentL = 0, _pvParentT = 0;

$('mini-preview-header').addEventListener('mousedown', e => {
  if (e.target.closest('select, input, button')) return;
  _pvDragging = true;
  const r  = _pvBox.getBoundingClientRect();
  const pr = _pvBox.parentElement.getBoundingClientRect();
  _pvParentL  = pr.left;
  _pvParentT  = pr.top;
  _pvDragOffX = e.clientX - r.left;
  _pvDragOffY = e.clientY - r.top;
  // Switch from CSS bottom/right to absolute left/top on first drag
  if (!_pvBox.style.left) {
    _pvBox.style.left   = (r.left - pr.left) + 'px';
    _pvBox.style.top    = (r.top  - pr.top)  + 'px';
    _pvBox.style.right  = 'auto';
    _pvBox.style.bottom = 'auto';
  }
  e.preventDefault();
});

document.addEventListener('mousemove', e => {
  if (!_pvDragging) return;
  _pvBox.style.left = (e.clientX - _pvDragOffX - _pvParentL) + 'px';
  _pvBox.style.top  = (e.clientY - _pvDragOffY - _pvParentT) + 'px';
});

document.addEventListener('mouseup', () => { _pvDragging = false; });
