import { C64_COLOR_NAMES, COLODORE_HEX } from '../constants.js';
import { S } from '../state.js';
import { $ } from '../dom.js';
import { hexToRgba } from '../color.js';
import { initPixels } from '../pixels.js';
import { render } from '../render.js';
import { setPrimaryColor, setSecondaryColor } from '../color-controls.js';
import { renderPalette } from '../palette.js';
import { exportC64 } from './c64-document.js';
import { MODES, tallHeight } from './modes.js';
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
    const needsTemplate = mode.stateful && !S.c64Data?.template;
    $('btn-export-koala').disabled = !format || needsTemplate;
    if (needsTemplate) $('btn-export-koala').title = `${mode.label} can only be saved for pictures loaded from a .nuf/.nup file (the file provides the displayer code)`;

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
  // FLI/AFLI may be taller than one screen (steps of 8 lines, saved as 200-line pages)
  $('new-height').disabled = !!mode && !mode.tall;
  $('new-height').step = mode?.tall ? 8 : 1;
  $('modal-bg-field').classList.toggle('hidden', !!mode);
  $('modal-c64-bg-field').classList.toggle('hidden', !mode);
  if (mode) { $('new-width').value = mode.width; $('new-height').value = mode.height; }
});

// Tall modes: show the height snapped to whole character rows right away
$('new-height').addEventListener('change', e => {
  const mode = MODES[$('new-c64-mode').value];
  if (mode?.tall) e.target.value = tallHeight(parseInt(e.target.value, 10));
});

initC64Picker('c64-bg-picker', null, hex => { S.c64BgColor = hex; syncC64BgLayer(); render(); });
initC64Picker('new-c64-bg-picker', 'new-c64-bg', () => {});
initC64Picker('c64-primary-picker', null, hex => setPrimaryColor(hex));
initC64Picker('c64-secondary-picker', null, hex => setSecondaryColor(hex));
document.addEventListener('click', closeAllC64Pickers);

$('btn-export-koala').addEventListener('click', exportC64);
