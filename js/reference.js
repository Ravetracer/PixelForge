import { S } from './state.js';
import { $ } from './dom.js';
import { renderRefImage } from './render.js';

// ══════════════════════════════════════════════════════════════
//  Reference image
// ══════════════════════════════════════════════════════════════

export function updateRefUI() {
  const hasRef = !!S.refImage;
  $('ref-info').classList.toggle('hidden', !hasRef);
  $('ref-empty').style.display = hasRef ? 'none' : '';
  $('btn-ref-vis').classList.toggle('active', S.refVisible);

  if (hasRef) {
    $('ref-filename').textContent    = S.refName;
    $('ref-dims').textContent        = `${S.refImage.naturalWidth}×${S.refImage.naturalHeight}`;
    $('ref-opacity').value           = S.refOpacity;
    $('ref-opacity-val').textContent = S.refOpacity + '%';
    $('ref-scale').value             = S.refScale;
    $('ref-scale-val').textContent   = S.refScale + '%';
    $('ref-offx').value              = S.refOffX;
    $('ref-offx-val').textContent    = S.refOffX + '%';
    $('ref-offy').value              = S.refOffY;
    $('ref-offy-val').textContent    = S.refOffY + '%';
  }
}

$('btn-load-ref').addEventListener('click', () => $('ref-file-input').click());

$('ref-file-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {
      S.refImage   = img;
      S.refName    = file.name;
      S.refVisible = true;
      S.refOffX    = 0;
      S.refOffY    = 0;
      S.refScale   = 100;
      renderRefImage();
      updateRefUI();
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
  e.target.value = '';
});

$('btn-ref-vis').addEventListener('click', () => {
  S.refVisible = !S.refVisible;
  renderRefImage();
  updateRefUI();
});

$('btn-clear-ref').addEventListener('click', () => {
  S.refImage = null;
  renderRefImage();
  updateRefUI();
});

$('ref-opacity').addEventListener('input', e => {
  S.refOpacity = +e.target.value;
  $('ref-opacity-val').textContent = S.refOpacity + '%';
  renderRefImage();
});

$('ref-scale').addEventListener('input', e => {
  S.refScale = +e.target.value;
  $('ref-scale-val').textContent = S.refScale + '%';
  renderRefImage();
});

$('ref-offx').addEventListener('input', e => {
  S.refOffX = +e.target.value;
  $('ref-offx-val').textContent = S.refOffX + '%';
  renderRefImage();
});

$('ref-offy').addEventListener('input', e => {
  S.refOffY = +e.target.value;
  $('ref-offy-val').textContent = S.refOffY + '%';
  renderRefImage();
});

$('btn-reset-ref-transform').addEventListener('click', () => {
  S.refOffX = 0; S.refOffY = 0; S.refScale = 100;
  updateRefUI();
  renderRefImage();
});
