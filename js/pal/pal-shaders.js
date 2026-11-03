// ══════════════════════════════════════════════════════════════
//  GLSL ES 3.00 shaders of the PAL video chain.
//
//  Signal textures are one texel per signal sample (several samples per
//  C64 dot) and one row per picture line; row 0 is the top line.
// ══════════════════════════════════════════════════════════════

export const VERTEX = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const COMMON = `#version 300 es
precision highp float;
precision highp int;
const float TAU = 6.28318530718;

float hash(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}
// roughly normal distributed noise, sigma ~ 1
float gnoise(vec3 p) {
  return (hash(p) + hash(p + 17.13) + hash(p + 31.71) - 1.5) * 2.0;
}
`;

/**
 * Pass 1 — VIC-II output: luma with asymmetric rise/fall slew, bus glitches,
 * noise, and the PAL-modulated chroma (V switched on alternate lines).
 * out: (luma, modulated chroma, baseband U, baseband V)
 */
export const ENCODE = COMMON + `
uniform sampler2D uSrc;
uniform ivec2 uSrcSize;
uniform float uAspect;        // dots per image pixel
uniform float uSpd;           // samples per dot
uniform float uCyclesPerDot;  // subcarrier cycles per dot
uniform float uDotScale;      // dots per C64 dot (large images use a faster clock)
uniform float uRiseK, uFallK; // per-sample slew factors (1 = instant)
uniform float uChromaDelay;   // dots
uniform float uOddPhase;      // radians
uniform float uOddAmp;        // chroma amplitude on odd lines
uniform float uGlitch[5];     // PHI0, AEC, BA, RAS, CAS
uniform float uNoiseY, uNoiseUV;
uniform float uFrame;
out vec4 outSig;

const mat3 RGB2YUV = mat3(0.299, -0.14713, 0.615,
                          0.587, -0.28886, -0.51499,
                          0.114,  0.436,   -0.10001);

vec3 srcRgb(float t, int line) {
  int x = int(floor(t / uAspect));
  if (x < 0 || x >= uSrcSize.x) return vec3(0.0);
  vec4 c = texelFetch(uSrc, ivec2(x, line), 0);
  return c.rgb * c.a;
}

float srcLuma(float t, int line) {
  return dot(vec3(0.299, 0.587, 0.114), srcRgb(t, line));
}

// Exponential decay of a crosstalk spike after a clock edge at cycle position 'edge'.
float spike(float c, float edge) {
  float d = c - edge;
  if (d < 0.0) d += 8.0;
  return exp(-d / 0.6);
}

float busGlitch(float t, int line) {
  float c = mod(t / uDotScale, 8.0);         // position within one CPU cycle (8 dots)
  bool badLine = (line % 8) == 0;
  float g = uGlitch[0] * (spike(c, 4.0) - spike(c, 0.0));
  if (!badLine) g += uGlitch[1] * (spike(c, 4.25) - spike(c, 0.25));
  if (badLine)  g -= uGlitch[2] * 0.6;
  g += uGlitch[3] * (spike(c, 3.5) + spike(c, 7.5) - spike(c, 1.5) - spike(c, 5.5));
  g += uGlitch[4] * (spike(c, 3.8) + spike(c, 7.8) - spike(c, 2.5) - spike(c, 6.5));
  return g;
}

void main() {
  int line = int(gl_FragCoord.y);
  float s = gl_FragCoord.x - 0.5;
  float dt = 1.0 / uSpd;
  float t = (s + 0.5) * dt;

  // luma: first-order response with separate rise and fall time constants
  const int LOOK = 64;
  float t0 = t - float(LOOK) * dt;
  float y = srcLuma(t0, line);
  for (int i = 1; i <= LOOK; i++) {
    float target = srcLuma(t0 + float(i) * dt, line);
    y += (target - y) * (target > y ? uRiseK : uFallK);
  }
  y += busGlitch(t, line);
  y += uNoiseY * gnoise(vec3(s, float(line), uFrame));

  vec2 uv = (RGB2YUV * srcRgb(t - uChromaDelay, line)).yz;
  float cn = floor(t * 0.5);
  uv += uNoiseUV * vec2(gnoise(vec3(cn, float(line), uFrame + 3.0)), gnoise(vec3(cn, float(line), uFrame + 5.0)));

  bool odd = (line & 1) == 1;
  float sw = odd ? -1.0 : 1.0;
  // C64 PAL: 0.5625 subcarrier cycles per dot, 283.5 cycles per line
  float phase = TAU * (uCyclesPerDot * t + 0.5 * float(line)) + (odd ? uOddPhase : 0.0);
  float amp = odd ? uOddAmp : 1.0;
  float chroma = amp * (uv.x * sin(phase) + sw * uv.y * cos(phase));

  outSig = vec4(y, chroma, uv * amp);
}`;

