import { $ } from '../dom.js';
import { TR, tracerCanvas, tracerCtx, tracerWrap } from './tracer-state.js';
import { tracerLivePreview } from './tracer.js';
import { MODES, snapHeight } from '../c64/modes.js';

/** C64 targets: the crop height is free (in the mode's line steps) via the top/bottom edges. */
const tallTarget = () => !!MODES[TR.target];

// ── Canvas sizing ─────────────────────────────────────────────

export function tracerResizeCanvas() {
  tracerCanvas.width  = tracerWrap.clientWidth;
  tracerCanvas.height = tracerWrap.clientHeight;
  if (TR.srcImage && TR.viewScale === 1 && TR.viewOriginX === 0 && TR.viewOriginY === 0) {
    tracerFitToView();
  }
}

new ResizeObserver(tracerResizeCanvas).observe(tracerWrap);

// ── Viewport / fit ────────────────────────────────────────────

export function tracerFitToView() {
  if (!TR.srcImage) return;
  const cw = tracerCanvas.width, ch = tracerCanvas.height;
  const pad = 20;
  TR.viewScale   = Math.min((cw - pad*2) / TR.srcImage.naturalWidth,
                            (ch - pad*2) / TR.srcImage.naturalHeight);
  TR.viewOriginX = (cw - TR.srcImage.naturalWidth  * TR.viewScale) / 2;
  TR.viewOriginY = (ch - TR.srcImage.naturalHeight * TR.viewScale) / 2;
  $('tracer-zoom-label').textContent = (TR.viewScale * 100 | 0) + '%';
}

function tracerZoomBy(factor, cx, cy) {
  if (!TR.srcImage) return;
  const newScale = Math.max(0.05, Math.min(32, TR.viewScale * factor));
  // zoom around (cx, cy) in canvas space
  const ratio = newScale / TR.viewScale;
  TR.viewOriginX = cx - (cx - TR.viewOriginX) * ratio;
  TR.viewOriginY = cy - (cy - TR.viewOriginY) * ratio;
  TR.viewScale   = newScale;
  $('tracer-zoom-label').textContent = (TR.viewScale * 100 | 0) + '%';
  tracerRender();
}

$('tracer-zoom-in').addEventListener('click',  () => {
  const cx = tracerCanvas.width/2, cy = tracerCanvas.height/2;
  tracerZoomBy(1.25, cx, cy);
});
$('tracer-zoom-out').addEventListener('click', () => {
  const cx = tracerCanvas.width/2, cy = tracerCanvas.height/2;
  tracerZoomBy(0.8, cx, cy);
});
$('tracer-zoom-fit').addEventListener('click', () => { tracerFitToView(); tracerRender(); });

// ── Crop box geometry ─────────────────────────────────────────
// The crop box is cropX/Y/W/H in source-image pixels, rotated by TR.cropRot
// degrees around its centre. "Local" coordinates have their origin in the box
// centre and their axes along the box edges.

const cropAngle  = () => TR.cropRot * Math.PI / 180;
const cropCenter = () => ({ x: TR.cropX + TR.cropW / 2, y: TR.cropY + TR.cropH / 2 });

function setCropCenter(x, y) {
  TR.cropX = x - TR.cropW / 2;
  TR.cropY = y - TR.cropH / 2;
}

function rotate(x, y, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return { x: x * c - y * s, y: x * s + y * c };
}

function localToImg(lx, ly) {
  const c = cropCenter(), v = rotate(lx, ly, cropAngle());
  return { x: c.x + v.x, y: c.y + v.y };
}

function imgToLocal(ix, iy) {
  const c = cropCenter();
  return rotate(ix - c.x, iy - c.y, -cropAngle());
}

// Convert image-pixel coords to canvas-pixel coords
function imgToCanvas(ix, iy) {
  return { x: TR.viewOriginX + ix * TR.viewScale,
           y: TR.viewOriginY + iy * TR.viewScale };
}
// Convert canvas-pixel coords to image-pixel coords
function canvasToImg(cx, cy) {
  return { x: (cx - TR.viewOriginX) / TR.viewScale,
           y: (cy - TR.viewOriginY) / TR.viewScale };
}

