import { $ } from '../dom.js';
import { initC64Picker } from '../c64/c64-ui.js';
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
  // Auto-enable C64 mode for 160×200
  const isC64 = (w === 160 && h === 200);
  $('tracer-c64-group').classList.toggle('hidden', !isC64);
  $('tracer-c64-mode').checked = isC64;
  TR.c64Mode = isC64;
  if (TR.srcImage) { tracerUpdateCropFromDst(); tracerRender(); tracerLivePreview(); }
}

$('tracer-dst-preset').addEventListener('change', e => tracerApplyPreset(e.target.value));

$('tracer-dst-w').addEventListener('change', () => {
  TR.dstW = Math.max(1, Math.min(2048, parseInt($('tracer-dst-w').value) || 160));
  if (TR.srcImage) { tracerUpdateCropFromDst(); tracerRender(); tracerLivePreview(); }
});
$('tracer-dst-h').addEventListener('change', () => {
  TR.dstH = Math.max(1, Math.min(2048, parseInt($('tracer-dst-h').value) || 200));
  if (TR.srcImage) { tracerUpdateCropFromDst(); tracerRender(); tracerLivePreview(); }
});

$('tracer-c64-mode').addEventListener('change', e => {
  TR.c64Mode = e.target.checked;
  $('tracer-c64-bg-field').style.display = TR.c64Mode ? '' : 'none';
  tracerUpdateCropFromDst();
  tracerRender();
  tracerLivePreview();
});

$('tracer-dithering').addEventListener('change', e => {
  TR.dithering = e.target.value;
  tracerLivePreview();
});
$('tracer-color-mode').addEventListener('change', e => {
  TR.colorMode = e.target.value;
  $('tracer-palette-section').classList.toggle('hidden', TR.colorMode !== 'palette');
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
