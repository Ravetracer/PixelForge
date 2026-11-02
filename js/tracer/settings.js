import { $ } from '../dom.js';
import { initC64Picker } from '../c64/c64-ui.js';
import { MODES, heightStep, snapHeight } from '../c64/modes.js';
import { showToast } from '../toast.js';
import { TR } from './tracer-state.js';
import { tracerLivePreview } from './tracer.js';
import { tracerRender, tracerUpdateCropFromDst } from './viewport.js';

// ── Destination settings UI ───────────────────────────────────

export function tracerApplyPreset(val) {
  if (val === 'custom') {
    $('tracer-custom-size').classList.remove('hidden');
    return;
  }
  $('tracer-custom-size').classList.add('hidden');
  const [w, h] = val.split('x').map(Number);
  TR.dstW = w; TR.dstH = h;
  $('tracer-dst-w').value = w;
  $('tracer-dst-h').value = h;
  if (TR.srcImage) { tracerUpdateCropFromDst(); tracerRender(); tracerLivePreview(); }
}

/** Target: normal image or a C64 mode (fixed size, C64 palette, mode colour rules). */
export function tracerSetTarget(id) {
  const mode = MODES[id];
  TR.target = mode ? id : '';
  if (mode) {
    TR.dstW = mode.width; TR.aspect = mode.aspect;
    TR.dstH = snapHeight(mode, parseInt($('tracer-c64-height').value, 10));
    $('tracer-c64-height').value = TR.dstH;
    $('tracer-c64-height').step = heightStep(mode);
  } else {
    TR.aspect = 1;
    TR.dstW = Math.max(1, Math.min(2048, parseInt($('tracer-dst-w').value) || 64));
    TR.dstH = Math.max(1, Math.min(2048, parseInt($('tracer-dst-h').value) || 64));
  }
  $('tracer-target').value = TR.target;
  // checkerboard mixes suit the small C64 palette; off by default for normal images
  TR.patternMix = !!mode && !mode.frames && mode.id !== 'hires';
  $('tracer-pattern-mix').checked = TR.patternMix;
  $('tracer-size-field').classList.toggle('hidden', !!mode);
  $('tracer-c64-height-field').classList.toggle('hidden', !mode);
  $('tracer-custom-size').classList.toggle('hidden', !!mode || $('tracer-dst-preset').value !== 'custom');
  $('tracer-color-field').classList.toggle('hidden', !!mode);
  $('tracer-c64-group').classList.toggle('hidden', !mode || mode.id === 'nufli');
  updateColorFields();
  if (TR.srcImage) { tracerUpdateCropFromDst(); tracerRender(); tracerLivePreview(); }
}

function updateColorFields() {
  const normal = !TR.target;
  $('tracer-palette-section').classList.toggle('hidden', !normal || TR.colorMode !== 'palette');
  $('tracer-auto-colors-field').classList.toggle('hidden', !normal || TR.colorMode !== 'auto');
  $('tracer-pixel-options').classList.toggle('hidden', TR.style !== 'pixel');
  $('tracer-dither-field').classList.toggle('hidden', TR.style !== 'photo');
}

$('tracer-target').addEventListener('change', e => tracerSetTarget(e.target.value));
$('tracer-c64-height').addEventListener('change', e => {
  const mode = MODES[TR.target];
  if (mode) e.target.value = snapHeight(mode, parseInt(e.target.value, 10));
  tracerSetTarget(TR.target);
});
$('tracer-dst-preset').addEventListener('change', e => tracerApplyPreset(e.target.value));

$('tracer-dst-w').addEventListener('change', () => {
  TR.dstW = Math.max(1, Math.min(2048, parseInt($('tracer-dst-w').value) || 160));
  if (TR.srcImage) { tracerUpdateCropFromDst(); tracerRender(); tracerLivePreview(); }
});
$('tracer-dst-h').addEventListener('change', () => {
  TR.dstH = Math.max(1, Math.min(2048, parseInt($('tracer-dst-h').value) || 200));
  if (TR.srcImage) { tracerUpdateCropFromDst(); tracerRender(); tracerLivePreview(); }
});

$('tracer-style').addEventListener('change', e => { TR.style = e.target.value; updateColorFields(); tracerLivePreview(); });
$('tracer-cleanup').addEventListener('change', e => { TR.cleanup = e.target.checked; tracerLivePreview(); });
$('tracer-pattern-mix').addEventListener('change', e => { TR.patternMix = e.target.checked; tracerLivePreview(); });
$('tracer-bg-auto').addEventListener('change', e => {
  TR.bgAuto = e.target.checked;
  $('tracer-c64-bg-field').classList.toggle('hidden', TR.bgAuto);
  tracerLivePreview();
});
for (const [id, key] of [['tracer-smoothing', 'smoothing'], ['tracer-outline', 'outline'], ['tracer-auto-colors', 'autoColors'], ['tracer-hue', 'huePriority']]) {
  $(id).addEventListener('input', e => {
    TR[key] = parseInt(e.target.value, 10);
    $(id + '-val').textContent = TR[key];
    tracerLivePreview();
  });
}

