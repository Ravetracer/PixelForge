import { $ } from '../dom.js';
import { TR, tracerCanvas, tracerCtx, tracerWrap } from './tracer-state.js';
import { tracerLivePreview } from './tracer.js';

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

// ── Crop box helpers ──────────────────────────────────────────

export function tracerUpdateCropFromDst() {
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

// Hit-test: is canvas point (cx,cy) inside the crop box?
function inCropBox(cx, cy) {
  const tl = imgToCanvas(TR.cropX, TR.cropY);
  const br = imgToCanvas(TR.cropX + TR.cropW, TR.cropY + TR.cropH);
  return cx >= tl.x && cx <= br.x && cy >= tl.y && cy <= br.y;
}

// ── Corner-handle hit-testing ─────────────────────────────────

const TRACER_HANDLE_HIT = 10; // canvas-px detection radius

function tracerGetHandle(cx, cy) {
  if (!TR.srcImage) return null;
  const tl = imgToCanvas(TR.cropX,            TR.cropY);
  const br = imgToCanvas(TR.cropX + TR.cropW,  TR.cropY + TR.cropH);
  const corners = [
    { name: 'nw', x: tl.x, y: tl.y },
    { name: 'ne', x: br.x, y: tl.y },
    { name: 'sw', x: tl.x, y: br.y },
    { name: 'se', x: br.x, y: br.y },
  ];
  for (const c of corners) {
    if (Math.abs(cx - c.x) <= TRACER_HANDLE_HIT && Math.abs(cy - c.y) <= TRACER_HANDLE_HIT)
      return c.name;
  }
  return null;
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
  const ox = TR.viewOriginX, oy = TR.viewOriginY;
  const sw = iw * TR.viewScale, sh = ih * TR.viewScale;

  tracerCtx.imageSmoothingEnabled = TR.viewScale < 1;
  tracerCtx.imageSmoothingQuality = 'high';
  tracerCtx.drawImage(TR.srcImage, ox, oy, sw, sh);

  // Dark vignette outside crop area
  const ctl = imgToCanvas(TR.cropX, TR.cropY);
  const cbr = imgToCanvas(TR.cropX + TR.cropW, TR.cropY + TR.cropH);
  tracerCtx.save();
  tracerCtx.fillStyle = 'rgba(0,0,0,.55)';
  // Top strip
  tracerCtx.fillRect(0, 0, cw, ctl.y);
  // Bottom strip
  tracerCtx.fillRect(0, cbr.y, cw, ch - cbr.y);
  // Left strip (middle band)
  tracerCtx.fillRect(0, ctl.y, ctl.x, cbr.y - ctl.y);
  // Right strip
  tracerCtx.fillRect(cbr.x, ctl.y, cw - cbr.x, cbr.y - ctl.y);
  tracerCtx.restore();

  // Crop box border
  const bw = cbr.x - ctl.x, bh = cbr.y - ctl.y;
  tracerCtx.save();
  tracerCtx.strokeStyle = '#fff';
  tracerCtx.lineWidth = 1.5;
  tracerCtx.strokeRect(ctl.x, ctl.y, bw, bh);
  // Rule-of-thirds lines
  tracerCtx.strokeStyle = 'rgba(255,255,255,.35)';
  tracerCtx.lineWidth = 0.5;
  tracerCtx.beginPath();
  for (let n = 1; n <= 2; n++) {
    tracerCtx.moveTo(ctl.x + bw*n/3, ctl.y);
    tracerCtx.lineTo(ctl.x + bw*n/3, cbr.y);
    tracerCtx.moveTo(ctl.x, ctl.y + bh*n/3);
    tracerCtx.lineTo(cbr.x, ctl.y + bh*n/3);
  }
  tracerCtx.stroke();
  // Corner handles
  const hs = 10;
  tracerCtx.fillStyle = '#fff';
  tracerCtx.strokeStyle = 'rgba(0,0,0,.5)';
  tracerCtx.lineWidth = 1;
  [[ctl.x, ctl.y],[cbr.x, ctl.y],[ctl.x, cbr.y],[cbr.x, cbr.y]].forEach(([hx,hy]) => {
    tracerCtx.fillRect(hx - hs/2, hy - hs/2, hs, hs);
    tracerCtx.strokeRect(hx - hs/2, hy - hs/2, hs, hs);
  });
  // Dimension label — for C64 show visual (display) size
  const dimLabel = TR.target ? `${TR.dstW * TR.aspect}×${TR.dstH} (C64)` : `${TR.dstW}×${TR.dstH}`;
  tracerCtx.fillStyle = 'rgba(0,0,0,.7)';
  tracerCtx.fillRect(ctl.x, cbr.y, 126, 18);
  tracerCtx.fillStyle = '#fff';
  tracerCtx.font = '11px monospace';
  tracerCtx.fillText(dimLabel, ctl.x + 4, cbr.y + 13);
  tracerCtx.restore();
}

// ── Crop resize ───────────────────────────────────────────────

function tracerResizeCropTo(cx, cy) {
  const ip  = canvasToImg(cx, cy);
  const AR  = (TR.dstW * TR.aspect) / TR.dstH;
  const ax  = TR.resizeAnchorImgX, ay = TR.resizeAnchorImgY;
  const iw  = TR.srcImage.naturalWidth, ih = TR.srcImage.naturalHeight;
  const h   = TR.resizeHandle;

  // Distance from fixed anchor to mouse in image space
  const dw = Math.abs(ip.x - ax);
  const dh = Math.abs(ip.y - ay);

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

  // Place top-left based on which corner is being dragged
  let x0 = (h === 'nw' || h === 'sw') ? ax - newW : ax;
  let y0 = (h === 'nw' || h === 'ne') ? ay - newH : ay;

  // Clamp to image bounds
  x0 = Math.max(0, Math.min(iw - 1, x0));
  y0 = Math.max(0, Math.min(ih - 1, y0));
  newW = Math.min(iw - x0, newW);
  newH = Math.min(ih - y0, newH);

  TR.cropX = x0;
  TR.cropY = y0;
  TR.cropW = Math.max(1, newW);
  TR.cropH = Math.max(1, newH);
}

// ── Pan + crop drag ───────────────────────────────────────────

tracerWrap.addEventListener('mousedown', e => {
  if (!TR.srcImage) return;
  const rect = tracerCanvas.getBoundingClientRect();
  const cx = e.clientX - rect.left, cy = e.clientY - rect.top;

  const handle = tracerGetHandle(cx, cy);
  if (handle) {
    // Resize the crop box — store the fixed (anchor) corner in image space
    TR.isResizingCrop   = true;
    TR.resizeHandle     = handle;
    const anchorMap = {
      nw: [TR.cropX + TR.cropW, TR.cropY + TR.cropH],
      ne: [TR.cropX,             TR.cropY + TR.cropH],
      sw: [TR.cropX + TR.cropW, TR.cropY],
      se: [TR.cropX,             TR.cropY],
    };
    [TR.resizeAnchorImgX, TR.resizeAnchorImgY] = anchorMap[handle];
  } else if (inCropBox(cx, cy)) {
    // Move the crop box
    TR.isDraggingCrop = true;
    const ip = canvasToImg(cx, cy);
    TR.cropDragOX = ip.x - TR.cropX;
    TR.cropDragOY = ip.y - TR.cropY;
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

  if (TR.isResizingCrop) {
    tracerResizeCropTo(cx, cy);
    tracerRender();
  } else if (TR.isDraggingCrop) {
    const ip = canvasToImg(cx, cy);
    const iw = TR.srcImage.naturalWidth, ih = TR.srcImage.naturalHeight;
    TR.cropX = Math.max(0, Math.min(iw - TR.cropW, ip.x - TR.cropDragOX));
    TR.cropY = Math.max(0, Math.min(ih - TR.cropH, ip.y - TR.cropDragOY));
    tracerRender();
  } else if (TR.isPanning) {
    TR.viewOriginX += cx - TR.panStartX;
    TR.viewOriginY += cy - TR.panStartY;
    TR.panStartX = cx; TR.panStartY = cy;
    tracerRender();
  }
});

document.addEventListener('mouseup', () => {
  if (TR.isPanning || TR.isDraggingCrop || TR.isResizingCrop) {
    TR.isPanning      = false;
    TR.isDraggingCrop = false;
    TR.isResizingCrop = false;
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

// Cursor feedback: resize handles / move / grab
tracerWrap.addEventListener('mousemove', e => {
  if (TR.isPanning || TR.isDraggingCrop || TR.isResizingCrop) return;
  if (!TR.srcImage) return;
  const rect = tracerCanvas.getBoundingClientRect();
  const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
  const handle = tracerGetHandle(cx, cy);
  if      (handle === 'nw' || handle === 'se') tracerWrap.style.cursor = 'nwse-resize';
  else if (handle === 'ne' || handle === 'sw') tracerWrap.style.cursor = 'nesw-resize';
  else if (inCropBox(cx, cy))                  tracerWrap.style.cursor = 'move';
  else                                         tracerWrap.style.cursor = 'grab';
});
