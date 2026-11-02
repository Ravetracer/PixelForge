import { SHAPE_TOOLS } from './constants.js';
import { S } from './state.js';
import { $, canvasContainer, previewCanvas } from './dom.js';
import { hexToRgba, rgbaToHex } from './color.js';
import { getPixelRGBA, paintPixelPerfect, setPixel } from './pixels.js';
import { commitHistory } from './history.js';
import { floodFill, getShapeGenerator, linePixels, replaceColor } from './draw-algorithms.js';
import { clearPreview, render, renderPreview, startCursorPulse } from './render.js';
import { getPixelCoords, zoomIn, zoomOut } from './view.js';
import { setPrimaryColor, setSecondaryColor } from './color-controls.js';
import { showToast } from './toast.js';
import { dropFloating } from './selection.js';
import { BRUSH_TOOLS, beginStroke, endStroke, stampBrush, symmetricPixels, symmetricPoints, usesPixelPerfect } from './brush.js';
import { SELECTION_TOOLS, selectionToolDown, selectionToolMove, selectionToolUp } from './selection-tools.js';
import { currentMode, modeRuleText } from './c64/modes.js';
import { lockRefAfterPaint } from './reference.js';

// ══════════════════════════════════════════════════════════════
//  Mouse / draw handlers
// ══════════════════════════════════════════════════════════════



function activeLayerIsLocked() {
  return S.layers[S.activeLayerIndex]?.locked ?? false;
}

/** One point of a brush stroke: pixel-perfect path for 1 px pencil/eraser, footprint stamp otherwise. */
function paintBrushPoint(x, y, c) {
  if (usesPixelPerfect()) {
    if (S.tool === 'eraser') paintPixelPerfect(x, y, 0, 0, 0, 0);
    else paintPixelPerfect(x, y, c.r, c.g, c.b);
  } else {
    stampBrush(x, y);
  }
}

export function updateCursorForLock() {
  $('canvas-area').classList.toggle('layer-locked', activeLayerIsLocked());
}

previewCanvas.addEventListener('mousedown', e => {
  // Middle mouse = pan
  if (e.button === 1) {
    S.isPanning = true;
    S.panStartX = e.clientX; S.panStartY = e.clientY;
    S.panScrollX = canvasContainer.scrollLeft;
    S.panScrollY = canvasContainer.scrollTop;
    e.preventDefault(); return;
  }

  const { x, y } = getPixelCoords(e);
  if (x < 0 || x >= S.width || y < 0 || y >= S.height) return;

  // Drawing tools need an unlocked layer
  const drawingTools = ['pencil','eraser','fill','line','rect','rect-fill','circle','circle-fill','dither','shade','replace'];
  if (activeLayerIsLocked() && drawingTools.includes(S.tool)) {
    showToast('Layer is locked', 'error'); return;
  }

  clearPreview();

  if (SELECTION_TOOLS.has(S.tool)) {
    S.isDrawing = selectionToolDown(e, x, y);
    e.preventDefault(); return;
  }
  dropFloating();

  S.isDrawing = true;
  S.pp1X = -1; S.pp1Y = -1; S.pp2X = -1; S.pp2Y = -1;
  S.drawBtn   = e.button;
  S.startX = S.lastX = x;
  S.startY = S.lastY = y;
  S.preDragSnapshot = new Uint8ClampedArray(S.pixels);

  const hex = e.button === 2 ? S.secondaryColor : S.primaryColor;
  const c   = hexToRgba(hex);

  if (BRUSH_TOOLS.has(S.tool)) {
    beginStroke(e.button);
    paintBrushPoint(x, y, c);
    render();
    e.preventDefault(); return;
  }

  switch (S.tool) {
    case 'fill':
      for (const [fx, fy] of symmetricPoints(x, y)) floodFill(fx, fy, c.r, c.g, c.b, 255);
      render();
      commitHistory();
      lockRefAfterPaint();
      S.preDragSnapshot = null; S.isDrawing = false; break;

    case 'replace':
      replaceColor(x, y, c.r, c.g, c.b, 255);
      render(); break;   // committed on mouse-up

    case 'eyedropper': {
      const px = getPixelRGBA(x, y);
      if (px && px[3] > 0) {
        const h = rgbaToHex(px[0], px[1], px[2]);
        if (e.button === 2) setSecondaryColor(h); else setPrimaryColor(h);
      }
      S.preDragSnapshot = null; S.isDrawing = false; break;
    }
  }
  e.preventDefault();
});

