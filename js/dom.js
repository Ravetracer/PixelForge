// ══════════════════════════════════════════════════════════════
//  DOM refs
// ══════════════════════════════════════════════════════════════

export const $ = id => document.getElementById(id);

export const bgCanvas      = $('bg-canvas');
export const refCanvas     = $('ref-canvas');
export const mainCanvas    = $('main-canvas');
export const previewCanvas = $('preview-canvas');
export const bgCtx         = bgCanvas.getContext('2d');
export const refCtx        = refCanvas.getContext('2d');
export const mainCtx       = mainCanvas.getContext('2d');
export const previewCtx    = previewCanvas.getContext('2d');
export const selCanvas     = $('sel-canvas');
export const selCtx        = selCanvas.getContext('2d');
export const tileCanvas    = $('tile-canvas');
export const tileCtx       = tileCanvas.getContext('2d');
export const canvasContainer = $('canvas-container');
export const canvasWrapper   = $('canvas-wrapper');

// Shared offscreen canvas at native resolution (reused per-layer during render)
export const off    = document.createElement('canvas');
export const offCtx = off.getContext('2d');

// Mini preview window
export const miniPreviewCanvas = $('mini-preview');
export const miniPreviewCtx    = miniPreviewCanvas.getContext('2d');
