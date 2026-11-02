import { S } from './state.js';
import { addLayer, deleteLayer, duplicateActiveLayer, mergeVisibleLayers, moveLayerDown, moveLayerUp, setActiveLayer, updateStatusLayer } from './layers.js';
import { $, off, offCtx } from './dom.js';
import { render } from './render.js';
import { updateCursorForLock } from './input.js';

// ══════════════════════════════════════════════════════════════
//  Layer panel UI
// ══════════════════════════════════════════════════════════════

function makeThumbnail(layer) {
  const sz = 24;
  const c = document.createElement('canvas');
  c.width = c.height = sz;
  c.className = 'layer-thumb';
  const ctx = c.getContext('2d');
  // Checkerboard background
  for (let y = 0; y < sz; y += 6)
    for (let x = 0; x < sz; x += 6) {
      ctx.fillStyle = ((Math.floor(x/6)+Math.floor(y/6))%2===0) ? '#888' : '#bbb';
      ctx.fillRect(x, y, 6, 6);
    }
  // Layer pixels
  if (layer.pixels && S.width > 0 && S.height > 0) {
    try {
      const id = new ImageData(new Uint8ClampedArray(layer.pixels), S.width, S.height);
      offCtx.putImageData(id, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(off, 0, 0, sz, sz);
    } catch (_) { /* ignore size mismatch during resize */ }
  }
  return c;
}

export function renderLayerPanel() {
  const list = $('layer-list');
  list.innerHTML = '';

  // Layers[0] = topmost, shown at top of the panel
  S.layers.forEach((layer, i) => {
    const row = document.createElement('div');
    row.className = 'layer-row' + (i === S.activeLayerIndex ? ' active' : '') +
                    (layer.locked ? ' locked-layer' : '');
    row.title = layer.name;

    // Visibility toggle
    const vis = document.createElement('button');
    vis.className = 'lbtn' + (layer.visible ? '' : ' vis-off');
    vis.innerHTML = '👁';
    vis.title = 'Toggle visibility';
    vis.addEventListener('click', e => {
      e.stopPropagation();
      layer.visible = !layer.visible;
      vis.classList.toggle('vis-off', !layer.visible);
      render();
    });

    // Lock toggle
    const lock = document.createElement('button');
    lock.className = 'lbtn' + (layer.locked ? ' locked' : '');
    lock.innerHTML = layer.locked ? '🔒' : '🔓';
    lock.title = 'Toggle lock';
    lock.addEventListener('click', e => {
      e.stopPropagation();
      layer.locked = !layer.locked;
      lock.innerHTML = layer.locked ? '🔒' : '🔓';
      lock.classList.toggle('locked', layer.locked);
      if (i === S.activeLayerIndex) updateCursorForLock();
    });

    // Thumbnail
    const thumb = makeThumbnail(layer);

    // Name input — single click selects layer, double-click enables rename
    const nameInp = document.createElement('input');
    nameInp.type = 'text';
    nameInp.className = 'layer-name-inp';
    nameInp.value = layer.name;
    nameInp.readOnly = true;
    nameInp.addEventListener('mousedown', e => {
      if (i !== S.activeLayerIndex) {
        e.preventDefault();
        setActiveLayer(i);
      } else if (nameInp.readOnly) {
        // Already active — allow double-click to be caught
        e.preventDefault();
      }
    });
    nameInp.addEventListener('dblclick', () => {
      nameInp.readOnly = false;
      nameInp.focus();
      nameInp.select();
    });
    nameInp.addEventListener('blur', () => {
      nameInp.readOnly = true;
      layer.name = nameInp.value.trim() || layer.name;
      nameInp.value = layer.name;
      updateStatusLayer();
    });
    nameInp.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') nameInp.blur();
      if (e.key === 'Escape') { nameInp.value = layer.name; nameInp.blur(); }
    });

    // Move buttons
    const upBtn = document.createElement('button');
    upBtn.className = 'lbtn'; upBtn.innerHTML = '↑'; upBtn.title = 'Move up';
    upBtn.disabled = i === 0 || layer.isBgLayer || S.layers[i-1]?.isBgLayer;
    upBtn.addEventListener('click', e => { e.stopPropagation(); moveLayerUp(i); });

    const dnBtn = document.createElement('button');
    dnBtn.className = 'lbtn'; dnBtn.innerHTML = '↓'; dnBtn.title = 'Move down';
    dnBtn.disabled = i === S.layers.length - 1 || layer.isBgLayer || S.layers[i+1]?.isBgLayer;
    dnBtn.addEventListener('click', e => { e.stopPropagation(); moveLayerDown(i); });

    // Delete
    const delBtn = document.createElement('button');
    delBtn.className = 'lbtn del'; delBtn.innerHTML = '✕'; delBtn.title = 'Delete layer';
    delBtn.disabled = !!layer.isBgLayer || S.c64Mode;
    delBtn.addEventListener('click', e => { e.stopPropagation(); deleteLayer(i); });

    if (S.c64Mode) {
      lock.disabled = true;
    }

    row.append(vis, lock, thumb, nameInp, upBtn, dnBtn, delBtn);
    row.addEventListener('click', () => setActiveLayer(i));
    list.appendChild(row);
  });

  // Active layer opacity slider
  const layer = S.layers[S.activeLayerIndex];
  if (layer) {
    $('layer-opacity').value = layer.opacity;
    $('layer-opacity-val').textContent = layer.opacity + '%';
  }

  updateStatusLayer();
}

// Layer opacity slider
$('layer-opacity').addEventListener('input', e => {
  const layer = S.layers[S.activeLayerIndex];
  if (!layer) return;
  layer.opacity = +e.target.value;
  $('layer-opacity-val').textContent = layer.opacity + '%';
  render();
});

// Layer panel buttons
$('btn-layer-add').addEventListener('click',   addLayer);
$('btn-layer-dup').addEventListener('click',   duplicateActiveLayer);
$('btn-layer-merge').addEventListener('click', mergeVisibleLayers);
