import { S } from './state.js';
import { $, canvasContainer, mainCanvas, off, offCtx } from './dom.js';
import { snapshotLayers, updateUndoRedo } from './history.js';
import { render, setupCanvases } from './render.js';
import { fitZoom } from './view.js';
import { updateCursorForLock } from './input.js';
import { resetAdjPanel } from './adjustments.js';
import { renderLayerPanel } from './layer-panel.js';
import { loadC64Bytes } from './c64/c64-document.js';
import { isD64 } from './c64/d64.js';
import { openDiskBrowser } from './c64/disk-browser.js';
import { loadAddress } from './c64/formats.js';
import { updateC64UI } from './c64/c64-ui.js';
import { updateSizeSelect } from './document.js';
import { showToast } from './toast.js';
import { dropFloating, resetSelection } from './selection.js';

// ══════════════════════════════════════════════════════════════
//  File operations
// ══════════════════════════════════════════════════════════════

export function savePNG() {
  dropFloating();
  // Interlaced C64 modes: save the blended picture as seen on screen (320×200)
  if (S.layers.some(l => l.frame)) { downloadCanvas(mainCanvas); return; }
  // Composite all visible layers into a single image for export
  const save = document.createElement('canvas');
  save.width = S.width; save.height = S.height;
  const ctx  = save.getContext('2d');
  for (let i = S.layers.length-1; i >= 0; i--) {
    const layer = S.layers[i];
    if (!layer.visible) continue;
    const id = new ImageData(new Uint8ClampedArray(layer.pixels), S.width, S.height);
    offCtx.putImageData(id, 0, 0);
    ctx.save();
    ctx.globalAlpha = layer.opacity / 100;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0);
    ctx.restore();
  }
  downloadCanvas(save);
}

function downloadCanvas(canvas) {
  const a = document.createElement('a');
  a.download = 'pixel-art.png';
  a.href = canvas.toDataURL('image/png');
  a.click();
  showToast('Saved as pixel-art.png', 'success');
}

const IMAGE_FILE = /\.(png|bmp|gif|jpe?g|webp)$/i;

/** C64 picture files and D64 disk images. */
async function loadC64File(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (isD64(bytes)) { openDiskBrowser(bytes, file.name); return; }
  if (loadC64Bytes(bytes, file.name)) return;
  const addr = loadAddress(bytes);
  if (addr === 0x0801) showToast(`${file.name} is a C64 program (probably a packed viewer) — not a picture file`, 'error');
  else showToast(`Unknown C64 format (load $${addr.toString(16).padStart(4, '0')}, ${bytes.length} bytes)`, 'error');
}

function loadFile(file) {
  if (!IMAGE_FILE.test(file.name) && !file.type.startsWith('image/')) { loadC64File(file); return; }

  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      if (img.width > 2048 || img.height > 2048) {
        showToast('Image too large (max 2048×2048)', 'error'); return;
      }
      S.width  = img.width;
      S.height = img.height;
      const tmp = document.createElement('canvas');
      tmp.width = img.width; tmp.height = img.height;
      tmp.getContext('2d').drawImage(img, 0, 0);
      const raw = tmp.getContext('2d').getImageData(0, 0, img.width, img.height).data;

      // Reset to single layer with loaded image
      S.layerIdCtr = 0;
      S.layers = [{
        id: ++S.layerIdCtr,
        name: 'Layer 1',
        pixels: new Uint8ClampedArray(raw),
        visible: true, locked: false, opacity: 100,
      }];
      S.activeLayerIndex = 0;
      resetSelection();
      S.history = [snapshotLayers()];
      S.historyIndex = 0;

      S.c64Mode = false;
      S.c64Format = null;
      S.c64Data = null;
      S.pixelAspect = 1;
      resetAdjPanel();
      setupCanvases();
      fitZoom();
      render();
      renderLayerPanel();
      updateSizeSelect();
      updateUndoRedo();
      updateCursorForLock();
      updateC64UI();
      showToast(`Loaded ${img.width}×${img.height}`, 'success');
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

$('btn-save').addEventListener('click', savePNG);
$('btn-load').addEventListener('click', () => $('file-input').click());
$('file-input').addEventListener('change', e => {
  if (e.target.files[0]) { loadFile(e.target.files[0]); e.target.value = ''; }
});

// ══════════════════════════════════════════════════════════════
//  Drag-and-drop onto canvas
// ══════════════════════════════════════════════════════════════

canvasContainer.addEventListener('dragover', e => e.preventDefault());
canvasContainer.addEventListener('drop', e => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (file) loadFile(file);
});
