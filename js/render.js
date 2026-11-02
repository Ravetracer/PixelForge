import { S } from './state.js';
import { $, bgCanvas, bgCtx, canvasWrapper, mainCanvas, mainCtx, off, offCtx, previewCanvas, previewCtx, refCanvas, refCtx, tileCanvas, tileCtx } from './dom.js';
import { hexToRgba } from './color.js';
import { renderPreviewWindow } from './preview-window.js';
import { layerPixelsForDisplay, renderSelection } from './selection.js';
import { BRUSH_TOOLS, brushOrigin } from './brush.js';
import { currentMode } from './c64/modes.js';

// ══════════════════════════════════════════════════════════════
//  Rendering
// ══════════════════════════════════════════════════════════════

export function setupCanvases() {
  const cw = S.width  * S.zoom * S.pixelAspect;
  const ch = S.height * S.zoom;

  // Overlay canvases stay at full zoomed resolution (grid, cursor, reference)
  [refCanvas, previewCanvas].forEach(c => { c.width = cw; c.height = ch; });

  // Pixel canvases render at native image resolution; CSS scales them up.
  // This keeps rendering cost constant regardless of zoom level.
  bgCanvas.width   = S.width; bgCanvas.height   = S.height;
  // Interlaced modes render the blended picture at hires width (IFLI: frame 2 is shifted by half a pixel)
  mainCanvas.width = S.width * (isInterlaced() ? S.pixelAspect : 1); mainCanvas.height = S.height;
  bgCanvas.style.width    = cw + 'px'; bgCanvas.style.height    = ch + 'px';
  mainCanvas.style.width  = cw + 'px'; mainCanvas.style.height  = ch + 'px';

  off.width  = S.width;
  off.height = S.height;
  // Tile mode: the wrapper grows to 3×3 tiles and the real canvases sit in the centre tile
  const tiles = S.tileMode ? 3 : 1;
  canvasWrapper.style.width  = cw * tiles + 'px';
  canvasWrapper.style.height = ch * tiles + 'px';
  canvasWrapper.classList.toggle('tile-mode', S.tileMode);
  canvasWrapper.style.setProperty('--tile-x', S.tileMode ? cw + 'px' : '0px');
  canvasWrapper.style.setProperty('--tile-y', S.tileMode ? ch + 'px' : '0px');
  tileCanvas.width  = S.tileMode ? mainCanvas.width * 3 : 1;
  tileCanvas.height = S.tileMode ? mainCanvas.height * 3 : 1;
  tileCanvas.style.width  = cw * 3 + 'px';
  tileCanvas.style.height = ch * 3 + 'px';
  drawCheckerboard();
  updateGridCSS();
  renderRefImage();
  renderSelection();
  const mode = currentMode();
  const modeTag = mode ? ` [C64 ${mode.label}]` : '';
  $('status-size').textContent = `${S.width} × ${S.height} px${modeTag}`;
}

function drawCheckerboard() {
  // Canvas is at native image resolution; CSS scaling makes each pixel fill zoom² screen pixels.
  // One checker cell per image pixel gives a clear per-pixel transparency indicator.
  const w = bgCanvas.width, h = bgCanvas.height;
  const id = bgCtx.createImageData(w, h);
  const d  = id.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const v = ((x + y) & 1) ? 0x99 : 0x66;
      d[i] = d[i+1] = d[i+2] = v; d[i+3] = 255;
    }
  }
  bgCtx.putImageData(id, 0, 0);
}

/**
 * Reference placement in ref-canvas pixels: centre and unrotated size.
 * Base size fits the image into the canvas; S.refScale multiplies it,
 * S.refOffX/Y shift the centre by a percentage of the canvas size.
 */
export function refLayout() {
  const img = S.refImage;
  const cw = refCanvas.width, ch = refCanvas.height;
  const baseScale = (S.refScale / 100) * Math.min(cw / img.naturalWidth, ch / img.naturalHeight);
  return { cx: cw / 2 + (S.refOffX / 100) * cw, cy: ch / 2 + (S.refOffY / 100) * ch,
           dw: img.naturalWidth * baseScale, dh: img.naturalHeight * baseScale };
}

export function renderRefImage() {
  refCtx.clearRect(0, 0, refCanvas.width, refCanvas.height);
  if (!S.refImage || !S.refVisible) return;
  refCtx.save();
  refCtx.globalAlpha = S.refOpacity / 100;
  refCtx.imageSmoothingEnabled = true;
  refCtx.imageSmoothingQuality = 'high';
  const { cx, cy, dw, dh } = refLayout();
  refCtx.translate(cx, cy);
  refCtx.rotate(S.refRotation * Math.PI / 180);
  refCtx.drawImage(S.refImage, -dw / 2, -dh / 2, dw, dh);
  refCtx.restore();
}

