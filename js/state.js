import { DEFAULT_PALETTE } from './constants.js';

// ══════════════════════════════════════════════════════════════
//  State
// ══════════════════════════════════════════════════════════════





 // last position drawn by cursor pulse
 // pixel-perfect tracking

// S.pixels is a virtual property that always points to the active layer's
// pixel buffer, so all existing drawing code works without changes.
const S_base = {
  width: 32, height: 32, zoom: 10,
  showGrid: true,
  pixelPerfect: false,
  tool: 'pencil',
  primaryColor: '#000000', secondaryColor: '#ffffff',
  palette: [...DEFAULT_PALETTE],

  layers: [],
  activeLayerIndex: 0,

  // Reference image (not part of the layer stack, not saved into PNG)
  refImage: null,
  refVisible: true,
  refOpacity: 50,   // 0–100
  refOffX: 0,       // horizontal offset, −100..+100 % of canvas width
  refOffY: 0,       // vertical offset,   −100..+100 % of canvas height
  refScale: 100,    // scale multiplier, 10..400 %
  refName: '',

  // C64 multicolor bitmap mode
  c64Mode: false,
  c64BgColor: '#000000',
  c64Format: null,     // mode id from c64/modes.js while c64Mode is on
  c64Data: null,       // C64 mode state (NUFLI: { pages: [{ mem, extra }] }; super hires: { sprites })
  pixelAspect: 1,      // displayed width of one image pixel (2 for C64 multicolor modes)

  // Selection (see selection.js)
  selection: null,
  floating: null,
  wandContiguous: true,

  // Brush options (see brush.js)
  brushSize: 1,
  brushShape: 'square',
  mirrorX: false,
  mirrorY: false,
  tileMode: false,

  // Transient runtime state shared between modules
  layerIdCtr: 0,
  previewScale: 2,
  previewVisible: true,
  previewCrt: false,
  previewFlicker: false,
  cursorX: -1,
  cursorY: -1,
  pulseRafId: 0,
  pulseCursorX: -1,
  pulseCursorY: -1,
  pp1X: -1,
  pp1Y: -1,
  pp2X: -1,
  pp2Y: -1,
  c64Violation: false,
  preDragSnapshot: null,


  history: [], historyIndex: -1,
  isDrawing: false, drawBtn: 0,
  startX: 0, startY: 0, lastX: 0, lastY: 0,
  isPanning: false, panStartX: 0, panStartY: 0, panScrollX: 0, panScrollY: 0,
};

export const S = Object.defineProperty(S_base, 'pixels', {
  get() { return this.layers[this.activeLayerIndex]?.pixels ?? null; },
  set(v) { if (this.layers[this.activeLayerIndex]) this.layers[this.activeLayerIndex].pixels = v; },
  configurable: true,
  enumerable: false,
});
