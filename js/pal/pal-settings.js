import { S } from '../state.js';

// ══════════════════════════════════════════════════════════════
//  PAL video chain emulation: parameter schema, presets, persistence
// ══════════════════════════════════════════════════════════════

export const PAL_GROUPS = [
  { id: 'signal', label: 'Signal (VIC-II output)' },
  { id: 'pal',    label: 'PAL decoder' },
  { id: 'noise',  label: 'Interference' },
  { id: 'tube',   label: 'Picture tube' },
];

/**
 * Every adjustable parameter. `type` defaults to a range slider.
 * Times and offsets in "px" are C64 hires pixels (dots of the 7.88 MHz pixel clock).
 */
export const PAL_PARAMS = [
  { group: 'signal', key: 'connection', label: 'Connection', type: 'select', options: [
    ['rgb', 'RGB (clean)'], ['svideo', 'Luma/Chroma (S-Video)'], ['composite', 'Composite'], ['rf', 'RF (antenna)'],
  ], title: 'How the picture reaches the screen. Composite and RF mix luma and chroma into one signal (cross-colour, dot patterns).' },
  { group: 'signal', key: 'lumaRise', label: 'Luma rise time', min: 0, max: 8, step: 0.1, unit: 'px', title: 'Time of a dark-to-bright transition (10–90 %)' },
  { group: 'signal', key: 'lumaFall', label: 'Luma fall time', min: 0, max: 8, step: 0.1, unit: 'px', title: 'Time of a bright-to-dark transition (10–90 %)' },
  { group: 'signal', key: 'chromaDelay', label: 'Chroma offset', min: -4, max: 4, step: 0.1, unit: 'px', title: 'Timing offset of the colour signal against the brightness signal' },
  { group: 'signal', key: 'lumaBandwidth', label: 'Luma bandwidth', min: 1, max: 6, step: 0.1, unit: 'MHz', title: 'Sharpness of the brightness signal' },
  { group: 'signal', key: 'chromaBandwidth', label: 'Chroma bandwidth', min: 0.3, max: 2.5, step: 0.05, unit: 'MHz', title: 'Sharpness of the colour signal' },

  { group: 'pal', key: 'delayLine', label: 'Delay line', type: 'checkbox', title: 'PAL delay line: averages the colour of two neighbouring lines (PAL blending). Off shows Hanover bars on phase errors.' },
  { group: 'pal', key: 'oddPhase', label: 'Odd line phase', min: -45, max: 45, step: 0.5, unit: '°', title: 'Colour phase error of the VIC-II on odd lines' },
  { group: 'pal', key: 'oddSaturation', label: 'Odd line saturation', min: 0, max: 50, step: 1, unit: '%', title: 'Colour amplitude loss on odd lines' },
  { group: 'pal', key: 'saturation', label: 'Saturation', min: 0, max: 200, step: 1, unit: '%' },

  { group: 'noise', key: 'glitchPhi0', label: 'Glitch PHI0', min: 0, max: 100, step: 0.5, unit: '%', title: 'Crosstalk of the system clock into the video signal' },
  { group: 'noise', key: 'glitchAec', label: 'Glitch AEC', min: 0, max: 100, step: 0.5, unit: '%', title: 'Crosstalk of the bus enable signal (pauses on bad lines)' },
  { group: 'noise', key: 'glitchBa', label: 'Glitch BA', min: 0, max: 100, step: 0.5, unit: '%', title: 'Bus available signal: level shift on bad lines (every 8th line)' },
  { group: 'noise', key: 'glitchRas', label: 'Glitch RAS', min: 0, max: 100, step: 0.5, unit: '%', title: 'Crosstalk of the DRAM row strobe' },
  { group: 'noise', key: 'glitchCas', label: 'Glitch CAS', min: 0, max: 100, step: 0.5, unit: '%', title: 'Crosstalk of the DRAM column strobe' },
  { group: 'noise', key: 'noiseY', label: 'Noise Y', min: 0, max: 100, step: 0.5, unit: '%' },
  { group: 'noise', key: 'noiseUV', label: 'Noise UV', min: 0, max: 100, step: 0.5, unit: '%' },
  { group: 'noise', key: 'lineJitter', label: 'Random line offset', min: 0, max: 2, step: 0.05, unit: 'px', title: 'Horizontal sync jitter per line' },
  { group: 'noise', key: 'interference', label: 'RF interference', min: 0, max: 100, step: 0.5, unit: '%', title: 'Moving diagonal beat pattern' },
  { group: 'noise', key: 'ghost', label: 'Ghosting', min: 0, max: 100, step: 0.5, unit: '%', title: 'Delayed reflection of the signal (multipath reception)' },
  { group: 'noise', key: 'humBar', label: 'Hum bar', min: 0, max: 100, step: 0.5, unit: '%', title: 'Slowly rolling brightness band from mains hum' },

  { group: 'tube', key: 'scanlines', label: 'Scan lines', type: 'checkbox' },
  { group: 'tube', key: 'doubleScan', label: 'Double scan', type: 'checkbox', title: 'Two beam lines per picture line' },
  { group: 'tube', key: 'scanlineShade', label: 'Scan line shade', min: 0, max: 100, step: 1, unit: '%' },
  { group: 'tube', key: 'maskType', label: 'Mask type', type: 'select', options: [
    ['none', 'None'], ['aperture', 'Aperture grille'], ['slot', 'Slot mask'], ['shadow', 'Shadow mask'],
  ] },
  { group: 'tube', key: 'maskLevel', label: 'Mask level', min: 0, max: 100, step: 1, unit: '%' },
  { group: 'tube', key: 'maskPitch', label: 'Mask pitch', min: 2, max: 9, step: 0.5, unit: 'px', title: 'Width of one RGB phosphor triad in screen pixels' },
  { group: 'tube', key: 'brightness', label: 'Luminance gain', min: 50, max: 250, step: 1, unit: '%' },
  { group: 'tube', key: 'backlight', label: 'Backlight', min: 0, max: 20, step: 0.1, unit: '%', title: 'Glow of the unlit screen' },
  { group: 'tube', key: 'vignette', label: 'Edge falloff', min: 0, max: 100, step: 1, unit: '%', title: 'Light loss towards the screen edges' },
  { group: 'tube', key: 'bloom', label: 'Bloom', min: 0, max: 100, step: 1, unit: '%' },
  { group: 'tube', key: 'halation', label: 'Glass reflection', min: 0, max: 100, step: 1, unit: '%', title: 'Wide glow of bright areas scattered in the tube glass' },
  { group: 'tube', key: 'persistence', label: 'Persistence', min: 0, max: 90, step: 1, unit: '%', title: 'Phosphor afterglow (visible with animation and interlace flicker)' },
  { group: 'tube', key: 'curvature', label: 'Radial distortion', min: 0, max: 100, step: 1, unit: '%' },
];