/**
 * Pass 2 — transmission and demodulation, per sample (filtering follows in pass 3).
 * out: (luma source, U·2sin, V·2cos·switch) — or plain Y,U,V for RGB.
 */
export const DEMOD = COMMON + `
uniform sampler2D uSig;
uniform int uWidth;
uniform int uMode;            // 0 RGB, 1 S-Video, 2 composite, 3 RF
uniform float uSpd, uCyclesPerDot;
uniform float uGhost;
uniform int uGhostDelay;      // samples
uniform float uInterf, uInterfFreq;
uniform float uFrame;
out vec4 outDemod;

vec4 sig(int x, int line) {
  return texelFetch(uSig, ivec2(clamp(x, 0, uWidth - 1), line), 0);
}

// The transmitted channels: (luma or composite, chroma)
vec2 channels(int x, int line) {
  vec4 s = sig(x, line);
  vec2 c = uMode == 1 ? s.xy : vec2(s.x + s.y, 0.0);
  if (uGhost > 0.0) {
    vec4 g = sig(x - uGhostDelay, line);
    c += uGhost * (uMode == 1 ? g.xy : vec2(g.x + g.y, 0.0));
  }
  if (uInterf > 0.0) {
    float fx = float(x), fl = float(line);
    c.x += uInterf * (sin(TAU * (fx * uInterfFreq + fl * 0.137 - uFrame * 0.071))
                    + 0.6 * sin(TAU * (fx * uInterfFreq * 2.31 - fl * 0.053 + uFrame * 0.033)));
  }
  return c;
}

void main() {
  int x = int(gl_FragCoord.x);
  int line = int(gl_FragCoord.y);
  if (uMode == 0) {
    vec4 s = sig(x, line);
    outDemod = vec4(s.x, s.zw, 1.0);
    return;
  }
  vec2 c = channels(x, line);
  float carrier = uMode == 1 ? c.y : c.x;   // composite: luma is removed by the low-pass that follows
  float t = (float(x) + 0.5) / uSpd;
  float phase = TAU * (uCyclesPerDot * t + 0.5 * float(line));
  float sw = (line & 1) == 1 ? -1.0 : 1.0;
  outDemod = vec4(c.x, 2.0 * carrier * sin(phase), 2.0 * sw * carrier * cos(phase), 1.0);
}`;

/**
 * Pass 3 — horizontal filters: luma low-pass (with subcarrier notch for composite),
 * chroma low-pass, PAL delay line, saturation.  out: (Y, U, V)
 */
