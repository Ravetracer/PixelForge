import { S } from './state.js';
import { $, canvasContainer, canvasWrapper, refCanvas } from './dom.js';
import { clearPreview, refLayout, renderRefImage } from './render.js';
import { zoomIn, zoomOut } from './view.js';
import { showToast } from './toast.js';

// ══════════════════════════════════════════════════════════════
//  Reference image
// ══════════════════════════════════════════════════════════════

const SCALE_MIN = 10, SCALE_MAX = 4000;   // %
const SLIDER_STEPS = 1000;                // logarithmic scale slider resolution

const clampScale = s => Math.max(SCALE_MIN, Math.min(SCALE_MAX, s));
const scaleToSlider = s => Math.round(SLIDER_STEPS * Math.log(clampScale(s) / SCALE_MIN) / Math.log(SCALE_MAX / SCALE_MIN));
const sliderToScale = v => SCALE_MIN * (SCALE_MAX / SCALE_MIN) ** (v / SLIDER_STEPS);

/** Wrap to −180..180 and round to 0.1°. */
function normalizeAngle(deg) {
  const a = ((deg + 180) % 360 + 360) % 360 - 180;
  return Math.round(a * 10) / 10;
}

// ── Panel UI ──────────────────────────────────────────────────

const TRANSFORM_CONTROLS = ['ref-scale', 'ref-scale-input', 'ref-rot-input', 'btn-ref-adjust', 'btn-reset-ref-transform'];

export function updateRefUI() {
  const hasRef = !!S.refImage;
  $('ref-info').classList.toggle('hidden', !hasRef);
  $('ref-empty').style.display = hasRef ? 'none' : '';
  $('btn-ref-vis').classList.toggle('active', S.refVisible);
  $('btn-ref-lock').classList.toggle('active', S.refLocked);
  $('btn-ref-lock').textContent = S.refLocked ? '🔒' : '🔓';
  $('btn-ref-adjust').classList.toggle('active', S.refAdjust);
  TRANSFORM_CONTROLS.forEach(id => { $(id).disabled = S.refLocked; });
  overlay.classList.toggle('hidden', !S.refAdjust);

  if (hasRef) {
    $('ref-filename').textContent    = S.refName;
    $('ref-dims').textContent        = `${S.refImage.naturalWidth}×${S.refImage.naturalHeight}`;
    $('ref-opacity').value           = S.refOpacity;
    $('ref-opacity-val').textContent = S.refOpacity + '%';
    updateTransformUI();
  }
  drawHandles();
}

function updateTransformUI() {
  $('ref-scale').value       = scaleToSlider(S.refScale);
  $('ref-scale-input').value = Math.round(S.refScale);
  $('ref-rot-input').value   = S.refRotation;
}

function applyTransform() {
  updateTransformUI();
  renderRefImage();
  drawHandles();
}

function resetTransform() {
  S.refOffX = 0; S.refOffY = 0; S.refScale = 100; S.refRotation = 0;
}

export function setRefAdjust(on) {
  S.refAdjust = on && !!S.refImage && !S.refLocked;
  drag = null;
  if (S.refAdjust) { clearPreview(); resizeOverlay(); }   // hide the brush cursor while adjusting
  updateRefUI();
}

function setRefLocked(locked) {
  S.refLocked = locked;
  if (locked) setRefAdjust(false);
  else updateRefUI();
}

/** Called after the user painted: protect the reference from accidental changes from now on. */
export function lockRefAfterPaint() {
  if (!S.refImage || S.refLocked) return;
  setRefLocked(true);
  showToast('Reference locked — click 🔒 to adjust it again');
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
      S.refLocked  = false;
      resetTransform();
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

$('btn-ref-lock').addEventListener('click', () => {
  if (S.refImage) setRefLocked(!S.refLocked);
});

$('btn-clear-ref').addEventListener('click', () => {
  S.refImage = null;
  S.refLocked = false;
  setRefAdjust(false);
  renderRefImage();
});

$('btn-ref-adjust').addEventListener('click', () => setRefAdjust(!S.refAdjust));

$('ref-opacity').addEventListener('input', e => {
  S.refOpacity = +e.target.value;
  $('ref-opacity-val').textContent = S.refOpacity + '%';
  renderRefImage();
});

$('ref-scale').addEventListener('input', e => {
  S.refScale = sliderToScale(+e.target.value);
  $('ref-scale-input').value = Math.round(S.refScale);
  renderRefImage();
  drawHandles();
});

$('ref-scale-input').addEventListener('change', e => {
  S.refScale = clampScale(Math.round(+e.target.value) || 100);
  applyTransform();
});

$('ref-rot-input').addEventListener('change', e => {
  S.refRotation = normalizeAngle(+e.target.value || 0);
  applyTransform();
});

$('btn-reset-ref-transform').addEventListener('click', () => {
  resetTransform();
  applyTransform();
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && S.refAdjust) setRefAdjust(false);
});