function canvasToLocal(cx, cy) {
  const p = canvasToImg(cx, cy);
  return imgToLocal(p.x, p.y);
}

/** Crop box corners in canvas pixels (clockwise from top-left). */
function cropCornersOnCanvas() {
  const hw = TR.cropW / 2, hh = TR.cropH / 2;
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([lx, ly]) => {
    const p = localToImg(lx, ly);
    return imgToCanvas(p.x, p.y);
  });
}

/** Wrap to −180..180 and round to 0.1°. */
function normalizeAngle(deg) {
  const a = ((deg + 180) % 360 + 360) % 360 - 180;
  return Math.round(a * 10) / 10;
}

export function tracerSetCropRotation(deg) {
  TR.cropRot = normalizeAngle(deg);
  $('tracer-rot').value = TR.cropRot;
}

/** Fit a fresh, unrotated crop box with the target's aspect ratio into the image. */
export function tracerResetCrop() {
  if (!TR.srcImage) return;
  const iw = TR.srcImage.naturalWidth, ih = TR.srcImage.naturalHeight;
  // C64 pixels are 2× wide visually, so use visual (display) aspect ratio for cropping
  const dstAR = (TR.dstW * TR.aspect) / TR.dstH;
  const srcAR = iw / ih;
  let cw, ch;
  if (dstAR > srcAR) { cw = iw; ch = iw / dstAR; }
  else               { ch = ih; cw = ih * dstAR; }
  TR.cropX = (iw - cw) / 2;
  TR.cropY = (ih - ch) / 2;
  TR.cropW = cw;
  TR.cropH = ch;
  tracerSetCropRotation(0);
}

/**
 * Target or size changed: keep the selection's centre, width and rotation,
 * only the height follows the new aspect ratio.
 */
export function tracerAdaptCrop() {
  if (!TR.srcImage) return;
  if (!(TR.cropW > 0 && TR.cropH > 0)) { tracerResetCrop(); return; }
  const c = cropCenter();
  TR.cropH = TR.cropW / ((TR.dstW * TR.aspect) / TR.dstH);
  setCropCenter(c.x, c.y);
}

$('tracer-rot').addEventListener('input', e => {
  tracerSetCropRotation(parseFloat(e.target.value) || 0);
  tracerRender();
  tracerLivePreview();
});

// ── Handle hit-testing ────────────────────────────────────────

const TRACER_HANDLE_HIT = 10;   // canvas-px detection radius
const ROT_HANDLE_DIST   = 26;   // canvas-px distance of the rotation knob above the top edge

// local direction of each handle from the box centre
const HANDLE_SIGNS = { nw: [-1, -1], ne: [1, -1], sw: [-1, 1], se: [1, 1], n: [0, -1], s: [0, 1] };

function inCropBox(cx, cy) {
  const l = canvasToLocal(cx, cy);
  return Math.abs(l.x) <= TR.cropW / 2 && Math.abs(l.y) <= TR.cropH / 2;
}

function tracerGetHandle(cx, cy) {
  if (!TR.srcImage) return null;
  const tol = TRACER_HANDLE_HIT / TR.viewScale;
  const l = canvasToLocal(cx, cy);
  const hw = TR.cropW / 2, hh = TR.cropH / 2;
  if (Math.hypot(l.x, l.y + hh + ROT_HANDLE_DIST / TR.viewScale) <= tol) return 'rotate';
  for (const name of ['nw', 'ne', 'sw', 'se']) {
    const [sx, sy] = HANDLE_SIGNS[name];
    if (Math.abs(l.x - sx * hw) <= tol && Math.abs(l.y - sy * hh) <= tol) return name;
  }
  // tall targets: top and bottom edges change the height only
  if (tallTarget() && Math.abs(l.x) < hw) {
    if (Math.abs(l.y - hh) <= tol) return 's';
    if (Math.abs(l.y + hh) <= tol) return 'n';
  }
  return null;
}

// ── Crop resize / rotate ──────────────────────────────────────