export const FILTER = COMMON + `
uniform sampler2D uDemod;
uniform sampler2D uKernels;   // row 0: luma taps, row 1: chroma taps (centre at index radius)
uniform int uWidth;
uniform int uLumaR, uChromaR;
uniform bool uDelayLine;
uniform float uSaturation;
out vec4 outYuv;

vec4 dm(int x, int line) {
  return texelFetch(uDemod, ivec2(clamp(x, 0, uWidth - 1), line), 0);
}

vec2 chromaAt(int x, int line) {
  vec2 acc = vec2(0.0);
  for (int k = -uChromaR; k <= uChromaR; k++)
    acc += texelFetch(uKernels, ivec2(k + uChromaR, 1), 0).r * dm(x + k, line).yz;
  return acc;
}

void main() {
  int x = int(gl_FragCoord.x);
  int line = int(gl_FragCoord.y);
  float y = 0.0;
  for (int k = -uLumaR; k <= uLumaR; k++)
    y += texelFetch(uKernels, ivec2(k + uLumaR, 0), 0).r * dm(x + k, line).x;
  vec2 uv = chromaAt(x, line);
  if (uDelayLine && line > 0) uv = 0.5 * (uv + chromaAt(x, line - 1));
  outYuv = vec4(y, uv * uSaturation, 1.0);
}`;

/**
 * Pass 4 — the picture tube: geometry, beam profile (scanlines), shadow mask,
 * vignette, backlight and phosphor persistence. Output is linear light.
 */
export const DISPLAY = COMMON + `
uniform sampler2D uYuv;
uniform sampler2D uPrev;
uniform vec2 uOut;            // output size in pixels
uniform float uLines;         // picture lines
uniform float uDots;          // dots per line
uniform bool uDoubleScan;
uniform float uShade;         // 0..1, already faded out for tiny line heights
uniform int uMaskType;        // 0 none, 1 aperture, 2 slot, 3 shadow
uniform float uMaskLevel, uMaskPitch;
uniform float uGain, uBacklight, uVignette, uCurvature, uHum, uPersist, uJitter;
uniform float uFrame;
out vec4 outColor;

vec3 yuv2rgb(vec3 c) {
  return vec3(c.x + 1.13983 * c.z, c.x - 0.39465 * c.y - 0.58060 * c.z, c.x + 2.03211 * c.y);
}

// linear-light colour of one picture line at horizontal position u (0..1)
vec3 lineColor(float u, float line) {
  float l = clamp(line, 0.0, uLines - 1.0);
  float j = uJitter * gnoise(vec3(l, uFrame, 7.0)) * 0.5 / uDots;
  vec3 rgb = yuv2rgb(texture(uYuv, vec2(u + j, (l + 0.5) / uLines)).xyz);
  return pow(clamp(rgb, 0.0, 1.5), vec3(2.2));
}

vec3 mask(vec2 p) {
  if (uMaskType == 0 || uMaskLevel <= 0.0) return vec3(1.0);
  float pitch = uMaskPitch;
  float x = p.x;
  float dim = 1.0;
  if (uMaskType == 2) {                       // slot mask: staggered horizontal breaks
    float col = floor(x / pitch);
    float r = fract((p.y + mod(col, 2.0) * pitch * 1.5) / (pitch * 3.0));
    dim = smoothstep(0.0, 0.12, r) * smoothstep(1.0, 0.88, r) * 0.7 + 0.3;
  } else if (uMaskType == 3) {                // shadow mask: delta triads in offset rows
    float rowH = pitch * 0.6;
    float row = floor(p.y / rowH);
    x += mod(row, 2.0) * pitch * 0.5;
    float r = fract(p.y / rowH);
    dim = smoothstep(0.0, 0.25, r) * smoothstep(1.0, 0.75, r) * 0.7 + 0.3;
  }
  float f = fract(x / pitch) * 3.0;
  vec3 stripes = clamp(vec3(1.0 - abs(f - 0.5), 1.0 - abs(f - 1.5), 1.0 - abs(f - 2.5)) * 1.6, 0.0, 1.0);
  stripes = max(stripes, vec3(1.0 - abs(f - 3.5)) * vec3(1.6, 0.0, 0.0));   // wrap red stripe
  vec3 m = (0.2 + 0.8 * clamp(stripes, 0.0, 1.0)) * dim;
  return mix(vec3(1.0), m * 1.9, uMaskLevel);
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = vec2(frag.x, uOut.y - frag.y) / uOut;           // top-left origin

  // radial distortion: screen corners bend outwards beyond the picture
  vec2 c = uv * 2.0 - 1.0;
  float k = uCurvature * 0.25;
  vec2 sc = c * (1.0 + k * dot(c, c)) / (1.0 + k);
  vec2 su = sc * 0.5 + 0.5;
  vec2 edge = min(su, 1.0 - su) * uOut;
  float inside = clamp(min(edge.x, edge.y) + 0.5, 0.0, 1.0);

  // beam profile across the two nearest lines
  float beamLines = uDoubleScan ? uLines * 2.0 : uLines;
  float ly = su.y * beamLines;
  float l0 = floor(ly - 0.5);
  vec3 flatCol = vec3(0.0), scanCol = vec3(0.0);
  for (int i = 0; i < 2; i++) {
    float l = l0 + float(i);
    float srcLine = uDoubleScan ? floor(l / 2.0) : l;
    vec3 col = lineColor(su.x, srcLine);
    float d = ly - (l + 0.5);
    flatCol += col * (1.0 - abs(d));
    vec3 sigma = mix(vec3(0.2), vec3(0.42), sqrt(clamp(col, 0.0, 1.0)));
    scanCol += col * exp(-0.5 * d * d / (sigma * sigma));
  }
  vec3 color = mix(flatCol, scanCol * 1.08, uShade);

  color *= mask(frag);
  color = color * uGain + uBacklight * vec3(0.9, 1.0, 1.05);
  color *= 1.0 - uVignette * smoothstep(0.2, 1.6, dot(c, c));
  color *= 1.0 - uHum * (0.5 + 0.5 * sin(TAU * (su.y * 0.9 - uFrame * 0.011)));
  color *= inside;

  vec3 prev = texelFetch(uPrev, ivec2(frag), 0).rgb;
  outColor = vec4(max(color, prev * uPersist), 1.0);
}`;

