import * as SH from './pal-shaders.js';

// ══════════════════════════════════════════════════════════════
//  WebGL2 renderer of the PAL video chain:
//  encode → demodulate → filter (+ delay line) → picture tube → bloom → screen
// ══════════════════════════════════════════════════════════════

const FSC = 4.43361875;          // PAL colour subcarrier, MHz
const C64_DOT_CLOCK = 7.881984;  // VIC-II PAL pixel clock, MHz
const ACTIVE_DOTS = 403;         // visible dots of one PAL line at the C64 clock
const MAX_SIGNAL_WIDTH = 4096;
const MAX_KERNEL_RADIUS = 127;
const MODES = { rgb: 0, svideo: 1, composite: 2, rf: 3 };
const MASKS = { none: 0, aperture: 1, slot: 2, shadow: 3 };

// ── FIR kernels ───────────────────────────────────────────────

function gaussianTaps(sigma) {
  const r = Math.min(MAX_KERNEL_RADIUS, Math.max(1, Math.ceil(sigma * 3)));
  const taps = [];
  for (let k = -r; k <= r; k++) taps.push(Math.exp(-0.5 * (k * k) / (sigma * sigma)));
  return normalize(taps);
}

/** Box of fractional length `len` samples: one subcarrier period removes the carrier (notch). */
function boxTaps(len) {
  const half = len / 2;
  const r = Math.ceil(half);
  const taps = [];
  for (let k = -r; k <= r; k++) taps.push(Math.max(0, Math.min(k + 0.5, half) - Math.max(k - 0.5, -half)));
  return normalize(taps);
}

function convolve(a, b) {
  const out = new Array(a.length + b.length - 1).fill(0);
  a.forEach((x, i) => b.forEach((y, j) => { out[i + j] += x * y; }));
  return out;
}

function normalize(taps) {
  const sum = taps.reduce((s, v) => s + v, 0);
  return taps.map(v => v / sum);
}

function trimRadius(taps) {
  const r = (taps.length - 1) / 2;
  if (r <= MAX_KERNEL_RADIUS) return taps;
  return normalize(taps.slice(r - MAX_KERNEL_RADIUS, r + MAX_KERNEL_RADIUS + 1));
}

/** Gaussian sigma (in samples) whose response is −3 dB at `bandwidth` MHz. */
const sigmaFor = (sampleRate, bandwidth) => 0.1325 * sampleRate / bandwidth;

// ── WebGL helpers ─────────────────────────────────────────────

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
  return sh;
}

function makeProgram(gl, vs, fsSrc) {
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  const locs = new Map();
  const loc = name => {
    if (!locs.has(name)) locs.set(name, gl.getUniformLocation(prog, name));
    return locs.get(name);
  };
  return {
    use: () => gl.useProgram(prog),
    f: (name, ...v) => gl[`uniform${v.length}f`](loc(name), ...v),
    i: (name, ...v) => gl[`uniform${v.length}i`](loc(name), ...v),
    fv: (name, arr) => gl.uniform1fv(loc(name), arr),
  };
}

