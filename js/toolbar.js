import { TOOL_NAMES } from './constants.js';
import { S } from './state.js';
import { $, canvasContainer, canvasWrapper } from './dom.js';
import { redo, undo } from './history.js';
import { render, setupCanvases, updateGridCSS } from './render.js';
import { fitZoom, zoomIn, zoomOut } from './view.js';
import { dropFloating, renderSelection, transformSelection } from './selection.js';
import { BRUSH_SIZE_MAX, BRUSH_SIZE_MIN } from './brush.js';


// ══════════════════════════════════════════════════════════════
//  Toolbar controls
// ══════════════════════════════════════════════════════════════

$('btn-zoom-in').addEventListener('click',  zoomIn);
$('btn-zoom-out').addEventListener('click', zoomOut);
$('btn-zoom-fit').addEventListener('click', fitZoom);

$('btn-grid').addEventListener('click', () => {
  S.showGrid = !S.showGrid;
  $('btn-grid').classList.toggle('active', S.showGrid);
  updateGridCSS();
  render();
});

$('btn-undo').addEventListener('click', undo);
$('btn-redo').addEventListener('click', redo);

document.querySelectorAll('.tool-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    // Floating pixels stay movable only while the move tool is active
    if (btn.dataset.tool !== 'move') dropFloating();
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    S.tool = btn.dataset.tool;
    document.body.dataset.tool = S.tool;
    $('status-tool').textContent = TOOL_NAMES[S.tool] || S.tool;
  });
});

$('chk-pixel-perfect').addEventListener('change', e => {
  S.pixelPerfect = e.target.checked;
});

$('chk-wand-contiguous').addEventListener('change', e => {
  S.wandContiguous = e.target.checked;
});

// ── Brush options ─────────────────────────────────────────────

export function setBrushSize(size) {
  S.brushSize = Math.max(BRUSH_SIZE_MIN, Math.min(BRUSH_SIZE_MAX, size));
  $('brush-size').value = S.brushSize;
  $('brush-size-val').textContent = S.brushSize;
}
$('brush-size').addEventListener('input', e => setBrushSize(parseInt(e.target.value, 10)));
$('brush-size').addEventListener('change', e => e.target.blur());   // give shortcuts back to the canvas

document.querySelectorAll('[data-brush-shape]').forEach(btn => {
  btn.addEventListener('click', () => {
    S.brushShape = btn.dataset.brushShape;
    document.querySelectorAll('[data-brush-shape]').forEach(b => b.classList.toggle('active', b === btn));
  });
});

export function toggleMirror(axis) {
  const key = axis === 'x' ? 'mirrorX' : 'mirrorY';
  S[key] = !S[key];
  $('btn-mirror-' + axis).classList.toggle('active', S[key]);
  renderSelection();   // draws the mirror guides
}
$('btn-mirror-x').addEventListener('click', () => toggleMirror('x'));
$('btn-mirror-y').addEventListener('click', () => toggleMirror('y'));

export function toggleTileMode() {
  S.tileMode = !S.tileMode;
  $('btn-tile').classList.toggle('active', S.tileMode);
  setupCanvases();
  render();
  // Keep the real canvas (centre tile) in view
  const cw = S.width * S.zoom * S.pixelAspect, ch = S.height * S.zoom;
  const tile = S.tileMode ? 1 : 0;
  canvasContainer.scrollLeft = canvasWrapper.offsetLeft + cw * (tile + 0.5) - canvasContainer.clientWidth / 2;
  canvasContainer.scrollTop  = canvasWrapper.offsetTop  + ch * (tile + 0.5) - canvasContainer.clientHeight / 2;
}
$('btn-tile').addEventListener('click', toggleTileMode);

document.querySelectorAll('.transform-btn').forEach(btn => {
  btn.addEventListener('click', () => transformSelection(btn.dataset.transform));
});
