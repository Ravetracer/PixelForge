import { rgbaToHex } from './color.js';

// ══════════════════════════════════════════════════════════════
//  Constants
// ══════════════════════════════════════════════════════════════

export const ZOOM_LEVELS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24];

export const DEFAULT_PALETTE = [
  '#000000','#1d2b53','#7e2553','#008751',
  '#ab5236','#5f574f','#c2c3c7','#fff1e8',
  '#ff004d','#ffa300','#ffec27','#00e436',
  '#29adff','#83769c','#ff77a8','#ffccaa',
  '#ffffff','#eeeeee','#aaaaaa','#555555',
  '#ff0000','#880000','#ff8800','#884400',
  '#ffff00','#888800','#00ff00','#008800',
  '#00ffff','#008888','#0000ff','#000088',
];

// Colodore palette — C64 hardware colour indices 0–15 (from lospec.com/palette-list/colodore)
export const C64_PALETTE_RGB = [
  [  0,  0,  0], // 0  Black
  [255,255,255], // 1  White
  [129, 51, 56], // 2  Red
  [117,206,200], // 3  Cyan
  [142, 60,151], // 4  Purple
  [ 86,172, 77], // 5  Green
  [ 46, 44,155], // 6  Blue
  [237,241,113], // 7  Yellow
  [142, 80, 41], // 8  Orange
  [ 85, 56,  0], // 9  Brown
  [196,108,113], // 10 Light Red
  [ 74, 74, 74], // 11 Dark Grey
  [123,123,123], // 12 Grey
  [169,255,159], // 13 Light Green
  [112,109,235], // 14 Light Blue
  [178,178,178], // 15 Light Grey
];

// Same palette as hex strings, in C64 hardware order
export const COLODORE_HEX = C64_PALETTE_RGB.map(([r,g,b]) => rgbaToHex(r,g,b));

export const C64_COLOR_NAMES = [
  'Black','White','Red','Cyan','Purple','Green','Blue','Yellow',
  'Orange','Brown','Light Red','Dark Grey','Grey','Light Green','Light Blue','Light Grey',
];

export const TOOL_NAMES = {
  pencil:'Pencil', eraser:'Eraser', fill:'Fill',
  eyedropper:'Eyedropper', line:'Line', rect:'Rectangle',
  'rect-fill':'Filled Rect', circle:'Circle', 'circle-fill':'Filled Circle',
  dither:'Dither', shade:'Shade', replace:'Replace',
  'select-rect':'Select', 'select-lasso':'Lasso', 'select-wand':'Magic Wand', move:'Move',
};

export const SHAPE_TOOLS = new Set(['line','rect','rect-fill','circle','circle-fill']);
