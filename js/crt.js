// ══════════════════════════════════════════════════════════════
//  CRT look for the preview window: composite-video softening, bloom,
//  scanlines, aperture grille and vignette — Canvas 2D only.
// ══════════════════════════════════════════════════════════════

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

const _patternCache = new Map();

/** Dark gap at the bottom of every scanline of `lineHeight` output pixels. */
function scanlinePattern(ctx, lineHeight) {
  const key = `scan:${lineHeight}`;
  if (!_patternCache.has(key)) {
    const c = makeCanvas(1, lineHeight);
    const g = c.getContext('2d');
    const gap = Math.max(1, Math.round(lineHeight * 0.35));
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillRect(0, lineHeight - gap, 1, gap);
    if (lineHeight >= 4) {             // soften the gap edge
      g.fillStyle = 'rgba(0,0,0,0.2)';
      g.fillRect(0, lineHeight - gap - 1, 1, 1);
    }
    _patternCache.set(key, c);
  }
  return ctx.createPattern(_patternCache.get(key), 'repeat');
}

/** Vertical RGB phosphor stripes (aperture grille), applied with multiply. */
function grillePattern(ctx) {
  if (!_patternCache.has('grille')) {
    const c = makeCanvas(3, 1);
    const g = c.getContext('2d');
    ['#ffb8b8', '#b8ffb8', '#b8b8ff'].forEach((col, i) => { g.fillStyle = col; g.fillRect(i, 0, 1, 1); });
    _patternCache.set('grille', c);
  }
  return ctx.createPattern(_patternCache.get('grille'), 'repeat');
}

/**
 * Draw `src` scaled to w×h with a CRT look.
 * @param lineHeight output pixels per source scanline (controls scanlines and blur radii)
 */
export function renderCrt(ctx, src, w, h, lineHeight) {
  // sharp, nearest-neighbour scaled picture on black
  const sharp = makeCanvas(w, h);
  const sg = sharp.getContext('2d');
  sg.fillStyle = '#000';
  sg.fillRect(0, 0, w, h);
  sg.imageSmoothingEnabled = false;
  sg.drawImage(src, 0, 0, w, h);

  ctx.save();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(sharp, 0, 0);

  // composite video smears neighbouring pixels a little
  ctx.globalAlpha = 0.55;
  ctx.filter = `blur(${Math.max(0.4, lineHeight * 0.3).toFixed(2)}px)`;
  ctx.drawImage(sharp, 0, 0);

  // phosphor glow
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = 0.3;
  ctx.filter = `blur(${(lineHeight * 1.4).toFixed(2)}px)`;
  ctx.drawImage(sharp, 0, 0);
  ctx.filter = 'none';
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  if (lineHeight >= 2) {
    ctx.fillStyle = scanlinePattern(ctx, Math.round(lineHeight));
    ctx.fillRect(0, 0, w, h);
  }
  if (lineHeight >= 3) {
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = grillePattern(ctx);
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
  }

  // darker corners
  const vignette = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) * 0.6);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  // compensate the darkening of scanlines and grille
  const lit = makeCanvas(w, h);
  const lg = lit.getContext('2d');
  lg.filter = 'brightness(1.3) saturate(1.1)';
  lg.drawImage(ctx.canvas, 0, 0);
  ctx.drawImage(lit, 0, 0);
}