const CLEAN = {
  connection: 'rgb', lumaRise: 0, lumaFall: 0, chromaDelay: 0, lumaBandwidth: 6, chromaBandwidth: 2.5,
  delayLine: true, oddPhase: 0, oddSaturation: 0, saturation: 100,
  glitchPhi0: 0, glitchAec: 0, glitchBa: 0, glitchRas: 0, glitchCas: 0,
  noiseY: 0, noiseUV: 0, lineJitter: 0, interference: 0, ghost: 0, humBar: 0,
  scanlines: true, doubleScan: false, scanlineShade: 45, maskType: 'none', maskLevel: 0, maskPitch: 3,
  brightness: 110, backlight: 0, vignette: 10, bloom: 10, halation: 0, persistence: 0, curvature: 0,
};

export const PAL_PRESETS = [
  { id: 'monitor', label: 'Monitor (Luma/Chroma)', values: {
    ...CLEAN, connection: 'svideo', lumaRise: 2.2, lumaFall: 1.0, chromaDelay: 0.5, lumaBandwidth: 5, chromaBandwidth: 1.3,
    oddPhase: 8, oddSaturation: 10,
    glitchPhi0: 12.5, glitchAec: 12.5, glitchBa: 12.5, glitchRas: 12.5, glitchCas: 12.5, noiseY: 1, noiseUV: 1,
    scanlineShade: 60, maskType: 'aperture', maskLevel: 35, brightness: 125, backlight: 1.5, vignette: 30,
    bloom: 25, halation: 12, curvature: 12,
  } },
  { id: 'composite', label: 'Composite monitor', values: {
    ...CLEAN, connection: 'composite', lumaRise: 2.6, lumaFall: 1.2, chromaDelay: 0.8, lumaBandwidth: 4, chromaBandwidth: 1.1,
    oddPhase: 10, oddSaturation: 12,
    glitchPhi0: 18, glitchAec: 18, glitchBa: 18, glitchRas: 18, glitchCas: 18, noiseY: 3, noiseUV: 3,
    scanlineShade: 55, maskType: 'slot', maskLevel: 40, brightness: 130, backlight: 2, vignette: 35,
    bloom: 30, halation: 15, persistence: 10, curvature: 18,
  } },
  { id: 'rf', label: 'TV via RF', values: {
    ...CLEAN, connection: 'rf', lumaRise: 3.2, lumaFall: 1.6, chromaDelay: 1.2, lumaBandwidth: 3, chromaBandwidth: 0.9,
    oddPhase: 12, oddSaturation: 15,
    glitchPhi0: 25, glitchAec: 25, glitchBa: 25, glitchRas: 25, glitchCas: 25, noiseY: 12, noiseUV: 10, lineJitter: 0.25,
    interference: 12, ghost: 10, humBar: 8,
    scanlineShade: 50, maskType: 'shadow', maskLevel: 35, brightness: 135, backlight: 3, vignette: 45,
    bloom: 35, halation: 20, persistence: 15, curvature: 28,
  } },
  { id: 'clean', label: 'Clean RGB', values: { ...CLEAN } },
];

export const PAL_DEFAULT_PRESET = 'monitor';
const STORAGE_KEY = 'pf.palSettings';

const presetById = id => PAL_PRESETS.find(p => p.id === id);

/** Load the stored settings (or the default preset) into S.palSettings / S.palPreset / S.palAnimate. */
export function loadPalSettings() {
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { /* storage unavailable */ }
  const base = presetById(PAL_DEFAULT_PRESET).values;
  S.palSettings = { ...base, ...(stored?.values || {}) };
  S.palPreset = stored?.preset && (stored.preset === 'custom' || presetById(stored.preset)) ? stored.preset : PAL_DEFAULT_PRESET;
  S.palAnimate = stored?.animate ?? true;
}

export function savePalSettings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ preset: S.palPreset, animate: S.palAnimate, values: S.palSettings }));
  } catch { /* storage unavailable */ }
}

export function applyPalPreset(id) {
  const preset = presetById(id);
  if (!preset) return;
  S.palSettings = { ...preset.values };
  S.palPreset = id;
  savePalSettings();
}

export function setPalParam(key, value) {
  S.palSettings[key] = value;
  S.palPreset = 'custom';
  savePalSettings();
}