$('tracer-dithering').addEventListener('change', e => {
  TR.dithering = e.target.value;
  tracerLivePreview();
});
$('tracer-color-mode').addEventListener('change', e => {
  TR.colorMode = e.target.value;
  updateColorFields();
  tracerLivePreview();
});

// ── Tracer palette rendering ──────────────────────────────────

export function tracerRenderPalette() {
  const el = $('tracer-palette-swatches');
  el.innerHTML = '';
  TR.palette.forEach(hex => {
    const d = document.createElement('div');
    d.className = 'tracer-palette-swatch';
    d.style.background = hex;
    d.title = hex;
    el.appendChild(d);
  });
}

// ── Lospec integration inside tracer ─────────────────────────

async function tracerLoadLospecBySlug(slug) {
  if (!slug) return;
  const el = $('tracer-lospec-results');
  el.innerHTML = '<div class="lospec-loading">Loading…</div>';
  try {
    const res = await fetch(`https://lospec.com/palette-list/${encodeURIComponent(slug)}.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    TR.palette = (data.colors || []).map(c => '#' + c.replace('#', ''));
    tracerRenderPalette();
    el.innerHTML = '';
    showToast(`Palette "${data.name}" (${TR.palette.length} colours)`, 'success');
    tracerLivePreview();
  } catch (err) {
    el.innerHTML = `<div class="lospec-error">Could not load — check slug or CORS.<br><small>${err.message}</small></div>`;
  }
}

async function tracerSearchLospec(query) {
  const el = $('tracer-lospec-results');
  el.innerHTML = '<div class="lospec-loading">Searching…</div>';
  try {
    const url = `https://lospec.com/palette-list/load?colorNumberFilterType=any&page=0&tag=&sortingType=default&query=${encodeURIComponent(query)}`;
    const res  = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const palettes = data.palettes || [];
    if (!palettes.length) { el.innerHTML = '<div class="lospec-loading">No results.</div>'; return; }
    el.innerHTML = '';
    palettes.slice(0, 14).forEach(p => {
      const item = document.createElement('div');
      item.className = 'lospec-result-item';
      const preview = (p.colors || []).slice(0, 8).map(c => `<span style="background:#${c}"></span>`).join('');
      item.innerHTML = `
        <div>
          <div class="lospec-result-name">${p.title || p.slug || 'Untitled'}</div>
          <div class="lospec-result-preview">${preview}</div>
        </div>
        <div class="lospec-result-count">${p.colorCount || '?'} clrs</div>`;
      item.addEventListener('click', () => {
        $('tracer-lospec-slug').value = p.slug;
        tracerLoadLospecBySlug(p.slug);
      });
      el.appendChild(item);
    });
  } catch (err) {
    el.innerHTML = `<div class="lospec-error">Search failed.<br><small>${err.message}</small></div>`;
  }
}

$('tracer-btn-load-lospec').addEventListener('click',   () => tracerLoadLospecBySlug($('tracer-lospec-slug').value.trim()));
$('tracer-lospec-slug').addEventListener('keydown',     e => { if (e.key === 'Enter') tracerLoadLospecBySlug(e.target.value.trim()); });
$('tracer-btn-search-lospec').addEventListener('click', () => tracerSearchLospec($('tracer-lospec-search').value.trim()));
$('tracer-lospec-search').addEventListener('keydown',   e => { if (e.key === 'Enter') tracerSearchLospec(e.target.value.trim()); });

// ── Enhancement sliders ───────────────────────────────────────

function bindEnhSlider(id, key) {
  const slider = $(id), label = $(id + '-val');
  slider.addEventListener('input', () => {
    const v = parseInt(slider.value);
    TR[key] = v;
    label.textContent = (v >= 0 ? '+' : '') + v;
    tracerLivePreview();
  });
}
bindEnhSlider('tracer-brightness', 'brightness');
bindEnhSlider('tracer-contrast',   'contrast');
bindEnhSlider('tracer-saturation', 'saturation');
bindEnhSlider('tracer-vibrance',   'vibrance');

$('tracer-invert').addEventListener('change', e => {
  TR.invert = e.target.checked;
  tracerLivePreview();
});

$('tracer-enh-reset').addEventListener('click', () => {
  TR.brightness = 0; TR.contrast = 0; TR.saturation = 0; TR.vibrance = 0; TR.invert = false;
  ['tracer-brightness','tracer-contrast','tracer-saturation','tracer-vibrance'].forEach(id => {
    $(id).value = 0;
    $(id + '-val').textContent = '+0';
  });
  $('tracer-invert').checked = false;
  tracerLivePreview();
});

// ── C64 bg picker in tracer ───────────────────────────────────

initC64Picker('tracer-c64-bg-picker', 'tracer-c64-bg-val', hex => {
  TR.c64BgColor = hex;
  tracerLivePreview();
});
