import { S } from './state.js';
import { $ } from './dom.js';
import { render } from './render.js';
import { updateCursorForLock } from './input.js';
import { renderLayerPanel } from './layer-panel.js';
import { syncC64BgLayer } from './c64/c64-ui.js';
import { cancelFloating } from './selection.js';
import { afterC64Edit } from './c64/c64-document.js';

// ══════════════════════════════════════════════════════════════
//  History — captures the full layer stack
// ══════════════════════════════════════════════════════════════

export function snapshotLayers() {
  return {
    activeLayerIndex: S.activeLayerIndex,
    layers: S.layers.map(l => ({
      id: l.id, name: l.name,
      visible: l.visible, locked: l.locked, opacity: l.opacity,
      isBgLayer: l.isBgLayer ?? false,
      ...(l.frame ? { frame: l.frame } : {}),
      pixels: new Uint8ClampedArray(l.pixels),
    })),
    c64Data: cloneC64Data(S.c64Data),
  };
}

/** Mode state of stateful C64 modes (NUFLI memory image) travels with the history. */
function cloneC64Data(data) {
  return data ? { ...data, mem: new Uint8Array(data.mem) } : null;
}

function restoreSnapshot(snap) {
  S.layers = snap.layers.map(s => ({
    id: s.id, name: s.name,
    visible: s.visible, locked: s.locked, opacity: s.opacity,
    isBgLayer: s.isBgLayer ?? false,
    ...(s.frame ? { frame: s.frame } : {}),
    pixels: new Uint8ClampedArray(s.pixels),
  }));
  S.activeLayerIndex = Math.min(snap.activeLayerIndex, S.layers.length - 1);
  if ('c64Data' in snap) S.c64Data = cloneC64Data(snap.c64Data);
}

export function commitHistory() {
  // Modes without a per-pixel colour check (NUFLI) fit the edit into their data here
  afterC64Edit(S.history[S.historyIndex]);
  S.history = S.history.slice(0, S.historyIndex + 1);
  S.history.push(snapshotLayers());
  if (S.history.length > 40) S.history.shift();
  S.historyIndex = S.history.length - 1;
  updateUndoRedo();
}

export function undo() {
  if (cancelFloating()) return;   // undo a pending move/paste/transform first
  if (S.historyIndex <= 0) return;
  S.historyIndex--;
  restoreSnapshot(S.history[S.historyIndex]);
  syncC64BgLayer();
  render(); renderLayerPanel(); updateUndoRedo(); updateCursorForLock();
}

export function redo() {
  if (S.floating) return;
  if (S.historyIndex >= S.history.length - 1) return;
  S.historyIndex++;
  restoreSnapshot(S.history[S.historyIndex]);
  syncC64BgLayer();
  render(); renderLayerPanel(); updateUndoRedo(); updateCursorForLock();
}

export function updateUndoRedo() {
  $('btn-undo').disabled = S.historyIndex <= 0;
  $('btn-redo').disabled = S.historyIndex >= S.history.length - 1;
}