/** New box size: the anchor (opposite corner or edge) stays fixed. */
function placeFromAnchor(w, h) {
  TR.cropW = w;
  TR.cropH = h;
  const off = rotate(TR.resizeSignX * w / 2, TR.resizeSignY * h / 2, cropAngle());
  setCropCenter(TR.resizeAnchorImgX + off.x, TR.resizeAnchorImgY + off.y);
}

/** Pointer position relative to the anchor, in box-aligned axes. */
function anchorToPointer(cx, cy) {
  const ip = canvasToImg(cx, cy);
  return rotate(ip.x - TR.resizeAnchorImgX, ip.y - TR.resizeAnchorImgY, -cropAngle());
}

function tracerResizeCropTo(cx, cy) {
  const AR = (TR.dstW * TR.aspect) / TR.dstH;
  const v  = anchorToPointer(cx, cy);
  const dw = Math.abs(v.x), dh = Math.abs(v.y);

  // Dominant axis → maintain aspect ratio
  let newW, newH;
  if (dw === 0 && dh === 0) { newW = 8; newH = 8 / AR; }
  else if (dw / (dh || 0.0001) >= AR) {
    newW = Math.max(8, dw);
    newH = newW / AR;
  } else {
    newH = Math.max(8 / AR, dh);
    newW = newH * AR;
  }
  placeFromAnchor(newW, newH);
}

/**
 * Drag the top/bottom edge: the width stays, the height snaps to the
 * mode's line steps (usually whole character rows) and becomes the target height.
 */
function tracerResizeEdgeTo(cx, cy) {
  const pxPerLine = TR.cropW / (TR.dstW * TR.aspect);   // source pixels per C64 line
  const dist = Math.max(1, anchorToPointer(cx, cy).y * TR.resizeSignY);
  const lines = snapHeight(MODES[TR.target], dist / pxPerLine);
  placeFromAnchor(TR.cropW, lines * pxPerLine);
  if (lines !== TR.dstH) {
    TR.dstH = lines;
    $('tracer-c64-height').value = lines;
    tracerLivePreview();
  }
}

function pointerAngle(cx, cy) {
  const ip = canvasToImg(cx, cy), c = cropCenter();
  return Math.atan2(ip.y - c.y, ip.x - c.x);
}

function tracerRotateCropTo(cx, cy, snap) {
  const deg = TR.rotStartValue + (pointerAngle(cx, cy) - TR.rotStartAngle) * 180 / Math.PI;
  tracerSetCropRotation(snap ? Math.round(deg / 15) * 15 : deg);
}

// ── Render tracer canvas ──────────────────────────────────────

