import { S } from './state.js';
import { $, mainCanvas, miniPreviewCanvas, miniPreviewCtx, off, offCtx } from './dom.js';
import { layerPixelsForDisplay } from './selection.js';

// ══════════════════════════════════════════════════════════════
//  Mini preview window
// ══════════════════════════════════════════════════════════════

export function renderPreviewWindow() {
  if (!S.previewVisible) return;
  const xMult = S.pixelAspect;
  const pw = Math.max(1, Math.min(1024, S.width * xMult * S.previewScale));
  const ph = Math.max(1, Math.min(1024, S.height * S.previewScale));

  if (miniPreviewCanvas.width !== pw || miniPreviewCanvas.height !== ph) {
    miniPreviewCanvas.width  = pw;
    miniPreviewCanvas.height = ph;
  }

  // Checkerboard background
  miniPreviewCtx.clearRect(0, 0, pw, ph);
  const sz = Math.max(2, Math.min(16, S.previewScale));
  for (let y = 0; y < ph; y += sz)
    for (let x = 0; x < pw; x += sz) {
      miniPreviewCtx.fillStyle = ((Math.floor(x/sz)+Math.floor(y/sz))%2===0) ? '#555' : '#888';
      miniPreviewCtx.fillRect(x, y, sz, sz);
    }

  // Interlaced modes: the main canvas already holds the blended picture
  if (S.layers.some(l => l.frame)) {
    miniPreviewCtx.imageSmoothingEnabled = false;
    miniPreviewCtx.drawImage(mainCanvas, 0, 0, pw, ph);
    return;
  }

  // Composite all visible layers
  miniPreviewCtx.imageSmoothingEnabled = false;
  for (let i = S.layers.length - 1; i >= 0; i--) {
    const layer = S.layers[i];
    if (!layer.visible || !layer.pixels) continue;
    offCtx.putImageData(new ImageData(new Uint8ClampedArray(layerPixelsForDisplay(layer)), S.width, S.height), 0, 0);
    miniPreviewCtx.save();
    miniPreviewCtx.globalAlpha = layer.opacity / 100;
    miniPreviewCtx.drawImage(off, 0, 0, pw, ph);
    miniPreviewCtx.restore();
  }
}

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