function makeTexture(gl, w, h, { float = true, linear = false } = {}) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  if (float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
  const filter = linear ? gl.LINEAR : gl.NEAREST;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

function makeTarget(gl, w, h, linear) {
  const tex = makeTexture(gl, w, h, { linear });
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  return { tex, fb, w, h };
}

function freeTarget(gl, t) {
  if (!t) return;
  gl.deleteTexture(t.tex);
  gl.deleteFramebuffer(t.fb);
}

// ── Renderer ──────────────────────────────────────────────────

export class PalRenderer {
  /** @returns {PalRenderer|null} null when WebGL2 with float render targets is unavailable */
  static create() {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, preserveDrawingBuffer: true });
      if (!gl || !gl.getExtension('EXT_color_buffer_float')) return null;
      return new PalRenderer(canvas, gl);
    } catch (err) {
      console.warn('PAL emulation unavailable:', err);
      return null;
    }
  }

  constructor(canvas, gl) {
    this.canvas = canvas;
    this.gl = gl;
    const vs = compile(gl, gl.VERTEX_SHADER, SH.VERTEX);
    this.prog = {
      encode: makeProgram(gl, vs, SH.ENCODE),
      demod: makeProgram(gl, vs, SH.DEMOD),
      filter: makeProgram(gl, vs, SH.FILTER),
      display: makeProgram(gl, vs, SH.DISPLAY),
      down: makeProgram(gl, vs, SH.DOWNSAMPLE),
      blur: makeProgram(gl, vs, SH.BLUR),
      final: makeProgram(gl, vs, SH.FINAL),
    };
    gl.bindVertexArray(gl.createVertexArray());
    this.kernelTex = gl.createTexture();
    this.sources = [];
    this.signalKey = '';
    this.outputKey = '';
    this.cur = 0;
  }

  /** Upload the source pictures (1, or 2 for interlace flicker). */
  setSources(canvases, pixelAspect) {
    const gl = this.gl;
    canvases.forEach((src, i) => {
      if (!this.sources[i]) this.sources[i] = makeTexture(gl, 1, 1, { float: false });
      gl.bindTexture(gl.TEXTURE_2D, this.sources[i]);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src);
    });
    this.srcW = canvases[0].width;
    this.srcH = canvases[0].height;
    this.aspect = pixelAspect;
    this.sourceCount = canvases.length;
  }

  /** Signal geometry: samples per dot, clock, subcarrier relation. */
  #timing() {
    const dots = this.srcW * this.aspect;
    const spd = Math.max(1, Math.min(4, Math.floor(MAX_SIGNAL_WIDTH / dots)));
    const dotScale = Math.max(1, dots / ACTIVE_DOTS);
    const dotClock = C64_DOT_CLOCK * dotScale;
    return { dots, spd, dotScale, dotClock, width: Math.ceil(dots * spd), sampleRate: dotClock * spd, cyclesPerDot: FSC / dotClock };
  }

  #ensureTargets(sigW, lines, outW, outH) {
    const gl = this.gl;
    const sKey = `${sigW}x${lines}`;
    if (sKey !== this.signalKey) {
      ['sig', 'demod', 'yuv'].forEach(n => freeTarget(gl, this[n]));
      this.sig = makeTarget(gl, sigW, lines, false);
      this.demod = makeTarget(gl, sigW, lines, false);
      this.yuv = makeTarget(gl, sigW, lines, true);
      this.signalKey = sKey;
    }
    const oKey = `${outW}x${outH}`;
    if (oKey !== this.outputKey) {
      [...(this.disp || []), this.qa, this.qb, this.bloom, this.halo].forEach(t => freeTarget(gl, t));
      this.disp = [makeTarget(gl, outW, outH, true), makeTarget(gl, outW, outH, true)];
      const qw = Math.max(1, Math.ceil(outW / 4)), qh = Math.max(1, Math.ceil(outH / 4));
      [this.qa, this.qb, this.bloom, this.halo] = [0, 0, 0, 0].map(() => makeTarget(gl, qw, qh, true));
      this.canvas.width = outW;
      this.canvas.height = outH;
      this.outputKey = oKey;
    }
  }

  #uploadKernels(luma, chroma) {
    const gl = this.gl;
    const width = 2 * MAX_KERNEL_RADIUS + 1;
    const data = new Float32Array(width * 2);
    data.set(luma, 0);
    data.set(chroma, width);
    gl.bindTexture(gl.TEXTURE_2D, this.kernelTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, width, 2, 0, gl.RED, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  }

  #pass(target, prog, textures = []) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
    gl.viewport(0, 0, target ? target.w : this.canvas.width, target ? target.h : this.canvas.height);
    prog.use();
    textures.forEach(([name, tex], unit) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      prog.i(name, unit);
    });
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Forget the phosphor afterglow (e.g. before rendering a still). */
  resetPersistence() {
    this.clearPersistence = true;
  }

  /**
   * Render one video frame of source `sourceIndex` at `outW`×`outH`.
   * @param p PAL settings (see pal-settings.js)
   * @returns {HTMLCanvasElement}
   */
  render(sourceIndex, frame, outW, outH, p) {
    const gl = this.gl;
    const tm = this.#timing();
    const lines = this.srcH;
    this.#ensureTargets(tm.width, lines, outW, outH);
    const mode = MODES[p.connection] ?? MODES.composite;
    const pct = v => v / 100;

    // filters for the chosen connection
    const lumaGauss = gaussianTaps(sigmaFor(tm.sampleRate, p.lumaBandwidth));
    const notch = mode >= MODES.composite ? boxTaps(tm.spd / tm.cyclesPerDot) : [1];
    const lumaTaps = trimRadius(convolve(lumaGauss, notch));
    const chromaTaps = trimRadius(gaussianTaps(sigmaFor(tm.sampleRate, p.chromaBandwidth)));
    this.#uploadKernels(lumaTaps, chromaTaps);

    const slew = t => (t <= 0 ? 1 : 1 - Math.exp(-(1 / tm.spd) / (t * tm.dotScale / 2.2)));

    // 1 — VIC-II output
    let pr = this.prog.encode;
    pr.use();
    pr.i('uSrcSize', this.srcW, this.srcH);
    pr.f('uAspect', this.aspect);
    pr.f('uSpd', tm.spd);
    pr.f('uCyclesPerDot', tm.cyclesPerDot);
    pr.f('uDotScale', tm.dotScale);
    pr.f('uRiseK', slew(p.lumaRise));
    pr.f('uFallK', slew(p.lumaFall));
    pr.f('uChromaDelay', p.chromaDelay * tm.dotScale);
    pr.f('uOddPhase', p.oddPhase * Math.PI / 180);
    pr.f('uOddAmp', 1 - pct(p.oddSaturation));
    pr.fv('uGlitch', [p.glitchPhi0, p.glitchAec, p.glitchBa, p.glitchRas, p.glitchCas].map(v => pct(v) * 0.06));
    pr.f('uNoiseY', pct(p.noiseY) * 0.12);
    pr.f('uNoiseUV', pct(p.noiseUV) * 0.15);
    pr.f('uFrame', frame);
    this.#pass(this.sig, pr, [['uSrc', this.sources[Math.min(sourceIndex, this.sourceCount - 1)]]]);

    // 2 — transmission and demodulation
    pr = this.prog.demod;
    pr.use();
    pr.i('uWidth', tm.width);
    pr.i('uMode', mode);
    pr.f('uSpd', tm.spd);
    pr.f('uCyclesPerDot', tm.cyclesPerDot);
    pr.f('uGhost', pct(p.ghost) * 0.5);
    pr.i('uGhostDelay', Math.round(0.6 * tm.sampleRate));          // ~0.6 µs reflection
    pr.f('uInterf', pct(p.interference) * 0.12);
    pr.f('uInterfFreq', 1.7 / tm.sampleRate);
    pr.f('uFrame', frame);
    this.#pass(this.demod, pr, [['uSig', this.sig.tex]]);

    // 3 — filters and delay line
    pr = this.prog.filter;
    pr.use();
    pr.i('uWidth', tm.width);
    pr.i('uLumaR', (lumaTaps.length - 1) / 2);
    pr.i('uChromaR', (chromaTaps.length - 1) / 2);
    pr.i('uDelayLine', p.delayLine && mode !== MODES.rgb ? 1 : 0);
    pr.f('uSaturation', pct(p.saturation));
    this.#pass(this.yuv, pr, [['uDemod', this.demod.tex], ['uKernels', this.kernelTex]]);

    // 4 — picture tube
    if (this.clearPersistence) {
      this.disp.forEach(t => { gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb); gl.clear(gl.COLOR_BUFFER_BIT); });
      this.clearPersistence = false;
    }
    const prev = this.disp[this.cur];
    this.cur ^= 1;
    const disp = this.disp[this.cur];
    const beamLines = lines * (p.doubleScan ? 2 : 1);
    const pxPerBeam = outH / beamLines;
    const shade = p.scanlines ? pct(p.scanlineShade) * smoothstep(1.5, 2.5, pxPerBeam) : 0;
    pr = this.prog.display;
    pr.use();
    pr.f('uOut', outW, outH);
    pr.f('uLines', lines);
    pr.f('uDots', tm.dots);
    pr.i('uDoubleScan', p.doubleScan ? 1 : 0);
    pr.f('uShade', shade);
    pr.i('uMaskType', MASKS[p.maskType] ?? 0);
    pr.f('uMaskLevel', pct(p.maskLevel));
    pr.f('uMaskPitch', p.maskPitch);
    pr.f('uGain', pct(p.brightness));
    pr.f('uBacklight', Math.pow(pct(p.backlight), 2.2));   // perceived black level → linear light
    pr.f('uVignette', pct(p.vignette) * 0.7);
    pr.f('uCurvature', pct(p.curvature));
    pr.f('uHum', pct(p.humBar) * 0.25);
    pr.f('uPersist', pct(p.persistence));
    pr.f('uJitter', p.lineJitter * tm.dotScale);
    pr.f('uFrame', frame);
    this.#pass(disp, pr, [['uYuv', this.yuv.tex], ['uPrev', prev.tex]]);

    // 5 — bloom (narrow) and glass reflection (wide) at quarter resolution
    pr = this.prog.down;
    pr.use();
    pr.f('uSrcSize', outW, outH);
    this.#pass(this.qa, pr, [['uTex', disp.tex]]);
    this.#blur(this.qa, this.qb, this.bloom, 1.5);
    this.#blur(this.bloom, this.qa, this.halo, 6);

    pr = this.prog.final;
    pr.use();
    pr.f('uOut', outW, outH);
    pr.f('uBloomAmt', pct(p.bloom) * 0.6);
    pr.f('uHaloAmt', pct(p.halation) * 0.5);
    this.#pass(null, pr, [['uDisp', disp.tex], ['uBloom', this.bloom.tex], ['uHalo', this.halo.tex]]);
    return this.canvas;
  }

  #blur(src, tmp, dst, sigma) {
    const pr = this.prog.blur;
    pr.use();
    pr.f('uSigma', sigma);
    pr.f('uDir', 1, 0);
    this.#pass(tmp, pr, [['uTex', src.tex]]);
    pr.f('uDir', 0, 1);
    this.#pass(dst, pr, [['uTex', tmp.tex]]);
  }
}

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