export function tracerRender() {
  const cw = tracerCanvas.width, ch = tracerCanvas.height;
  tracerCtx.clearRect(0, 0, cw, ch);
  tracerCtx.fillStyle = '#111';
  tracerCtx.fillRect(0, 0, cw, ch);

  if (!TR.srcImage) {
    tracerCtx.fillStyle = 'rgba(255,255,255,.15)';
    tracerCtx.font = '14px sans-serif';
    tracerCtx.textAlign = 'center';
    tracerCtx.fillText('Load a source image to begin', cw/2, ch/2);
    tracerCtx.textAlign = 'left';
    return;
  }

  const iw = TR.srcImage.naturalWidth, ih = TR.srcImage.naturalHeight;
  tracerCtx.imageSmoothingEnabled = TR.viewScale < 1;
  tracerCtx.imageSmoothingQuality = 'high';
  tracerCtx.drawImage(TR.srcImage, TR.viewOriginX, TR.viewOriginY, iw * TR.viewScale, ih * TR.viewScale);

  const corners = cropCornersOnCanvas();

  // Dark vignette outside the (rotated) crop area
  tracerCtx.save();
  tracerCtx.fillStyle = 'rgba(0,0,0,.55)';
  tracerCtx.beginPath();
  tracerCtx.rect(0, 0, cw, ch);
  corners.forEach((p, i) => (i ? tracerCtx.lineTo(p.x, p.y) : tracerCtx.moveTo(p.x, p.y)));
  tracerCtx.closePath();
  tracerCtx.fill('evenodd');
  tracerCtx.restore();

  // Box, thirds and handles are drawn in the box's own (rotated) frame
  const c  = cropCenter(), cc = imgToCanvas(c.x, c.y);
  const bw = TR.cropW * TR.viewScale, bh = TR.cropH * TR.viewScale;
  const x0 = -bw / 2, y0 = -bh / 2;
  tracerCtx.save();
  tracerCtx.translate(cc.x, cc.y);
  tracerCtx.rotate(cropAngle());
  tracerCtx.strokeStyle = '#fff';
  tracerCtx.lineWidth = 1.5;
  tracerCtx.strokeRect(x0, y0, bw, bh);
  // Rule-of-thirds lines
  tracerCtx.strokeStyle = 'rgba(255,255,255,.35)';
  tracerCtx.lineWidth = 0.5;
  tracerCtx.beginPath();
  for (let n = 1; n <= 2; n++) {
    tracerCtx.moveTo(x0 + bw*n/3, y0);
    tracerCtx.lineTo(x0 + bw*n/3, -y0);
    tracerCtx.moveTo(x0, y0 + bh*n/3);
    tracerCtx.lineTo(-x0, y0 + bh*n/3);
  }
  tracerCtx.stroke();
  // Rotation knob above the top edge
  tracerCtx.strokeStyle = '#fff';
  tracerCtx.lineWidth = 1;
  tracerCtx.beginPath();
  tracerCtx.moveTo(0, y0);
  tracerCtx.lineTo(0, y0 - ROT_HANDLE_DIST);
  tracerCtx.stroke();
  tracerCtx.beginPath();
  tracerCtx.arc(0, y0 - ROT_HANDLE_DIST, 5, 0, Math.PI * 2);
  tracerCtx.fillStyle = '#fff';
  tracerCtx.fill();
  tracerCtx.strokeStyle = 'rgba(0,0,0,.5)';
  tracerCtx.stroke();
  // Corner handles
  const hs = 10;
  // tall targets: bars in the middle of the top and bottom edge (height handles)
  if (tallTarget()) {
    [y0, -y0].forEach(hy => {
      tracerCtx.fillRect(-hs * 1.5, hy - hs / 3, hs * 3, hs * 2 / 3);
      tracerCtx.strokeRect(-hs * 1.5, hy - hs / 3, hs * 3, hs * 2 / 3);
    });
  }
  [[x0, y0], [-x0, y0], [x0, -y0], [-x0, -y0]].forEach(([hx, hy]) => {
    tracerCtx.fillRect(hx - hs/2, hy - hs/2, hs, hs);
    tracerCtx.strokeRect(hx - hs/2, hy - hs/2, hs, hs);
  });
  tracerCtx.restore();

  // Dimension label below the box — for C64 show visual (display) size
  const size  = TR.target ? `${TR.dstW * TR.aspect}×${TR.dstH} (C64)` : `${TR.dstW}×${TR.dstH}`;
  const label = TR.cropRot ? `${size} · ${TR.cropRot}°` : size;
  const lx = Math.min(...corners.map(p => p.x)), ly = Math.max(...corners.map(p => p.y));
  tracerCtx.save();
  tracerCtx.font = '11px monospace';
  tracerCtx.fillStyle = 'rgba(0,0,0,.7)';
  tracerCtx.fillRect(lx, ly, tracerCtx.measureText(label).width + 8, 18);
  tracerCtx.fillStyle = '#fff';
  tracerCtx.fillText(label, lx + 4, ly + 13);
  tracerCtx.restore();
}

// ── Pan, crop drag, resize and rotate ─────────────────────────

const isInteracting = () => TR.isPanning || TR.isDraggingCrop || TR.isResizingCrop || TR.isRotatingCrop;