const isInterlaced = () => !!currentMode()?.frames;

export function render() {
  mainCtx.clearRect(0, 0, mainCanvas.width, mainCanvas.height);
  if (isInterlaced()) renderInterlace();
  else renderLayers();
  if (S.tileMode) renderTiles();
  renderOverlay();
  renderPreviewWindow();
}

function renderLayers() {
  // Composite layers bottom (last index) to top (index 0).
  // mainCanvas is at native image resolution; CSS handles zoom scaling.
  // C64 horizontal doubling is also handled by CSS (style.width = width * zoom * 2).
  for (let i = S.layers.length - 1; i >= 0; i--) {
    const layer = S.layers[i];
    if (!layer.visible || !layer.pixels) continue;
    const id = new ImageData(new Uint8ClampedArray(layerPixelsForDisplay(layer)), S.width, S.height);
    offCtx.putImageData(id, 0, 0);
    mainCtx.save();
    mainCtx.globalAlpha = layer.opacity / 100;
    mainCtx.imageSmoothingEnabled = false;
    mainCtx.drawImage(off, 0, 0); // 1:1 copy at native resolution
    mainCtx.restore();
  }
}

/**
 * Interlaced C64 modes (IFLI, SHI, SHIF): the C64 alternates both frames every
 * video frame (IFLI: frame 2 one hires pixel to the right); the eye sees the average colour.
 * Hidden frames drop out of the blend, so each frame can be inspected on its own.
 */
function renderInterlace() {
  mainCtx.putImageData(interlaceImage([1, 2]), 0, 0);
}

/**
 * Picture of the given interlace frames at hires width (frame n shifted by
 * (n−1) × mode.frameShift hires pixels). Several frames are averaged; hidden
 * frame layers are skipped.
 */
export function interlaceImage(frameNumbers) {
  const W = S.width, H = S.height, aspect = S.pixelAspect, OW = W * aspect;
  const frameShift = currentMode()?.frameShift ?? 0;
  const bgLayer = S.layers.find(l => l.isBgLayer);
  const bg = hexToRgba(S.c64BgColor);
  const bgAlpha = bgLayer?.visible === false ? 0 : 255;
  const sources = frameNumbers
    .map(n => ({ layer: S.layers.find(l => l.frame === n), shift: (n - 1) * frameShift }))
    .filter(({ layer }) => layer?.visible)
    .map(({ layer, shift }) => ({ px: layerPixelsForDisplay(layer), shift }));
  const out = new ImageData(OW, H);
  const d = out.data;
  for (let y = 0; y < H; y++) {
    for (let hx = 0; hx < OW; hx++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (const { px, shift } of sources) {
        const x = Math.floor((hx - shift) / aspect);
        const i = (y * W + x) * 4;
        if (x < 0 || px[i + 3] < 10) { r += bg.r; g += bg.g; b += bg.b; a += bgAlpha; }
        else { r += px[i]; g += px[i + 1]; b += px[i + 2]; a += 255; }
      }
      const n = sources.length || 1;
      const o = (y * OW + hx) * 4;
      if (!sources.length) { d[o] = bg.r; d[o + 1] = bg.g; d[o + 2] = bg.b; d[o + 3] = bgAlpha; continue; }
      d[o] = Math.floor(r / n); d[o + 1] = Math.floor(g / n); d[o + 2] = Math.floor(b / n); d[o + 3] = Math.floor(a / n);
    }
  }
  return out;
}

/** Repeat the composited image 3×3 around the canvas (the centre is covered by the real canvases). */
function renderTiles() {
  tileCtx.imageSmoothingEnabled = false;
  for (let ty = 0; ty < 3; ty++) {
    for (let tx = 0; tx < 3; tx++) {
      const w = mainCanvas.width, h = mainCanvas.height;
      tileCtx.drawImage(bgCanvas,   tx * w, ty * h, w, h);
      tileCtx.drawImage(mainCanvas, tx * w, ty * h);
    }
  }
}

