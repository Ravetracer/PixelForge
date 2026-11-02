import { S } from './state.js';
import {
  deselect, dropFloating, liftSelection, moveFloating, selectPolygon, selectRect,
  selectWand, setSelectionDraft,
} from './selection.js';

// ══════════════════════════════════════════════════════════════
//  Selection tools: marquee, lasso, magic wand, move
// ══════════════════════════════════════════════════════════════

export const SELECTION_TOOLS = new Set(['select-rect', 'select-lasso', 'select-wand', 'move']);

let _drag = null;

/** Shift adds to the selection, Alt or Ctrl subtracts. */
function selectionMode(e) {
  if (e.shiftKey) return 'add';
  if (e.altKey || e.ctrlKey || e.metaKey) return 'subtract';
  return 'replace';
}

const clampX = x => Math.max(0, Math.min(S.width - 1, x));
const clampY = y => Math.max(0, Math.min(S.height - 1, y));

/** @returns {boolean} true when a drag has started and move/up events should follow */
export function selectionToolDown(e, x, y) {
  switch (S.tool) {
    case 'select-rect':
      dropFloating();
      _drag = { type: 'rect', mode: selectionMode(e), x0: x, y0: y, x1: x, y1: y };
      setSelectionDraft(_drag);
      return true;

    case 'select-lasso':
      dropFloating();
      _drag = { type: 'lasso', mode: selectionMode(e), pts: [{ x, y }] };
      setSelectionDraft(_drag);
      return true;

    case 'select-wand':
      dropFloating();
      selectWand(x, y, selectionMode(e), S.wandContiguous);
      return false;

    case 'move':
      // Alt/Ctrl-drag duplicates the selection instead of cutting it
      if (!liftSelection(e.altKey || e.ctrlKey || e.metaKey)) return false;
      _drag = { type: 'move', lastX: x, lastY: y };
      return true;
  }
  return false;
}

export function selectionToolMove(x, y) {
  if (!_drag) return;
  if (_drag.type === 'rect') {
    _drag.x1 = clampX(x); _drag.y1 = clampY(y);
    setSelectionDraft(_drag);
  } else if (_drag.type === 'lasso') {
    const last = _drag.pts[_drag.pts.length - 1];
    if (last.x !== x || last.y !== y) _drag.pts.push({ x: clampX(x), y: clampY(y) });
    setSelectionDraft(_drag);
  } else if (_drag.type === 'move') {
    const dx = x - _drag.lastX, dy = y - _drag.lastY;
    if (dx || dy) moveFloating(dx, dy);
    _drag.lastX = x; _drag.lastY = y;
  }
}

export function selectionToolUp() {
  const d = _drag;
  _drag = null;
  setSelectionDraft(null);
  if (!d || d.type === 'move') return;

  // A plain click without dragging clears the selection
  const isClick = d.type === 'rect' ? (d.x0 === d.x1 && d.y0 === d.y1) : d.pts.length < 3;
  if (isClick) { if (d.mode === 'replace') deselect(); return; }

  if (d.type === 'rect') selectRect(d.x0, d.y0, d.x1, d.y1, d.mode);
  else selectPolygon(d.pts, d.mode);
}
