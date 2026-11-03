import { S } from '../state.js';
import { $ } from '../dom.js';
import { makeDraggable } from '../floating-panel.js';
import { PAL_GROUPS, PAL_PARAMS, PAL_PRESETS, applyPalPreset, setPalParam, savePalSettings } from './pal-settings.js';

// ══════════════════════════════════════════════════════════════
//  PAL emulation settings panel (floating, generated from PAL_PARAMS)
// ══════════════════════════════════════════════════════════════

const panel = $('pal-panel');
const body = $('pal-panel-body');
const presetSelect = $('pal-preset');
const controls = new Map();   // key → { input, value?, param }
let onChange = () => {};

const decimals = step => (String(step).split('.')[1] || '').length;
const formatValue = (param, v) => `${Number(v).toFixed(decimals(param.step))} ${param.unit}`;

function makeControl(param) {
  const row = document.createElement('label');
  row.className = 'pal-row';
  if (param.title) row.title = param.title;
  const name = document.createElement('span');
  name.className = 'pal-name';
  name.textContent = param.label;
  row.append(name);

  let input, value = null;
  if (param.type === 'checkbox') {
    input = document.createElement('input');
    input.type = 'checkbox';
    input.addEventListener('change', () => update(param, input.checked));
  } else if (param.type === 'select') {
    input = document.createElement('select');
    for (const [v, text] of param.options) input.add(new Option(text, v));
    input.addEventListener('change', () => update(param, input.value));
  } else {
    input = document.createElement('input');
    input.type = 'range';
    Object.assign(input, { min: param.min, max: param.max, step: param.step });
    input.addEventListener('input', () => update(param, parseFloat(input.value)));
    value = document.createElement('span');
    value.className = 'pal-value';
  }
  row.append(input);
  if (value) row.append(value);
  controls.set(param.key, { input, value, param });
  return row;
}

function update(param, v) {
  setPalParam(param.key, v);
  const c = controls.get(param.key);
  if (c.value) c.value.textContent = formatValue(param, v);
  presetSelect.value = 'custom';
  onChange();
}

/** Reflect S.palSettings in all controls. */
function syncControls() {
  for (const { input, value, param } of controls.values()) {
    const v = S.palSettings[param.key];
    if (param.type === 'checkbox') input.checked = !!v;
    else input.value = v;
    if (value) value.textContent = formatValue(param, v);
  }
  presetSelect.value = S.palPreset;
  $('pal-animate').checked = S.palAnimate;
}

function build() {
  for (const p of PAL_PRESETS) presetSelect.add(new Option(p.label, p.id));
  presetSelect.add(new Option('Custom', 'custom'));
  presetSelect.querySelector('option[value="custom"]').disabled = true;

  for (const group of PAL_GROUPS) {
    const details = document.createElement('details');
    details.className = 'pal-group';
    details.open = group.id === 'signal' || group.id === 'tube';
    const summary = document.createElement('summary');
    summary.textContent = group.label;
    details.append(summary);
    PAL_PARAMS.filter(p => p.group === group.id).forEach(p => details.append(makeControl(p)));
    body.append(details);
  }
}

export function setPalPanelVisible(visible) {
  panel.classList.toggle('hidden', !visible);
  $('btn-preview-pal-settings').classList.toggle('active', visible);
}

/** @param changed called after every settings change */
export function initPalPanel(changed) {
  onChange = changed;
  build();
  syncControls();

  presetSelect.addEventListener('change', () => {
    applyPalPreset(presetSelect.value);
    syncControls();
    onChange();
  });
  $('pal-animate').addEventListener('change', e => {
    S.palAnimate = e.target.checked;
    savePalSettings();
    onChange();
  });
  $('btn-pal-panel-close').addEventListener('click', () => setPalPanelVisible(false));
  makeDraggable(panel, $('pal-panel-header'));
}
