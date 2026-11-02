import { $ } from './dom.js';

// ══════════════════════════════════════════════════════════════
//  Toast
// ══════════════════════════════════════════════════════════════

let _toastTimer = null;
export function showToast(msg, type = '') {
  const el = $('toast');
  el.textContent = msg;
  el.className   = type;
  el.classList.remove('hidden');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.add('hidden'), 2500);
}
