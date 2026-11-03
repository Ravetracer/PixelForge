// ══════════════════════════════════════════════════════════════
//  Draggable floating panels (preview window, PAL settings)
// ══════════════════════════════════════════════════════════════

/**
 * Make an absolutely positioned `box` draggable by `handle` inside its parent element
 * (which must be the positioned container).
 * The box always stays inside the parent (so its header can never slip behind the
 * top bar); a double-click on the handle restores the default CSS position.
 * @returns {{ resetPosition: () => void }}
 */
export function makeDraggable(box, handle) {
  let drag = null;

  const isMoved = () => box.style.left !== '';

  /** Keep the box (at least its header, if the box is larger) inside the parent. */
  function clamp() {
    if (!isMoved() || box.offsetParent === null) return;   // not moved yet, or hidden
    const parent = box.parentElement;
    const maxLeft = Math.max(0, parent.clientWidth - box.offsetWidth);
    const maxTop = Math.max(0, parent.clientHeight - box.offsetHeight);
    box.style.left = Math.min(maxLeft, Math.max(0, parseFloat(box.style.left) || 0)) + 'px';
    box.style.top = Math.min(maxTop, Math.max(0, parseFloat(box.style.top) || 0)) + 'px';
  }

  function resetPosition() {
    box.style.left = box.style.top = box.style.right = box.style.bottom = '';
  }

  handle.addEventListener('mousedown', e => {
    if (e.button !== 0 || e.target.closest('select, input, button')) return;
    const r = box.getBoundingClientRect();
    const pr = box.parentElement.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, pl: pr.left, pt: pr.top };
    // switch from the CSS anchoring (right/bottom) to explicit left/top
    box.style.left = (r.left - pr.left) + 'px';
    box.style.top = (r.top - pr.top) + 'px';
    box.style.right = 'auto';
    box.style.bottom = 'auto';
    e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (!drag) return;
    box.style.left = (e.clientX - drag.dx - drag.pl) + 'px';
    box.style.top = (e.clientY - drag.dy - drag.pt) + 'px';
    clamp();
  });
  document.addEventListener('mouseup', () => { drag = null; });
  handle.addEventListener('dblclick', e => {
    if (!e.target.closest('select, input, button')) resetPosition();
  });

  // the box or the editor area may change size later (preview scale, window resize)
  const observer = new ResizeObserver(clamp);
  observer.observe(box);
  observer.observe(box.parentElement);
  window.addEventListener('resize', clamp);

  return { resetPosition };
}
