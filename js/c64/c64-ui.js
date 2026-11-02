import { C64_COLOR_NAMES, COLODORE_HEX } from '../constants.js';
import { S } from '../state.js';
import { $ } from '../dom.js';
import { hexToRgba } from '../color.js';
import { initPixels } from '../pixels.js';
import { render } from '../render.js';
import { setPrimaryColor, setSecondaryColor } from '../color-controls.js';
import { renderPalette } from '../palette.js';
import { exportC64, setSpriteColor } from './c64-document.js';
import { MODES, heightStep, snapHeight } from './modes.js';
import { formatForMode } from './formats.js';

// ══════════════════════════════════════════════════════════════
//  C64 mode UI update
// ══════════════════════════════════════════════════════════════

export function updateC64UI() {
  const show = S.c64Mode;
  $('c64-toolbar-group').classList.toggle('hidden', !show);

  if (show) {
    setC64PickerColor('c64-bg-picker', S.c64BgColor);
    const mode = MODES[S.c64Format];
    const format = formatForMode(S.c64Format);
    $('status-size').textContent = `${S.width} × ${S.height} px [C64 ${mode.label}]`;
    $('btn-export-koala').textContent = format ? `Save .${format.ext}` : 'Save';
    $('btn-export-koala').title = format ? `Export as ${format.label} (.${format.ext})` : `No file format for ${mode.label} yet`;
    // NUFLI has no global background register: the picker would only desync canvas and data
    $('c64-bg-label').classList.toggle('hidden', !!mode.stateful);
    $('c64-bg-picker').classList.toggle('hidden', !!mode.stateful);
    $('btn-export-koala').disabled = !format;
    updateSpritePickers();

    // Lock palette to Colodore 16 colours
    S.palette = [...COLODORE_HEX];
    renderPalette();

    // Disable palette editing controls
    $('btn-add-to-palette').disabled = true;
    $('btn-clear-palette').disabled  = true;
    $('palette-lock-note').classList.remove('hidden');

    // Hide Lospec and image-colour extraction (not meaningful in C64 mode)
    $('lospec-section').classList.add('hidden');
    $('image-colors-section').classList.add('hidden');

    // Replace native colour pickers with C64 palette pickers
    $('primary-color').classList.add('hidden');
    $('secondary-color').classList.add('hidden');
    $('c64-primary-picker').classList.remove('hidden');
    $('c64-secondary-picker').classList.remove('hidden');
    $('primary-hex').disabled = true;
    setC64PickerColor('c64-primary-picker', S.primaryColor);
    setC64PickerColor('c64-secondary-picker', S.secondaryColor);

    // Disable layer structure controls and hide opacity (not supported in Koala format)
    $('btn-layer-add').disabled   = true;
    $('btn-layer-dup').disabled   = true;
    $('btn-layer-merge').disabled = true;
    $('layer-opacity-row').classList.add('hidden');
  } else {
    $('status-size').textContent = `${S.width} × ${S.height} px`;

    // Re-enable palette controls
    $('btn-add-to-palette').disabled = false;
    $('btn-clear-palette').disabled  = false;
    $('palette-lock-note').classList.add('hidden');

    $('lospec-section').classList.remove('hidden');
    $('image-colors-section').classList.remove('hidden');

    // Restore native colour pickers
    $('primary-color').classList.remove('hidden');
    $('secondary-color').classList.remove('hidden');
    $('c64-primary-picker').classList.add('hidden');
    $('c64-secondary-picker').classList.add('hidden');
    $('primary-hex').disabled = false;

    // Re-enable layer structure controls
    $('btn-layer-add').disabled   = false;
    $('btn-layer-dup').disabled   = false;
    $('btn-layer-merge').disabled = false;
    $('layer-opacity-row').classList.remove('hidden');
  }
}

// ══════════════════════════════════════════════════════════════
//  Super hires sprite colour registers
// ══════════════════════════════════════════════════════════════

let _spritePickerMode = null;

/** One C64 colour picker per sprite colour register of the current mode. */
export function updateSpritePickers() {
  const mode = S.c64Mode ? MODES[S.c64Format] : null;
  const labels = mode?.spriteColors ?? [];
  if (_spritePickerMode !== (mode?.id ?? null)) {
    _spritePickerMode = mode?.id ?? null;
    const box = $('c64-sprite-pickers');
    box.innerHTML = '';
    labels.forEach((label, i) => {
      const picker = document.createElement('div');
      picker.className = 'c64-palette-picker';
      picker.id = `c64-sprite-picker-${i}`;
      picker.title = `${label} colour (changing it recolours that sprite layer)`;
      picker.innerHTML = '<button type="button" class="c64-picker-btn"></button><div class="c64-picker-dropdown hidden"></div>';
      box.appendChild(picker);
      initC64Picker(picker.id, null, hex => setSpriteColor(i, hex));
    });
  }
  $('c64-sprite-colors').classList.toggle('hidden', !labels.length);
  labels.forEach((_, i) => setC64PickerColor(`c64-sprite-picker-${i}`, COLODORE_HEX[S.c64Data?.sprites?.[i] ?? 0]));
}

