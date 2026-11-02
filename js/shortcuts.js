import { S } from './state.js';
import { addLayer, duplicateActiveLayer, moveLayerDown, moveLayerUp } from './layers.js';
import { $ } from './dom.js';
import { redo, undo } from './history.js';
import { zoomIn, zoomOut } from './view.js';
import { setPreviewVisible } from './preview-window.js';
import { savePNG } from './io.js';
import { openTracerIfNotOpen } from './tracer/tracer.js';
import { setBrushSize, toggleMirror, toggleTileMode } from './toolbar.js';
import {
  copySelection, cutSelection, deleteSelection, deselect, dropFloating, handlePasteEvent,
  hasSelection, invertSelection, moveFloating, selectAll, transformSelection,
} from './selection.js';

// ══════════════════════════════════════════════════════════════
//  Keyboard shortcuts
// ══════════════════════════════════════════════════════════════

const KEY_TOOLS = {
  p:'pencil', b:'pencil', e:'eraser', f:'fill', i:'eyedropper',
  l:'line', r:'rect', c:'circle',
  d:'dither', s:'shade', k:'replace',
  m:'select-rect', q:'select-lasso', w:'select-wand', v:'move',
};

const ARROW_STEPS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
const NUDGE_LARGE = 8;

document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

  if (e.ctrlKey || e.metaKey) {
    if (e.key==='z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
    if (e.key==='z' &&  e.shiftKey) { e.preventDefault(); redo(); return; }
    if (e.key==='y')                { e.preventDefault(); redo(); return; }
    if (e.key==='s')                { e.preventDefault(); savePNG(); return; }
    if (e.key==='n')                { e.preventDefault(); $('btn-new').click(); return; }
    if (e.key==='o')                { e.preventDefault(); $('file-input').click(); return; }
    if (e.key==='a')                { e.preventDefault(); selectAll(); return; }
    if (e.key==='d')                { e.preventDefault(); deselect(); return; }
    if (e.key==='i')                { e.preventDefault(); invertSelection(); return; }
    if (e.key==='c')                { e.preventDefault(); copySelection(); return; }
    if (e.key==='x')                { e.preventDefault(); cutSelection(); return; }
    if (e.key==='v') return;        // handled by the 'paste' event below
  }

  // Selection editing
  if (e.key === 'Enter')  { dropFloating(); return; }
  if (e.key === 'Escape') { if (hasSelection()) deselect(); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelection(); return; }
  if (ARROW_STEPS[e.key] && hasSelection()) {
    e.preventDefault();
    const [dx, dy] = ARROW_STEPS[e.key];
    const step = e.shiftKey ? NUDGE_LARGE : 1;
    moveFloating(dx * step, dy * step);
    return;
  }
  // Brush options
  if (e.key >= '1' && e.key <= '8') { setBrushSize(Number(e.key)); return; }
  if (e.shiftKey && e.key.toLowerCase() === 'x') { toggleMirror('x'); return; }
  if (e.shiftKey && e.key.toLowerCase() === 'y') { toggleMirror('y'); return; }
  if (e.shiftKey && e.key.toLowerCase() === 't') { toggleTileMode(); return; }

  if (e.key === '<') { transformSelection('rotCCW'); return; }
  if (e.key === '>') { transformSelection('rotCW');  return; }
  if (e.shiftKey && e.key.toLowerCase() === 'h') { transformSelection('flipH'); return; }
  if (e.shiftKey && e.key.toLowerCase() === 'v') { transformSelection('flipV'); return; }

  const key = e.key.toLowerCase();
  if (key === 't') { openTracerIfNotOpen(); return; }
  if (key === 'g') { $('btn-grid').click(); return; }
  if (key === 'p') { setPreviewVisible(!S.previewVisible); return; }
  if (key === 'x') { $('btn-swap').click(); return; }
  if (key === '+' || key === '=') { zoomIn();  return; }
  if (key === '-')                { zoomOut(); return; }

  // Layer shortcuts
  if (e.shiftKey && key === 'n') { addLayer(); return; }
  if (e.shiftKey && key === 'd') { duplicateActiveLayer(); return; }
  if (key === '[') { moveLayerDown(S.activeLayerIndex); return; }
  if (key === ']') { moveLayerUp(S.activeLayerIndex); return; }

  let tool = null;
  if (e.shiftKey) {
    if (key === 'r') tool = 'rect-fill';
    if (key === 'c') tool = 'circle-fill';
  } else {
    tool = KEY_TOOLS[key] || null;
  }
  if (tool) document.querySelector(`.tool-btn[data-tool="${tool}"]`)?.click();
});

document.addEventListener('paste', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  handlePasteEvent(e);
});
