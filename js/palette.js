import { DEFAULT_PALETTE } from './constants.js';
import { S } from './state.js';
import { $ } from './dom.js';
import { rgbaToHex } from './color.js';
import { setPrimaryColor, setSecondaryColor } from './color-controls.js';
import { showToast } from './toast.js';

// ══════════════════════════════════════════════════════════════
//  Palette
// ══════════════════════════════════════════════════════════════

export function renderPalette() {
  const el = $('palette-colors');
  el.innerHTML = '';
  S.palette.forEach(hex => el.appendChild(makeSwatch(hex)));
}

function makeSwatch(hex) {
  const d = document.createElement('div');
  d.className = 'palette-swatch';
  d.style.background = hex;
  d.title = hex;
  d.addEventListener('click',       () => setPrimaryColor(hex));
  d.addEventListener('contextmenu', e => { e.preventDefault(); setSecondaryColor(hex); });
  return d;
}

$('btn-add-to-palette').addEventListener('click', () => {
  if (!S.palette.includes(S.primaryColor)) {
    S.palette.push(S.primaryColor);
    renderPalette();
  }
});

$('btn-clear-palette').addEventListener('click', () => {
  S.palette = [...DEFAULT_PALETTE];
  renderPalette();
});

// Extract unique colours from all visible layers
$('btn-extract').addEventListener('click', () => {
  const seen = new Set();
  for (const layer of S.layers) {
    if (!layer.visible) continue;
    for (let i = 0; i < layer.pixels.length; i += 4) {
      if (layer.pixels[i+3] < 10) continue;
      seen.add(rgbaToHex(layer.pixels[i], layer.pixels[i+1], layer.pixels[i+2]));
    }
  }
  const el = $('image-colors');
  el.innerHTML = '';
  if (seen.size === 0) {
    el.textContent = 'No opaque pixels found.';
    return;
  }
  [...seen].sort().forEach(hex => el.appendChild(makeSwatch(hex)));
});

// ══════════════════════════════════════════════════════════════
//  Lospec
// ══════════════════════════════════════════════════════════════

async function loadLospecBySlug(slug) {
  if (!slug) return;
  const el = $('lospec-results');
  el.innerHTML = '<div class="lospec-loading">Loading…</div>';
  try {
    const res = await fetch(`https://lospec.com/palette-list/${encodeURIComponent(slug)}.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    S.palette = (data.colors || []).map(c => '#' + c.replace('#',''));
    renderPalette();
    el.innerHTML = '';
    showToast(`Loaded "${data.name}" (${S.palette.length} colours)`, 'success');
  } catch (err) {
    el.innerHTML = `<div class="lospec-error">Could not load palette — check the slug or CORS policy.<br><small>${err.message}</small></div>`;
  }
}

async function searchLospec(query) {
  const el = $('lospec-results');
  el.innerHTML = '<div class="lospec-loading">Searching…</div>';
  try {
    const url = `https://lospec.com/palette-list/load?colorNumberFilterType=any&page=0&tag=&sortingType=default&query=${encodeURIComponent(query)}`;
    const res  = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const palettes = data.palettes || [];
    if (!palettes.length) { el.innerHTML = '<div class="lospec-loading">No results.</div>'; return; }
    el.innerHTML = '';
    palettes.slice(0,20).forEach(p => {
      const item = document.createElement('div');
      item.className = 'lospec-result-item';
      const preview = (p.colors||[]).slice(0,8).map(c => `<span style="background:#${c}"></span>`).join('');
      item.innerHTML = `
        <div>
          <div class="lospec-result-name">${p.title||p.slug||'Untitled'}</div>
          <div class="lospec-result-preview">${preview}</div>
        </div>
        <div class="lospec-result-count">${p.colorCount||'?'} clrs</div>`;
      item.addEventListener('click', () => { $('lospec-slug').value = p.slug; loadLospecBySlug(p.slug); });
      el.appendChild(item);
    });
  } catch (err) {
    el.innerHTML = `<div class="lospec-error">Search failed — try entering a slug directly.<br><small>${err.message}</small></div>`;
  }
}

$('btn-load-lospec').addEventListener('click',   () => loadLospecBySlug($('lospec-slug').value.trim()));
$('lospec-slug').addEventListener('keydown',     e => { if (e.key==='Enter') loadLospecBySlug(e.target.value.trim()); });
$('btn-search-lospec').addEventListener('click', () => searchLospec($('lospec-search').value.trim()));
$('lospec-search').addEventListener('keydown',   e => { if (e.key==='Enter') searchLospec(e.target.value.trim()); });
