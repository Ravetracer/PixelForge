import { S } from './state.js';
import { $ } from './dom.js';
import { commitHistory, snapshotLayers } from './history.js';
import { render } from './render.js';
import { showToast } from './toast.js';
import { applyC64TileConstraints } from './tracer/image-processing.js';
import { enforceModeRules } from './c64/c64-document.js';

// ══════════════════════════════════════════════════════════════
//  Image Adjustments
// ══════════════════════════════════════════════════════════════

let _adjBr = 0, _adjCo = 0, _adjSa = 0, _adjVi = 0;
let _adjBaseSnapshot = null;

function applyImageAdjustments(src, w, h, br, co, sa, vi) {
  if (br === 0 && co === 0 && sa === 0 && vi === 0) return new Uint8ClampedArray(src);
  const out = new Uint8ClampedArray(src);
  const brightShift = br * 2.55;
  const contFactor  = co !== 0 ? (259 * (co + 255)) / (255 * (259 - co)) : 1;
  const satMul      = 1 + sa / 100;
  for (let i = 0; i < w * h * 4; i += 4) {
    if (out[i + 3] === 0) continue;
    let r = out[i], g = out[i+1], b = out[i+2];
    if (br !== 0) { r += brightShift; g += brightShift; b += brightShift; }
    if (co !== 0) { r = contFactor*(r-128)+128; g = contFactor*(g-128)+128; b = contFactor*(b-128)+128; }
    if (sa !== 0) {
      const gray = 0.299*r + 0.587*g + 0.114*b;
      r = gray + (r-gray)*satMul; g = gray + (g-gray)*satMul; b = gray + (b-gray)*satMul;
    }
    if (vi !== 0) {
      const max = Math.max(r,g,b), avg = (r+g+b)/3;
      const sf  = 1 - Math.abs(max-avg) * (2/255);
      const amt = (vi/100) * sf;
      const gray = 0.299*r + 0.587*g + 0.114*b;
      r += (r-gray)*amt; g += (g-gray)*amt; b += (b-gray)*amt;
    }
    out[i]   = Math.max(0, Math.min(255, Math.round(r)));
    out[i+1] = Math.max(0, Math.min(255, Math.round(g)));
    out[i+2] = Math.max(0, Math.min(255, Math.round(b)));
  }
  return out;
}

function applyAdjLive() {
  if (!_adjBaseSnapshot) return;
  const targets = [];
  _adjBaseSnapshot.layers.forEach((snapLayer, idx) => {
    const layer = S.layers[idx];
    if (!layer || !layer.visible || layer.isBgLayer) return;
    let pix = applyImageAdjustments(snapLayer.pixels, S.width, S.height, _adjBr, _adjCo, _adjSa, _adjVi);
    if (S.c64Mode && S.c64Format === 'multicolor') {
      // Snap to C64 palette then apply tile constraints
      pix = applyC64TileConstraints(pix, S.width, S.height, S.c64BgColor);
    }
    targets.push({ layer, pix });
  });
  if (S.c64Mode && S.c64Format !== 'multicolor' && targets.length) {
    // Other C64 modes: enforce the colour rules on all drawing layers together (IFLI frames share colour RAM)
    enforceModeRules(targets.map(t => t.pix)).forEach((pix, i) => { targets[i].pix = pix; });
  }
  targets.forEach(({ layer, pix }) => layer.pixels.set(pix));
  render();
}

export function resetAdjPanel() {
  _adjBr = _adjCo = _adjSa = _adjVi = 0;
  _adjBaseSnapshot = null;
  ['adj-brightness','adj-contrast','adj-saturation','adj-vibrance'].forEach(id => {
    $(id).value = 0;
    $(id + '-val').textContent = '+0';
  });
}

function _bindAdjSlider(id, valId, setter) {
  const slider = $(id), label = $(valId);
  slider.addEventListener('input', () => {
    if (_adjBaseSnapshot === null) _adjBaseSnapshot = snapshotLayers();
    const v = parseInt(slider.value);
    setter(v);
    label.textContent = (v >= 0 ? '+' : '') + v;
    applyAdjLive();
  });
}

_bindAdjSlider('adj-brightness', 'adj-brightness-val', v => { _adjBr = v; });
_bindAdjSlider('adj-contrast',   'adj-contrast-val',   v => { _adjCo = v; });
_bindAdjSlider('adj-saturation', 'adj-saturation-val', v => { _adjSa = v; });
_bindAdjSlider('adj-vibrance',   'adj-vibrance-val',   v => { _adjVi = v; });

$('btn-adj-apply').addEventListener('click', () => {
  if (_adjBr === 0 && _adjCo === 0 && _adjSa === 0 && _adjVi === 0) return;
  commitHistory();
  resetAdjPanel();
  showToast('Adjustments applied', 'success');
});

$('btn-adj-reset').addEventListener('click', () => {
  if (_adjBaseSnapshot !== null) {
    _adjBaseSnapshot.layers.forEach((snapLayer, idx) => {
      const layer = S.layers[idx];
      if (!layer || layer.isBgLayer) return;
      layer.pixels.set(snapLayer.pixels);
    });
    render();
  }
  resetAdjPanel();
});
