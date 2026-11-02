import { DEFAULT_PALETTE } from '../constants.js';
import { $ } from '../dom.js';

// ══════════════════════════════════════════════════════════════
//  Image Tracer
// ══════════════════════════════════════════════════════════════

export const TR = {
  srcImage:   null,
  srcName:    '',
  // viewport — panning/zooming the source in the preview canvas
  viewScale:  1,
  viewOriginX: 0,   // canvas-px position of image top-left
  viewOriginY: 0,
  // crop box in image-pixel coordinates
  cropX: 0, cropY: 0, cropW: 0, cropH: 0,
  // destination
  dstW: 160, dstH: 200,
  target: 'multicolor',   // '' = normal image, otherwise a C64 mode id
  aspect: 2,              // displayed width of one target pixel
  c64BgColor: '#000000',
  bgAuto: true,
  style: 'pixel',         // 'pixel' (clean edges, outlines) or 'photo' (dithering)
  smoothing: 50,          // edge-preserving smoothing strength 0..100
  outline: 40,            // outline strength 0..100 (0 = off)
  cleanup: true,
  patternMix: true,       // checkerboard mixes for in-between tones
  huePriority: 60,        // colour matching: 0 = brightness first, 100 = hue first
  autoColors: 16,
  dithering: 'floyd-steinberg',
  colorMode: 'full',
  palette: [...DEFAULT_PALETTE],
  // enhancements (applied before dithering)
  brightness: 0, contrast: 0, saturation: 0, vibrance: 0, invert: false,
  // interaction
  isPanning: false, panStartX: 0, panStartY: 0,
  isDraggingCrop: false, cropDragOX: 0, cropDragOY: 0,
  isResizingCrop: false, resizeHandle: null, resizeAnchorImgX: 0, resizeAnchorImgY: 0,
};

export const tracerCanvas   = $('tracer-canvas');
export const tracerCtx      = tracerCanvas.getContext('2d');
export const tracerWrap     = $('tracer-canvas-wrap');