// Render the grid as a CSS background-image on previewCanvas so the browser's
// compositor draws it for free — no canvas path/stroke work per frame.
// The grid shows through wherever the canvas drawing is transparent (clearRect).
export function updateGridCSS() {
  if (!S.showGrid || S.zoom < 3) {
    previewCanvas.style.backgroundImage = 'none';
    return;
  }
  const z = S.zoom;
  if (S.c64Mode) {
    const pw = z * S.pixelAspect, ph = z;  // one image pixel
    const tw = z * 8, th = z * 8;          // character cell (8×8 screen pixels)
    previewCanvas.style.backgroundImage = [
      'linear-gradient(to right,  rgba(120,120,140,.25) 1px, transparent 1px)',
      'linear-gradient(to bottom, rgba(120,120,140,.25) 1px, transparent 1px)',
      'linear-gradient(to right,  rgba(200,160,80,.55)  1px, transparent 1px)',
      'linear-gradient(to bottom, rgba(200,160,80,.55)  1px, transparent 1px)',
    ].join(',');
    previewCanvas.style.backgroundSize =
      `${pw}px ${ph}px, ${pw}px ${ph}px, ${tw}px ${th}px, ${tw}px ${th}px`;
    previewCanvas.style.backgroundRepeat = 'repeat';
    // FLI modes: hatch the bug columns, which can only hold background
    const bugW = (currentMode()?.bugChars ?? 0) * tw;
    if (bugW) {
      previewCanvas.style.backgroundImage += ',repeating-linear-gradient(45deg, rgba(255,0,255,.22) 0 3px, transparent 3px 7px)';
      previewCanvas.style.backgroundSize += `, ${bugW}px 100%`;
      previewCanvas.style.backgroundRepeat = 'repeat, repeat, repeat, repeat, no-repeat';
    }
  } else {
    previewCanvas.style.backgroundImage = [
      'linear-gradient(to right,  rgba(120,120,140,.35) 1px, transparent 1px)',
      'linear-gradient(to bottom, rgba(120,120,140,.35) 1px, transparent 1px)',
    ].join(',');
    previewCanvas.style.backgroundSize = `${z}px ${z}px, ${z}px ${z}px`;
  }
}

function renderOverlay() {
  // CSS grid shows through automatically; just ensure no stale canvas drawing remains.
  previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
  S.pulseCursorX = -1; S.pulseCursorY = -1;
}

export function renderPreview(gen, hex) {
  const { r, g, b } = hexToRgba(hex);
  const z = S.zoom;
  const xScale = z * S.pixelAspect;
  // CSS grid shows through transparent areas; just clear the canvas drawing.
  previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
  S.pulseCursorX = -1; S.pulseCursorY = -1;
  previewCtx.fillStyle = `rgba(${r},${g},${b},0.85)`;
  for (const { x, y } of gen) {
    if (x >= 0 && x < S.width && y >= 0 && y < S.height)
      previewCtx.fillRect(x * xScale, y * z, xScale, z);
  }
}

export function clearPreview() {
  previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
  S.pulseCursorX = -1; S.pulseCursorY = -1;
}

let _pulseW = 1, _pulseH = 1; // footprint size (pixels) of the last drawn cursor

function _doCursorPulse(ts) {
  if (S.cursorX < 0 || S.isDrawing) { S.pulseRafId = 0; return; }
  const alpha = 0.35 + 0.65 * Math.abs(Math.sin(ts / 600));
  const z = S.zoom;
  const xScale = z * S.pixelAspect;
  // Only erase the previous cursor rect — much cheaper than clearing the full canvas.
  if (S.pulseCursorX >= 0) {
    previewCtx.clearRect(S.pulseCursorX * xScale - 1, S.pulseCursorY * z - 1, _pulseW * xScale + 2, _pulseH * z + 2);
  }
  // Brush tools show their whole footprint
  const brush = BRUSH_TOOLS.has(S.tool) && S.brushSize > 1;
  const size = brush ? S.brushSize : 1;
  const o = brush ? brushOrigin() : 0;
  S.pulseCursorX = S.cursorX + o; S.pulseCursorY = S.cursorY + o;
  _pulseW = _pulseH = size;
  previewCtx.save();
  previewCtx.strokeStyle = `rgba(210, 210, 210, ${alpha.toFixed(3)})`;
  previewCtx.lineWidth = Math.max(1, Math.min(2, Math.round(z * 0.12)));
  previewCtx.strokeRect(
    S.pulseCursorX * xScale + 0.5,
    S.pulseCursorY * z + 0.5,
    size * xScale - 1,
    size * z - 1
  );
  previewCtx.restore();
  S.pulseRafId = requestAnimationFrame(_doCursorPulse);
}

export function startCursorPulse() {
  if (!S.pulseRafId) S.pulseRafId = requestAnimationFrame(_doCursorPulse);
}