// ══════════════════════════════════════════════════════════════
//  C64 palette colour picker
// ══════════════════════════════════════════════════════════════

export function initC64Picker(pickerId, hiddenId, onChange) {
  const wrapper  = document.getElementById(pickerId);
  const btn      = wrapper.querySelector('.c64-picker-btn');
  const dropdown = wrapper.querySelector('.c64-picker-dropdown');

  COLODORE_HEX.forEach((hex, i) => {
    const cell      = document.createElement('button');
    cell.type       = 'button';
    cell.className  = 'c64-picker-cell';
    cell.style.background = hex;
    cell.title      = `${C64_COLOR_NAMES[i]} (${hex})`;
    cell.dataset.hex = hex;
    cell.addEventListener('click', e => {
      e.stopPropagation();
      if (hiddenId) document.getElementById(hiddenId).value = hex;
      setC64PickerColor(pickerId, hex);
      onChange(hex);
    });
    dropdown.appendChild(cell);
  });

  btn.addEventListener('click', e => {
    e.stopPropagation();
    const isOpen = !dropdown.classList.contains('hidden');
    closeAllC64Pickers();
    if (!isOpen) {
      const r = btn.getBoundingClientRect();
      dropdown.style.top  = (r.bottom + 4) + 'px';
      dropdown.style.left = r.left + 'px';
      dropdown.classList.remove('hidden');
    }
  });
}

export function setC64PickerColor(pickerId, hex) {
  const wrapper  = document.getElementById(pickerId);
  const btn      = wrapper.querySelector('.c64-picker-btn');
  const dropdown = wrapper.querySelector('.c64-picker-dropdown');
  btn.style.background = hex;
  dropdown.querySelectorAll('.c64-picker-cell').forEach(c =>
    c.classList.toggle('selected', c.dataset.hex === hex)
  );
}

function closeAllC64Pickers() {
  document.querySelectorAll('.c64-picker-dropdown').forEach(d => d.classList.add('hidden'));
}

export function syncC64BgLayer() {
  if (!S.c64Mode) return;
  const bgLayer = S.layers.find(l => l.isBgLayer);
  if (!bgLayer) return;
  const { r, g, b } = hexToRgba(S.c64BgColor);
  for (let i = 0; i < bgLayer.pixels.length; i += 4) {
    bgLayer.pixels[i]   = r;
    bgLayer.pixels[i+1] = g;
    bgLayer.pixels[i+2] = b;
    bgLayer.pixels[i+3] = 255;
  }
}

export function makeBgLayer(color) {
  return {
    id: ++S.layerIdCtr,
    name: 'C64 Background',
    pixels: initPixels(S.width, S.height, color),
    visible: true,
    locked: true,
    opacity: 100,
    isBgLayer: true,
  };
}

// ══════════════════════════════════════════════════════════════
//  C64 modal + toolbar wiring
// ══════════════════════════════════════════════════════════════

$('new-c64-mode').addEventListener('change', e => {
  const mode = MODES[e.target.value];
  $('new-width').disabled  = !!mode;
  // Any height in the mode's steps; taller than one screen is saved as several files
  $('new-height').step = mode ? heightStep(mode) : 1;
  $('modal-bg-field').classList.toggle('hidden', !!mode);
  $('modal-c64-bg-field').classList.toggle('hidden', !mode);
  if (mode) { $('new-width').value = mode.width; $('new-height').value = mode.height; }
});

// C64 modes: show the height snapped to the mode's steps right away
$('new-height').addEventListener('change', e => {
  const mode = MODES[$('new-c64-mode').value];
  if (mode) e.target.value = snapHeight(mode, parseInt(e.target.value, 10));
});

initC64Picker('c64-bg-picker', null, hex => { S.c64BgColor = hex; syncC64BgLayer(); render(); });
initC64Picker('new-c64-bg-picker', 'new-c64-bg', () => {});
initC64Picker('c64-primary-picker', null, hex => setPrimaryColor(hex));
initC64Picker('c64-secondary-picker', null, hex => setSecondaryColor(hex));
document.addEventListener('click', closeAllC64Pickers);

$('btn-export-koala').addEventListener('click', exportC64);
