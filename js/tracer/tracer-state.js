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
  c64Mode: true,
  c64BgColor: '#000000',
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
export const tracerResultEl = $('tracer-result-canvas');
export const tracerResultCtx = tracerResultEl.getContext('2d');
