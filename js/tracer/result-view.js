import { ZOOM_LEVELS } from '../constants.js';
import { $ } from '../dom.js';

// ══════════════════════════════════════════════════════════════
//  Tracer result view: the traced picture next to the source, with
//  editor-like zoom steps, 1:1 view, fit, panning and a pixel grid.
// ══════════════════════════════════════════════════════════════

const wrap = $('tracer-result-wrap');
const canvas = $('tracer-result-canvas');
const ctx = canvas.getContext('2d');
const GRID_MIN_CELL = 6;          // screen px per picture pixel before the grid shows

const RV = {
  image: null,                    // native-resolution canvas of the result (wide pixels already doubled)
  pixelW: 1,                      // display pixels per picture pixel horizontally (C64 multicolour: 2)
  zoom: 1,
  fit: true,                      // follow the view size until the user zooms or pans
  ox: 0, oy: 0,                   // canvas position of the image's top-left corner
  panning: false, panX: 0, panY: 0,
};

/** Show a new result; zoom and position are kept unless the size changed. */
export function setResultImage(pixels, w, h, pixelW, info) {
  const sizeChanged = !RV.image || RV.image.width !== w || RV.image.height !== h;
  if (sizeChanged) {
    RV.image = document.createElement('canvas');
    RV.image.width = w; RV.image.height = h;
  }
  RV.image.getContext('2d').putImageData(new ImageData(pixels, w, h), 0, 0);
  RV.pixelW = pixelW;
  $('tracer-result-info').textContent = info;
  if (sizeChanged && RV.fit) fitResult();
  else if (sizeChanged) centre();
  renderResult();
}

function resizeCanvas() {
  canvas.width = wrap.clientWidth;
  canvas.height = wrap.clientHeight;
  if (RV.fit) fitResult();
  renderResult();
}

new ResizeObserver(resizeCanvas).observe(wrap);

function centre() {
  RV.ox = Math.round((canvas.width - RV.image.width * RV.zoom) / 2);
  RV.oy = Math.round((canvas.height - RV.image.height * RV.zoom) / 2);
}

function updateZoomLabel() {
  $('tracer-result-zoom').textContent = RV.zoom >= 1 ? `${RV.zoom}×` : `${Math.round(RV.zoom * 100)}%`;
}

/** Largest editor zoom step that shows the whole picture (below 1×: exact fraction). */
function fitResult() {
  RV.fit = true;
  if (!RV.image) return;
  const pad = 16;
  const target = Math.min((canvas.width - pad) / RV.image.width, (canvas.height - pad) / RV.image.height);
  RV.zoom = target >= 1 ? ZOOM_LEVELS.reduce((b, z) => (z <= target ? z : b), 1) : Math.max(0.05, target);
  centre();
  updateZoomLabel();
}

/** Zoom to `z`, keeping the picture point under (cx, cy) in place. */
function zoomTo(z, cx = canvas.width / 2, cy = canvas.height / 2) {
  if (!RV.image) return;
  RV.fit = false;
  RV.ox = Math.round(cx - (cx - RV.ox) * (z / RV.zoom));
  RV.oy = Math.round(cy - (cy - RV.oy) * (z / RV.zoom));
  RV.zoom = z;
  updateZoomLabel();
  renderResult();
}

const nextZoom = () => ZOOM_LEVELS.find(z => z > RV.zoom) ?? RV.zoom;
const prevZoom = () => [...ZOOM_LEVELS].reverse().find(z => z < RV.zoom) ?? RV.zoom;

export function renderResult() {
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!RV.image) {
    ctx.fillStyle = 'rgba(255,255,255,.15)';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('The traced result appears here', canvas.width / 2, canvas.height / 2);
    ctx.textAlign = 'left';
    return;
  }
  const { image, zoom, ox, oy } = RV;
  const dw = image.width * zoom, dh = image.height * zoom;
  ctx.imageSmoothingEnabled = zoom < 1;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, ox, oy, dw, dh);
  drawGrid(dw, dh);
  ctx.strokeStyle = 'rgba(255,255,255,.25)';
  ctx.lineWidth = 1;
  ctx.strokeRect(ox - 0.5, oy - 0.5, dw + 1, dh + 1);
}

/** Pixel grid in picture pixels (wide C64 pixels count as one) for the visible part. */
function drawGrid(dw, dh) {
  const cellW = RV.zoom * RV.pixelW, cellH = RV.zoom;
  if (cellH < GRID_MIN_CELL) return;
  const x0 = Math.max(RV.ox, 0), x1 = Math.min(RV.ox + dw, canvas.width);
  const y0 = Math.max(RV.oy, 0), y1 = Math.min(RV.oy + dh, canvas.height);
  ctx.strokeStyle = 'rgba(0,0,0,.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = RV.ox + Math.ceil((x0 - RV.ox) / cellW) * cellW; x <= x1; x += cellW) {
    ctx.moveTo(Math.round(x) + 0.5, y0); ctx.lineTo(Math.round(x) + 0.5, y1);
  }
  for (let y = RV.oy + Math.ceil((y0 - RV.oy) / cellH) * cellH; y <= y1; y += cellH) {
    ctx.moveTo(x0, Math.round(y) + 0.5); ctx.lineTo(x1, Math.round(y) + 0.5);
  }
  ctx.stroke();
}

// ── controls ──────────────────────────────────────────────────

$('tracer-result-zoom-in').addEventListener('click', () => zoomTo(nextZoom()));
$('tracer-result-zoom-out').addEventListener('click', () => zoomTo(prevZoom()));
$('tracer-result-1to1').addEventListener('click', () => zoomTo(1));
$('tracer-result-fit').addEventListener('click', () => { fitResult(); renderResult(); });

wrap.addEventListener('wheel', e => {
  e.preventDefault();
  const r = canvas.getBoundingClientRect();
  zoomTo(e.deltaY < 0 ? nextZoom() : prevZoom(), e.clientX - r.left, e.clientY - r.top);
}, { passive: false });

wrap.addEventListener('mousedown', e => {
  if (!RV.image || e.button !== 0) return;
  RV.panning = true;
  RV.panX = e.clientX; RV.panY = e.clientY;
  wrap.classList.add('grabbing');
  e.preventDefault();
});

document.addEventListener('mousemove', e => {
  if (!RV.panning) return;
  RV.fit = false;
  RV.ox += e.clientX - RV.panX; RV.oy += e.clientY - RV.panY;
  RV.panX = e.clientX; RV.panY = e.clientY;
  renderResult();
});

document.addEventListener('mouseup', () => {
  if (!RV.panning) return;
  RV.panning = false;
  wrap.classList.remove('grabbing');
});

/** Called when the tracer opens: the result canvas only has a size once it is visible. */
export function resultViewShown() {
  resizeCanvas();
}
