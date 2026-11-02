import { ZOOM_LEVELS } from './constants.js';
import { S } from './state.js';
import { $, canvasContainer, previewCanvas } from './dom.js';
import { render, setupCanvases } from './render.js';

// ══════════════════════════════════════════════════════════════
//  Zoom
// ══════════════════════════════════════════════════════════════

function setZoom(z) {
  const cx = canvasContainer.scrollLeft + canvasContainer.clientWidth  / 2;
  const cy = canvasContainer.scrollTop  + canvasContainer.clientHeight / 2;
  const px = cx / S.zoom, py = cy / S.zoom;
  S.zoom = z;
  setupCanvases();
  render();
  canvasContainer.scrollLeft = px * z - canvasContainer.clientWidth  / 2;
  canvasContainer.scrollTop  = py * z - canvasContainer.clientHeight / 2;
  $('zoom-display').textContent = z + '×';
  $('status-zoom').textContent  = z + '×';
}

export function zoomIn()  {
  const i = ZOOM_LEVELS.indexOf(S.zoom);
  if (i < ZOOM_LEVELS.length-1) setZoom(ZOOM_LEVELS[i+1]);
}
export function zoomOut() {
  const i = ZOOM_LEVELS.indexOf(S.zoom);
  if (i > 0) setZoom(ZOOM_LEVELS[i-1]);
}
export function fitZoom() {
  const padded = 48;
  const maxW = canvasContainer.clientWidth  - padded;
  const maxH = canvasContainer.clientHeight - padded;
  const target = Math.min(maxW / S.width, maxH / S.height);
  const best = ZOOM_LEVELS.reduce((b, z) => z <= target ? z : b, ZOOM_LEVELS[0]);
  setZoom(best);
}

// ══════════════════════════════════════════════════════════════
//  Canvas coordinates
// ══════════════════════════════════════════════════════════════

export function getPixelCoords(e) {
  const rect = previewCanvas.getBoundingClientRect();
  const xScale = S.zoom * S.pixelAspect;
  return {
    x: Math.floor((e.clientX - rect.left) / xScale),
    y: Math.floor((e.clientY - rect.top)  / S.zoom),
  };
}
