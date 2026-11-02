import { COLODORE_HEX } from './constants.js';
import { S } from './state.js';
import { $ } from './dom.js';
import { isValidHex } from './color.js';
import { snapToC64Hex } from './c64/colors.js';
import { setC64PickerColor } from './c64/c64-ui.js';

// ══════════════════════════════════════════════════════════════
//  Colour controls
// ══════════════════════════════════════════════════════════════

export function setPrimaryColor(hex) {
  if (S.c64Mode && !COLODORE_HEX.includes(hex)) hex = snapToC64Hex(hex);
  S.primaryColor = hex;
  $('color-primary').style.background = hex;
  $('primary-color').value            = hex;
  $('primary-hex').value              = hex;
  if (S.c64Mode) setC64PickerColor('c64-primary-picker', hex);
}

export function setSecondaryColor(hex) {
  if (S.c64Mode && !COLODORE_HEX.includes(hex)) hex = snapToC64Hex(hex);
  S.secondaryColor = hex;
  $('color-secondary').style.background = hex;
  $('secondary-color').value            = hex;
  if (S.c64Mode) setC64PickerColor('c64-secondary-picker', hex);
}

$('primary-color').addEventListener('input',   e => setPrimaryColor(e.target.value));
$('secondary-color').addEventListener('input', e => setSecondaryColor(e.target.value));

$('primary-hex').addEventListener('change', e => {
  const val = e.target.value.startsWith('#') ? e.target.value : '#'+e.target.value;
  if (isValidHex(val)) setPrimaryColor(val);
  else e.target.value = S.primaryColor;
});

$('color-primary').addEventListener('click', () => {
  if (S.c64Mode) $('c64-primary-picker').querySelector('.c64-picker-btn').click();
  else $('primary-color').click();
});
$('color-secondary').addEventListener('click', () => {
  if (S.c64Mode) $('c64-secondary-picker').querySelector('.c64-picker-btn').click();
  else $('secondary-color').click();
});

$('btn-swap').addEventListener('click', () => {
  const tmp = S.primaryColor;
  setPrimaryColor(S.secondaryColor);
  setSecondaryColor(tmp);
});
