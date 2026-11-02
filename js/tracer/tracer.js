import { C64_PALETTE_RGB } from '../constants.js';
import { S } from '../state.js';
import { $ } from '../dom.js';
import { hexToRgba } from '../color.js';
import { snapshotLayers, updateUndoRedo } from '../history.js';
import { render, setupCanvases } from '../render.js';
import { fitZoom } from '../view.js';
import { updateCursorForLock } from '../input.js';
import { renderLayerPanel } from '../layer-panel.js';
import { BG, c64IndexOfHex, nearestC64Color } from '../c64/colors.js';
import { updateC64UI } from '../c64/c64-ui.js';
import { MODES, enforcePages } from '../c64/modes.js';
import { openC64Document } from '../c64/c64-document.js';
import { decodeNufli, emptyNufliMemory, encodeNufliRegion } from '../c64/nufli.js';
import { updateSizeSelect } from '../document.js';
import { showToast } from '../toast.js';
import { TR, tracerResultCtx, tracerResultEl, tracerWrap } from './tracer-state.js';
import { tracerFitToView, tracerRender, tracerResizeCanvas, tracerUpdateCropFromDst } from './viewport.js';
import { applyDithering } from './dither.js';
import { applyEnhancements, tracerDownscale } from './image-processing.js';
import {
  applyOutlines, buildMixPalette, cleanOutlineCorners, detectEdges, kuwahara, majorityDownscale,
  makePaletteMatcher, medianCut, pruneShortOutlines, removeStrayPixels, splitInterlaced,
} from './pixelart.js';
import { resetSelection } from '../selection.js';

// ── open / close ──────────────────────────────────────────────

function openTracer() {
  $('tracer-overlay').classList.remove('hidden');
  tracerResizeCanvas();
  tracerRender();
}

function closeTracer() {
  $('tracer-overlay').classList.add('hidden');
}

$('btn-trace').addEventListener('click', openTracer);
$('tracer-close').addEventListener('click', closeTracer);
$('tracer-overlay').addEventListener('click', e => {
  if (e.target === $('tracer-overlay')) closeTracer();
});

// ── Load source image ─────────────────────────────────────────

$('tracer-load-src').addEventListener('click', () => $('tracer-file-input').click());
$('tracer-file-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {
      TR.srcImage  = img;
      TR.srcName   = file.name;
      tracerFitToView();
      tracerUpdateCropFromDst();
      tracerRender();
      tracerLivePreview();
      $('tracer-src-info').textContent = `${file.name} (${img.naturalWidth}×${img.naturalHeight})`;
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
  e.target.value = '';
});

// Drag-and-drop onto tracer canvas
tracerWrap.addEventListener('dragover', e => e.preventDefault());
tracerWrap.addEventListener('drop', e => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (file && (file.type === 'image/jpeg' || file.type === 'image/png')) {
    $('tracer-file-input').files; // (unused; trigger via FileReader)
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => {
        TR.srcImage = img; TR.srcName = file.name;
        tracerFitToView();
        tracerUpdateCropFromDst();
        tracerRender(); tracerLivePreview();
        $('tracer-src-info').textContent = `${file.name} (${img.naturalWidth}×${img.naturalHeight})`;
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }
});

// ── Palette for tracing ───────────────────────────────────────

/** Palette as [r,g,b] list, or null for unrestricted full colour (photo style only). */
function tracerBuildPalette(workPixels) {
  // IFLI shows the average of two frames: trace against all 136 mixed colours
  if (TR.target === 'ifli' && TR.style === 'pixel') return ifliMixPalette();
  if (TR.target) return C64_PALETTE_RGB;
  if (TR.colorMode === 'palette') return TR.palette.map(hex => { const { r, g, b } = hexToRgba(hex); return [r, g, b]; });
  if (TR.colorMode === 'auto' || TR.style === 'pixel') return medianCut(workPixels, TR.colorMode === 'auto' ? TR.autoColors : 32);
  return null;
}