// ── Adjust overlay ────────────────────────────────────────────
// A canvas over the visible canvas view: it shows the reference frame with
// handles (like the tracer crop box) and takes all mouse input while
// adjusting, so the frame stays usable even when it is larger than the picture.

const overlay = $('ref-handles');
const octx = overlay.getContext('2d');

const HANDLE_HIT  = 10;   // px detection radius
const HANDLE_SIZE = 10;
const ROT_DIST    = 26;   // px distance of the rotation knob above the top edge
const CORNERS = { nw: [-1, -1], ne: [1, -1], sw: [-1, 1], se: [1, 1] };
const RESIZE_CURSORS = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'];

let drag = null;

function rotate(x, y, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return { x: x * c - y * s, y: x * s + y * c };
}

function resizeOverlay() {
  overlay.style.left = canvasContainer.offsetLeft + 'px';
  overlay.style.top  = canvasContainer.offsetTop + 'px';
  overlay.width  = canvasContainer.clientWidth;
  overlay.height = canvasContainer.clientHeight;
  overlay.style.width  = overlay.width + 'px';
  overlay.style.height = overlay.height + 'px';
  drawHandles();
}

/** Reference frame in overlay pixels: centre, unrotated size, angle, and the ref-canvas mapping. */
function frame() {
  const o = overlay.getBoundingClientRect(), r = refCanvas.getBoundingClientRect();
  const k = r.width / refCanvas.width;   // screen px per ref-canvas px
  const { cx, cy, dw, dh } = refLayout();
  return { x: r.left - o.left + cx * k, y: r.top - o.top + cy * k, w: dw * k, h: dh * k,
           a: S.refRotation * Math.PI / 180, left: r.left - o.left, top: r.top - o.top, cw: r.width, ch: r.height };
}

/** Move the reference centre to an overlay position. */
function setCentre(f, x, y) {
  S.refOffX = ((x - f.left) / f.cw - 0.5) * 100;
  S.refOffY = ((y - f.top)  / f.ch - 0.5) * 100;
}

function toLocal(f, x, y) {
  return rotate(x - f.x, y - f.y, -f.a);
}

function hitTest(f, x, y) {
  const l = toLocal(f, x, y), hw = f.w / 2, hh = f.h / 2;
  if (Math.hypot(l.x, l.y + hh + ROT_DIST) <= HANDLE_HIT) return 'rotate';
  for (const [name, [sx, sy]] of Object.entries(CORNERS)) {
    if (Math.abs(l.x - sx * hw) <= HANDLE_HIT && Math.abs(l.y - sy * hh) <= HANDLE_HIT) return name;
  }
  if (Math.abs(l.x) <= hw && Math.abs(l.y) <= hh) return 'move';
  return null;
}

function cursorFor(hit) {
  if (hit === 'rotate') return 'crosshair';
  if (hit === 'move')   return 'move';
  if (!hit)             return 'grab';
  const [sx, sy] = CORNERS[hit];
  const deg = Math.atan2(sy, sx) * 180 / Math.PI + S.refRotation;
  return RESIZE_CURSORS[Math.round((((deg % 180) + 180) % 180) / 45) % 4];
}

function drawHandles() {
  octx.clearRect(0, 0, overlay.width, overlay.height);
  if (!S.refAdjust || !S.refImage) return;
  const f = frame();
  const x0 = -f.w / 2, y0 = -f.h / 2;
  octx.save();
  octx.translate(f.x, f.y);
  octx.rotate(f.a);
  // frame with a dark outline so it stays visible on light and dark pictures
  octx.strokeStyle = 'rgba(0,0,0,.6)';
  octx.lineWidth = 3;
  octx.strokeRect(x0, y0, f.w, f.h);
  octx.strokeStyle = '#fff';
  octx.lineWidth = 1.5;
  octx.strokeRect(x0, y0, f.w, f.h);
  // rotation knob
  octx.lineWidth = 1;
  octx.beginPath();
  octx.moveTo(0, y0);
  octx.lineTo(0, y0 - ROT_DIST);
  octx.stroke();
  octx.beginPath();
  octx.arc(0, y0 - ROT_DIST, 5, 0, Math.PI * 2);
  octx.fillStyle = '#fff';
  octx.fill();
  octx.strokeStyle = 'rgba(0,0,0,.5)';
  octx.stroke();
  // corner handles
  const hs = HANDLE_SIZE;
  [[x0, y0], [-x0, y0], [x0, -y0], [-x0, -y0]].forEach(([hx, hy]) => {
    octx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
    octx.strokeRect(hx - hs / 2, hy - hs / 2, hs, hs);
  });
  octx.restore();
}