tracerWrap.addEventListener('mousedown', e => {
  if (!TR.srcImage) return;
  const rect = tracerCanvas.getBoundingClientRect();
  const cx = e.clientX - rect.left, cy = e.clientY - rect.top;

  const handle = tracerGetHandle(cx, cy);
  if (handle === 'rotate') {
    TR.isRotatingCrop = true;
    TR.rotStartAngle  = pointerAngle(cx, cy);
    TR.rotStartValue  = TR.cropRot;
  } else if (handle) {
    // Resize the crop box — store the fixed (anchor) corner/edge in image space
    TR.isResizingCrop = true;
    TR.resizeHandle   = handle;
    [TR.resizeSignX, TR.resizeSignY] = HANDLE_SIGNS[handle];
    const anchor = localToImg(-TR.resizeSignX * TR.cropW / 2, -TR.resizeSignY * TR.cropH / 2);
    TR.resizeAnchorImgX = anchor.x;
    TR.resizeAnchorImgY = anchor.y;
  } else if (inCropBox(cx, cy)) {
    // Move the crop box
    TR.isDraggingCrop = true;
    const ip = canvasToImg(cx, cy), c = cropCenter();
    TR.cropDragOX = ip.x - c.x;
    TR.cropDragOY = ip.y - c.y;
  } else {
    // Pan the source image
    TR.isPanning  = true;
    TR.panStartX  = cx; TR.panStartY = cy;
  }
  tracerWrap.classList.add('grabbing');
  e.preventDefault();
});

document.addEventListener('mousemove', e => {
  if (!TR.srcImage) return;
  const rect = tracerCanvas.getBoundingClientRect();
  const cx = e.clientX - rect.left, cy = e.clientY - rect.top;

  if (TR.isRotatingCrop) {
    tracerRotateCropTo(cx, cy, e.shiftKey);
    tracerRender();
  } else if (TR.isResizingCrop) {
    if (TR.resizeHandle === 'n' || TR.resizeHandle === 's') tracerResizeEdgeTo(cx, cy);
    else tracerResizeCropTo(cx, cy);
    tracerRender();
  } else if (TR.isDraggingCrop) {
    // the box may stick out of the image (traced as black), but its centre stays on it
    const ip = canvasToImg(cx, cy);
    const iw = TR.srcImage.naturalWidth, ih = TR.srcImage.naturalHeight;
    setCropCenter(Math.max(0, Math.min(iw, ip.x - TR.cropDragOX)),
                  Math.max(0, Math.min(ih, ip.y - TR.cropDragOY)));
    tracerRender();
  } else if (TR.isPanning) {
    TR.viewOriginX += cx - TR.panStartX;
    TR.viewOriginY += cy - TR.panStartY;
    TR.panStartX = cx; TR.panStartY = cy;
    tracerRender();
  }
});

document.addEventListener('mouseup', () => {
  if (isInteracting()) {
    TR.isPanning      = false;
    TR.isDraggingCrop = false;
    TR.isResizingCrop = false;
    TR.isRotatingCrop = false;
    TR.resizeHandle   = null;
    tracerWrap.classList.remove('grabbing');
    tracerLivePreview();
  }
});

tracerWrap.addEventListener('wheel', e => {
  e.preventDefault();
  const rect = tracerCanvas.getBoundingClientRect();
  const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
  tracerZoomBy(e.deltaY < 0 ? 1.12 : 1/1.12, cx, cy);
}, { passive: false });

// Cursor feedback: resize handles (following the box rotation) / rotate / move / grab
const RESIZE_CURSORS = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'];

function resizeCursor(handle) {
  const [sx, sy] = HANDLE_SIGNS[handle];
  const deg = Math.atan2(sy, sx) * 180 / Math.PI + TR.cropRot;
  return RESIZE_CURSORS[Math.round((((deg % 180) + 180) % 180) / 45) % 4];
}

tracerWrap.addEventListener('mousemove', e => {
  if (isInteracting() || !TR.srcImage) return;
  const rect = tracerCanvas.getBoundingClientRect();
  const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
  const handle = tracerGetHandle(cx, cy);
  if      (handle === 'rotate')  tracerWrap.style.cursor = 'crosshair';
  else if (handle)               tracerWrap.style.cursor = resizeCursor(handle);
  else if (inCropBox(cx, cy))    tracerWrap.style.cursor = 'move';
  else                           tracerWrap.style.cursor = 'grab';
});
