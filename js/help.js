import { $ } from './dom.js';
import { BAYER2, BAYER4, BAYER8, KERNELS, adaptiveBayer8Dither, checkerboardDither, errorDiffusionDither, orderedDither, quantizeToRgbPalette } from './tracer/dither.js';

// ══════════════════════════════════════════════════════════════
//  Help / Documentation
// ══════════════════════════════════════════════════════════════

let _helpDitherRendered = false;

function openHelp() {
  $('help-overlay').classList.remove('hidden');
  if (!_helpDitherRendered) { renderDitherExamples(); _helpDitherRendered = true; }
}
function closeHelp() { $('help-overlay').classList.add('hidden'); }

$('btn-help').addEventListener('click', openHelp);
$('btn-help-close').addEventListener('click', closeHelp);
$('help-overlay').addEventListener('click', e => { if (e.target === $('help-overlay')) closeHelp(); });

// Nav: smooth-scroll within the content area
$('help-nav').addEventListener('click', e => {
  const a = e.target.closest('a');
  if (!a) return;
  e.preventDefault();
  const target = document.getElementById(a.getAttribute('href').slice(1));
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('help-nav').querySelectorAll('a').forEach(l => l.classList.remove('active'));
  a.classList.add('active');
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('help-overlay').classList.contains('hidden')) {
    e.stopImmediatePropagation();
    closeHelp();
  }
});

function renderDitherExamples() {
  const W = 128, H = 40;
  const bwPal = [[0, 0, 0], [255, 255, 255]];

  // Black-to-white horizontal gradient
  const gradient = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = Math.round(x * 255 / (W - 1));
      const p = (y * W + x) * 4;
      gradient[p] = v; gradient[p+1] = v; gradient[p+2] = v; gradient[p+3] = 255;
    }
  }

  function makeDitherItem(label, desc, pixels) {
    const item = document.createElement('div');
    item.className = 'help-dither-item';
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    canvas.className = 'help-dither-canvas';
    canvas.getContext('2d').putImageData(new ImageData(pixels, W, H), 0, 0);
    const lbl = document.createElement('div');
    lbl.className = 'dither-label'; lbl.textContent = label;
    const dsc = document.createElement('div');
    dsc.className = 'dither-desc'; dsc.textContent = desc;
    item.append(canvas, lbl, dsc);
    return item;
  }

  const ed = $('help-dither-ed');
  ed.appendChild(makeDitherItem(
    'Floyd-Steinberg',
    'Classic error diffusion. Distributes error to 4 neighbours. Best all-round quality with an organic look.',
    errorDiffusionDither(gradient, W, H, bwPal, KERNELS['floyd-steinberg'])
  ));
  ed.appendChild(makeDitherItem(
    'Atkinson',
    'Distributes only ¾ of the error. Retains highlights and shadows; produces a crisper, slightly lighter result than Floyd-Steinberg.',
    errorDiffusionDither(gradient, W, H, bwPal, KERNELS['atkinson'])
  ));
  ed.appendChild(makeDitherItem(
    'Stucki',
    'Wide 3-row kernel. Smooth gradients with fine grain; works well on photographic material.',
    errorDiffusionDither(gradient, W, H, bwPal, KERNELS['stucki'])
  ));
  ed.appendChild(makeDitherItem(
    'Jarvis-Judice-Ninke',
    'Wide 3-row kernel with different weights than Stucki. Slightly smoother in flat areas.',
    errorDiffusionDither(gradient, W, H, bwPal, KERNELS['jarvis'])
  ));
  ed.appendChild(makeDitherItem(
    'Sierra',
    '3-row kernel. Good balance of smoothness and grain; less computationally heavy than Stucki/Jarvis.',
    errorDiffusionDither(gradient, W, H, bwPal, KERNELS['sierra'])
  ));
  ed.appendChild(makeDitherItem(
    'Sierra (2-row)',
    'Faster 2-row variant of Sierra. Slightly coarser transitions, very good performance.',
    errorDiffusionDither(gradient, W, H, bwPal, KERNELS['sierra2'])
  ));

  const ord = $('help-dither-ord');
  ord.appendChild(makeDitherItem(
    'Bayer 2×2',
    'Coarsest ordered matrix. Very visible 2×2 block pattern. Ideal for bold retro pixel art.',
    orderedDither(gradient, W, H, bwPal, BAYER2, 2, 4, 24)
  ));
  ord.appendChild(makeDitherItem(
    'Bayer 4×4',
    'Medium 4×4 matrix. Balanced dot pattern; classic look for 1-bit or limited-palette graphics.',
    orderedDither(gradient, W, H, bwPal, BAYER4, 4, 16, 32)
  ));
  ord.appendChild(makeDitherItem(
    'Bayer 8×8',
    'Fine 8×8 matrix. Densest regular dot pattern; resembles a halftone screen.',
    orderedDither(gradient, W, H, bwPal, BAYER8, 8, 64, 40)
  ));
  ord.appendChild(makeDitherItem(
    'Bayer 8×8 (adaptive)',
    'Bayer 8×8 with strength reduced near high-contrast edges. Preserves detail while dithering smooth areas.',
    adaptiveBayer8Dither(gradient, W, H, bwPal)
  ));
  ord.appendChild(makeDitherItem(
    'Checkerboard',
    'Alternates a +/− offset on neighbouring pixels before quantizing. Produces a regular checker pattern regardless of local tone.',
    checkerboardDither(gradient, W, H, bwPal)
  ));
  ord.appendChild(makeDitherItem(
    'None',
    'Hard quantization — each pixel maps directly to its nearest palette colour with no error distribution. Best for high-contrast or flat-colour art.',
    quantizeToRgbPalette(gradient, W, H, bwPal)
  ));
}