function overlayPos(e) {
  const o = overlay.getBoundingClientRect();
  return { x: e.clientX - o.left, y: e.clientY - o.top };
}

overlay.addEventListener('mousedown', e => {
  e.preventDefault();
  const p = overlayPos(e), f = frame();
  const hit = e.button === 0 ? hitTest(f, p.x, p.y) : null;
  if (hit === 'rotate') {
    drag = { type: 'rotate', startRot: S.refRotation, startAngle: Math.atan2(p.y - f.y, p.x - f.x) };
  } else if (hit === 'move') {
    drag = { type: 'move', dx: p.x - f.x, dy: p.y - f.y };
  } else if (hit) {
    // resize around the opposite corner, keeping the aspect ratio
    const [sx, sy] = CORNERS[hit];
    const anchor = rotate(-sx * f.w / 2, -sy * f.h / 2, f.a);
    drag = { type: 'resize', sx, sy, ax: f.x + anchor.x, ay: f.y + anchor.y,
             startW: f.w, startScale: S.refScale, ar: f.w / f.h };
  } else {
    // outside the frame (or middle button): pan the view
    drag = { type: 'pan', x: e.clientX, y: e.clientY,
             scrollX: canvasContainer.scrollLeft, scrollY: canvasContainer.scrollTop };
  }
  overlay.style.cursor = drag.type === 'pan' ? 'grabbing' : cursorFor(hit);
});

document.addEventListener('mousemove', e => {
  if (!drag) {
    if (S.refAdjust && e.target === overlay) {
      const p = overlayPos(e);
      overlay.style.cursor = cursorFor(hitTest(frame(), p.x, p.y));
    }
    return;
  }
  if (drag.type === 'pan') {
    canvasContainer.scrollLeft = drag.scrollX - (e.clientX - drag.x);
    canvasContainer.scrollTop  = drag.scrollY - (e.clientY - drag.y);
    return;   // the scroll listener redraws the handles
  }
  const p = overlayPos(e), f = frame();
  if (drag.type === 'move') {
    setCentre(f, p.x - drag.dx, p.y - drag.dy);
  } else if (drag.type === 'rotate') {
    const deg = drag.startRot + (Math.atan2(p.y - f.y, p.x - f.x) - drag.startAngle) * 180 / Math.PI;
    S.refRotation = normalizeAngle(e.shiftKey ? Math.round(deg / 15) * 15 : deg);
  } else {
    const v = rotate(p.x - drag.ax, p.y - drag.ay, -f.a);
    const w = Math.abs(v.x) / (Math.abs(v.y) || 1e-4) >= drag.ar ? Math.abs(v.x) : Math.abs(v.y) * drag.ar;
    S.refScale = clampScale(drag.startScale * Math.max(1, w) / drag.startW);
    const nw = drag.startW * S.refScale / drag.startScale, nh = nw / drag.ar;
    const off = rotate(drag.sx * nw / 2, drag.sy * nh / 2, f.a);
    setCentre(f, drag.ax + off.x, drag.ay + off.y);
  }
  applyTransform();
});

document.addEventListener('mouseup', () => {
  if (!drag) return;
  drag = null;
  overlay.style.cursor = '';
});

overlay.addEventListener('contextmenu', e => e.preventDefault());

/** Wheel: scale around the mouse pointer; Shift+wheel rotates by 1°; Ctrl+wheel zooms the view. */
overlay.addEventListener('wheel', e => {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) { e.deltaY > 0 ? zoomOut() : zoomIn(); return; }
  const delta = e.deltaY || e.deltaX;
  if (!delta) return;
  if (e.shiftKey) {
    S.refRotation = normalizeAngle(S.refRotation + Math.sign(delta));
    applyTransform();
    return;
  }
  const f = frame(), p = overlayPos(e);
  const newScale = clampScale(S.refScale * (delta < 0 ? 1.1 : 1 / 1.1));
  const k = newScale / S.refScale;
  // keep the image point under the pointer in place: centre' = pointer − (pointer − centre) · k
  setCentre(f, p.x - (p.x - f.x) * k, p.y - (p.y - f.y) * k);
  S.refScale = newScale;
  applyTransform();
}, { passive: false });

// keep the handles in sync with scrolling, zooming and layout changes
canvasContainer.addEventListener('scroll', drawHandles);
new ResizeObserver(() => { if (S.refAdjust) resizeOverlay(); }).observe(canvasContainer);
new ResizeObserver(drawHandles).observe(canvasWrapper);