document.addEventListener('mousemove', e => {
  if (S.isPanning) {
    canvasContainer.scrollLeft = S.panScrollX - (e.clientX - S.panStartX);
    canvasContainer.scrollTop  = S.panScrollY - (e.clientY - S.panStartY);
    return;
  }

  const { x, y } = getPixelCoords(e);
  if (x >= 0 && x < S.width && y >= 0 && y < S.height) {
    const px  = getPixelRGBA(x, y);
    const hex = (px && px[3] > 0) ? rgbaToHex(px[0], px[1], px[2]) : 'transparent';
    $('status-pos').textContent   = `${x} , ${y}`;
    $('status-color').textContent = hex;
    S.cursorX = x; S.cursorY = y;
    if (!S.isDrawing && !S.refAdjust) startCursorPulse();
  } else if (S.cursorX >= 0 && !S.isDrawing) {
    S.cursorX = -1; S.cursorY = -1;
    clearPreview();
  }

  if (!S.isDrawing) return;
  if (SELECTION_TOOLS.has(S.tool)) { selectionToolMove(x, y); return; }

  const hex = S.drawBtn === 2 ? S.secondaryColor : S.primaryColor;
  const c   = hexToRgba(hex);

  if (BRUSH_TOOLS.has(S.tool)) {
    if (S.tool === 'pencil') S.c64Violation = false;
    let skipFirst = true;   // already painted by the previous event
    for (const pt of linePixels(S.lastX, S.lastY, x, y)) {
      if (skipFirst) { skipFirst = false; continue; }
      paintBrushPoint(pt.x, pt.y, c);
    }
    render(); S.lastX = x; S.lastY = y;
    return;
  }

  if (SHAPE_TOOLS.has(S.tool))
    renderPreview(symmetricPixels(getShapeGenerator(S.tool, S.startX, S.startY, x, y)), hex);
});

document.addEventListener('mouseup', e => {
  if (S.isPanning) { S.isPanning = false; return; }
  if (!S.isDrawing) return;
  if (SELECTION_TOOLS.has(S.tool)) {
    selectionToolUp();
    S.isDrawing = false;
    if (S.cursorX >= 0) startCursorPulse();
    return;
  }

  const { x, y } = getPixelCoords(e);
  const hex = S.drawBtn === 2 ? S.secondaryColor : S.primaryColor;
  const c   = hexToRgba(hex);

  S.c64Violation = false;

  if (SHAPE_TOOLS.has(S.tool)) {
    for (const pt of symmetricPixels(getShapeGenerator(S.tool, S.startX, S.startY, x, y)))
      setPixel(pt.x, pt.y, c.r, c.g, c.b);
    render(); clearPreview();
  }

  if (S.c64Mode && S.c64Violation) {
    showToast(`Colour limit — ${modeRuleText(currentMode())}`, 'error');
    S.c64Violation = false;
  }

  // Commit if active layer pixels actually changed
  if (S.preDragSnapshot && S.pixels) {
    let changed = false;
    for (let i = 0; i < S.preDragSnapshot.length; i++) {
      if (S.preDragSnapshot[i] !== S.pixels[i]) { changed = true; break; }
    }
    if (changed) { commitHistory(); lockRefAfterPaint(); }
  }
  S.preDragSnapshot = null;
  S.isDrawing = false;
  endStroke();
  S.pp1X = -1; S.pp1Y = -1; S.pp2X = -1; S.pp2Y = -1;
  if (S.cursorX >= 0) startCursorPulse();
});

previewCanvas.addEventListener('contextmenu', e => e.preventDefault());

previewCanvas.addEventListener('mouseleave', () => {
  S.cursorX = -1; S.cursorY = -1;
  if (!S.isDrawing) clearPreview();
});

previewCanvas.addEventListener('wheel', e => {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    e.deltaY > 0 ? zoomOut() : zoomIn();
  }
}, { passive: false });