/** Downsample by 4 (box filter through bilinear taps). */
export const DOWNSAMPLE = COMMON + `
uniform sampler2D uTex;
uniform vec2 uSrcSize;
out vec4 outColor;
void main() {
  vec2 p = gl_FragCoord.xy * 4.0;
  vec3 acc = vec3(0.0);
  for (int y = -1; y <= 1; y += 2)
    for (int x = -1; x <= 1; x += 2)
      acc += texture(uTex, (p + vec2(x, y)) / uSrcSize).rgb;
  outColor = vec4(acc * 0.25, 1.0);
}`;

/** Separable gaussian blur. */
export const BLUR = COMMON + `
uniform sampler2D uTex;
uniform vec2 uDir;            // texel step
uniform float uSigma;
out vec4 outColor;
void main() {
  vec2 size = vec2(textureSize(uTex, 0));
  vec2 p = gl_FragCoord.xy / size;
  int r = int(ceil(uSigma * 3.0));
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  for (int i = -r; i <= r; i++) {
    float w = exp(-0.5 * float(i * i) / (uSigma * uSigma));
    acc += w * texture(uTex, p + uDir * float(i) / size).rgb;
    wsum += w;
  }
  outColor = vec4(acc / wsum, 1.0);
}`;

/** Pass 5 — combine picture, bloom and glass reflection; soft clip; sRGB gamma. */
export const FINAL = COMMON + `
uniform sampler2D uDisp, uBloom, uHalo;
uniform vec2 uOut;
uniform float uBloomAmt, uHaloAmt;
out vec4 outColor;
vec3 softClip(vec3 c) {
  return mix(c, 0.8 + 0.2 * (1.0 - exp(-(c - 0.8) / 0.2)), step(0.8, c));
}
void main() {
  vec2 uv = gl_FragCoord.xy / uOut;
  vec3 c = texelFetch(uDisp, ivec2(gl_FragCoord.xy), 0).rgb;
  c += uBloomAmt * texture(uBloom, uv).rgb;
  c += uHaloAmt * texture(uHalo, uv).rgb;
  outColor = vec4(pow(softClip(max(c, 0.0)), vec3(1.0 / 2.2)), 1.0);
}`;