// ── Live preview ──────────────────────────────────────────────

let _tracerPreviewTimer = null;

export function tracerLivePreview() {
  clearTimeout(_tracerPreviewTimer);
  // the IFLI split and the NUFLI encoder take a moment: wait a little longer
  const slow = TR.target === 'ifli' || TR.target === 'nufli';
  _tracerPreviewTimer = setTimeout(_tracerRunPreview, slow ? 250 : 80);
}

function _tracerRunPreview() {
  if (!TR.srcImage) return;
  const res = traceImage();
  _showTracerResult(res.display, res.displayW, res.displayH);
}

// ── Tracing pipeline ──────────────────────────────────────────

/** Work-image oversampling for the pixel-art style (k×k source samples per target pixel). */
const oversample = (w, h) => Math.max(2, Math.min(8, Math.floor(1280 / Math.max(w, h))));

/**
 * Trace the cropped source to the current target.
 * Returns RGBA at trace resolution, a display image, and for C64 targets
 * the decoded mode data ready to open as a document.
 */
function traceImage() {
  const mode = MODES[TR.target];
  // IFLI is traced at hires width and split into two frames afterwards
  const w = mode?.id === 'ifli' ? 320 : TR.dstW, h = TR.dstH;
  const rgba = TR.style === 'pixel' ? tracePixelArt(w, h) : tracePhoto(w, h);
  if (!mode) return { rgba, w, h, display: rgba, displayW: w, displayH: h };
  return { w, h, ...convertToMode(mode, rgba, w, h) };
}

function tracePhoto(w, h) {
  let pixels = tracerDownscale(TR.srcImage, TR.cropX, TR.cropY, TR.cropW, TR.cropH, w, h);
  pixels = applyEnhancements(pixels, w, h);
  const pal = tracerBuildPalette(pixels);
  return pal ? applyDithering(pixels, w, h, pal) : new Uint8ClampedArray(pixels);
}

function tracePixelArt(w, h) {
  const k = oversample(w, h);
  const ww = w * k, wh = h * k;
  let work = tracerDownscale(TR.srcImage, TR.cropX, TR.cropY, TR.cropW, TR.cropH, ww, wh);
  work = applyEnhancements(work, ww, wh);
  work = kuwahara(work, ww, wh, Math.round((TR.smoothing / 100) * k * 0.75));

  const pal = tracerBuildPalette(work);
  // optional checkerboard mixes (not for IFLI, which mixes through its two frames)
  const entries = TR.patternMix && TR.target !== 'ifli'
    ? buildMixPalette(pal)
    : pal.map((rgb, i) => ({ rgb, a: i, b: i }));
  const matcher = makePaletteMatcher(entries.map(e => e.rgb), TR.huePriority / 100);
  const { indices, dark } = majorityDownscale(work, k, w, h, matcher);
  const base = new Uint8Array(indices);
  let outlined = null;
  if (TR.outline > 0) {
    // outline colour: darker component of the block's dark side, darkened towards the shadows
    const shadeOf = i => {
      const e = entries[i];
      const darkerPart = matcher.labs[e.a][0] <= matcher.labs[e.b][0] ? e.a : e.b;
      const [r, g, b] = pal[darkerPart];
      const shade = matcher.nearest(r * 0.55, g * 0.55, b * 0.55);
      return entries[shade].a === entries[shade].b ? shade : (matcher.labs[entries[shade].a][0] < matcher.labs[entries[shade].b][0] ? entries[shade].a : entries[shade].b);
    };
    // stronger setting → lower gradient threshold → more outlines
    const o = TR.outline / 100;
    const edges = detectEdges(work, ww, wh, 0.02 + 0.16 * o, 30 - 16 * o);
    outlined = applyOutlines(indices, dark, edges, k, w, h, matcher, shadeOf);
    pruneShortOutlines(indices, outlined, w, h, base);
    cleanOutlineCorners(indices, outlined, w, h, base);
  }
  if (TR.cleanup) removeStrayPixels(indices, w, h, outlined);

  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const e = entries[indices[p]];
      const [r, g, b] = pal[((x + y) & 1) ? e.b : e.a];
      out[p * 4] = r; out[p * 4 + 1] = g; out[p * 4 + 2] = b; out[p * 4 + 3] = 255;
    }
  }
  return out;
}

let _ifliMix = null;
function ifliMixPalette() {
  if (!_ifliMix) {
    const seen = new Map();
    for (const a of C64_PALETTE_RGB) for (const b of C64_PALETTE_RGB) {
      const m = [(a[0] + b[0]) >> 1, (a[1] + b[1]) >> 1, (a[2] + b[2]) >> 1];
      seen.set(m.join(','), m);
    }
    _ifliMix = [...seen.values()];
  }
  return _ifliMix;
}

/** Most frequent palette index (background candidate). */
function mostFrequent(idx) {
  const count = new Array(16).fill(0);
  for (const c of idx) count[c]++;
  return count.indexOf(Math.max(...count));
}

/** Fit traced RGBA into a C64 mode: palette indices → mode encoder → decoded result. */
function convertToMode(mode, rgba, w, h) {
  const solid = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) solid[p] = nearestC64Color(rgba[p * 4], rgba[p * 4 + 1], rgba[p * 4 + 2]);
  const bgIdx = TR.bgAuto ? mostFrequent(solid) : c64IndexOfHex(TR.c64BgColor);
  const toBg = idx => idx.map(c => (c === bgIdx ? BG : c));

  if (mode.id === 'nufli') {
    const mem = emptyNufliMemory();
    seedNufliBugColors(mem, solid, w);
    encodeNufliRegion(mem, solid, new Float32Array(w * h).fill(1), { x0: 0, y0: 0, x1: w - 1, y1: h - 1 });
    const idx = decodeNufli(mem);
    return { mode, bgIdx, indices: toBg(idx), data: { mem, extra: new Uint8Array(0), template: false }, ...displayOf(idx, 320, 200) };
  }
  if (mode.frames) {
    const frames = splitInterlaced(rgba, w, h, C64_PALETTE_RGB).map(toBg);
    const decoded = mode.decode(mode.encode(frames, bgIdx));
    return { mode, bgIdx, indices: decoded, ...displayOf(blendFrames(decoded, bgIdx), 320, 200, true) };
  }
  // FLI/AFLI may be taller than 200 lines: their rules are applied page by page
  const decoded = mode.tall ? enforcePages(mode, toBg(solid), bgIdx, h) : mode.decode(mode.encode(toBg(solid), bgIdx));
  const shown = decoded.map(c => (c === BG ? bgIdx : c));
  return { mode, bgIdx, indices: decoded, ...displayOf(shown, w, h, false, mode.aspect) };
}

/**
 * NUFLI bug area (x 0..23): its sprite colours start as the most frequent
 * colours of that strip (sprite 0, then multicolour sprite 7's three colours).
 */
function seedNufliBugColors(mem, solid, w) {
  const count = new Array(16).fill(0);
  for (let y = 0; y < solid.length / w; y++) for (let x = 0; x < 24; x++) count[solid[y * w + x]]++;
  const ranked = count.map((n, c) => [n, c]).sort((a, b) => b[0] - a[0]).map(e => e[1]);
  const [s0, c1 = s0, c2 = c1, c3 = c2] = ranked;
  mem[0x3ff7 - 0x2000] = s0;   // sprite 0 (hires)
  mem[0x3ff1 - 0x2000] = c1;   // $d025
  mem[0x3ff6 - 0x2000] = c2;   // sprite 7 colour
  mem[0x3ff0 - 0x2000] = c3;   // $d026
}

/** Display RGBA for the result preview; wide pixels are doubled. */
function displayOf(idx, w, h, isRgb = false, aspect = 1) {
  const dw = w * aspect;
  const out = new Uint8ClampedArray(dw * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < dw; x++) {
    const o = (y * dw + x) * 4;
    if (isRgb) { out.set(idx.subarray((y * w + x) * 4, (y * w + x) * 4 + 4), o); continue; }
    const [r, g, b] = C64_PALETTE_RGB[idx[y * w + Math.floor(x / aspect)]];
    out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 255;
  }
  return { display: out, displayW: dw, displayH: h };
}

/** IFLI frames → blended 320-wide RGBA (frame 2 one hires pixel to the right). */
function blendFrames([f1, f2], bgIdx) {
  const out = new Uint8ClampedArray(320 * 200 * 4);
  const col = c => C64_PALETTE_RGB[c === BG ? bgIdx : c];
  for (let y = 0; y < 200; y++) for (let x = 0; x < 320; x++) {
    const a = col(f1[y * 160 + (x >> 1)]);
    const b = x > 0 ? col(f2[y * 160 + ((x - 1) >> 1)]) : C64_PALETTE_RGB[bgIdx];
    const o = (y * 320 + x) * 4;
    out[o] = (a[0] + b[0]) >> 1; out[o + 1] = (a[1] + b[1]) >> 1; out[o + 2] = (a[2] + b[2]) >> 1; out[o + 3] = 255;
  }
  return out;
}

function _showTracerResult(pixels, w, h) {
  // Fit result into the result canvas area
  const maxW = 220, maxH = 180;
  const scale = Math.min(maxW / w, maxH / h, 4);
  const dw = Math.round(w * scale), dh = Math.round(h * scale);

  tracerResultEl.width  = dw;
  tracerResultEl.height = dh;

  const tmp = document.createElement('canvas');
  tmp.width = w; tmp.height = h;
  tmp.getContext('2d').putImageData(new ImageData(pixels, w, h), 0, 0);

  tracerResultCtx.imageSmoothingEnabled = false;
  tracerResultCtx.drawImage(tmp, 0, 0, dw, dh);
  const mode = MODES[TR.target];
  $('tracer-result-info').textContent = mode ? `${mode.label} · ${mode.width} × ${TR.dstH}` : `${w} × ${h} px`;
}

// ── Execute trace → load into main canvas ─────────────────────

$('tracer-execute').addEventListener('click', () => {
  if (!TR.srcImage) { showToast('Load a source image first', 'error'); return; }
  const res = traceImage();

  if (res.mode) {
    openC64Document(res.mode.id, res.indices, res.bgIdx, res.data ?? null, res.h);
    closeTracer();
    showToast(`Traced to ${res.mode.label}`, 'success');
    return;
  }

  const { w, h } = res;
  S.width  = w;
  S.height = h;
  S.c64Mode    = false;
  S.c64Format  = null;
  S.c64Data    = null;
  S.pixelAspect = 1;
  S.layerIdCtr  = 0;
  S.layers = [{
    id: ++S.layerIdCtr, name: 'Traced',
    pixels: new Uint8ClampedArray(res.rgba),
    visible: true, locked: false, opacity: 100,
  }];
  S.activeLayerIndex = 0;
  resetSelection();
  S.history     = [snapshotLayers()];
  S.historyIndex = 0;

  setupCanvases();
  fitZoom();
  render();
  renderLayerPanel();
  updateSizeSelect();
  updateUndoRedo();
  updateCursorForLock();
  updateC64UI();

  closeTracer();
  showToast(`Traced to ${w}×${h}`, 'success');
});

// ── Keyboard shortcut ─────────────────────────────────────────

// (wired into the main keydown handler below, just a hook)
export function openTracerIfNotOpen() {
  if (!$('tracer-overlay').classList.contains('hidden')) return;
  openTracer();
}
