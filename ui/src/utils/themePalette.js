/**
 * Colour maths for customer themes.
 *
 * A customer theme names one or two brand colours; the UI needs a full
 * Tailwind-style 50…950 scale for each, because the components use `blue-*`,
 * `indigo-*` and `cyan-*` at every step (tints for backgrounds, 600 for
 * buttons, 700 for text). The scale is built in OKLCH so each step has the
 * same perceived lightness whatever the hue, which is what keeps a yellow
 * brand from producing unreadable white-on-yellow buttons.
 *
 * Output values are space-separated RGB triplets ("37 99 235"), the form
 * `rgb(var(--c-blue-600) / <alpha-value>)` in tailwind.config.js expects, so
 * opacity modifiers such as `bg-blue-600/10` keep working.
 */

export const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

/** Target OKLCH lightness per shade (close to Tailwind's own blue scale). */
const TARGET_L = {
  50: 0.97, 100: 0.932, 200: 0.882, 300: 0.809, 400: 0.707, 500: 0.623,
  600: 0.546, 700: 0.488, 800: 0.424, 900: 0.379, 950: 0.282,
};

/** Share of the brand chroma kept per shade: tints and deep shades are calmer. */
const CHROMA_SCALE = {
  50: 0.12, 100: 0.25, 200: 0.45, 300: 0.7, 400: 0.9, 500: 1,
  600: 1, 700: 0.95, 800: 0.85, 900: 0.75, 950: 0.6,
};

/** How much of the brand-lightness offset each shade follows (0 at the ends). */
const OFFSET_WEIGHT = {
  50: 0, 100: 0.15, 200: 0.35, 300: 0.6, 400: 0.85, 500: 1,
  600: 1, 700: 1, 800: 0.8, 900: 0.55, 950: 0.3,
};

/** WCAG AA for normal text. */
export const AA_TEXT = 4.5;

export function normalizeHex(input) {
  if (typeof input !== 'string') return null;
  let h = input.trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{3}$/.test(h)) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/.test(h)) return null;
  return `#${h}`;
}

export function hexToRgb(hex) {
  const h = normalizeHex(hex);
  if (!h) return null;
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

export function rgbToHex([r, g, b]) {
  const to = (v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

const toLinear = (c) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055) * 255;

/** Relative luminance (WCAG 2.x). */
export function luminance(rgb) {
  const [r, g, b] = rgb.map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a, b) {
  const la = luminance(Array.isArray(a) ? a : hexToRgb(a));
  const lb = luminance(Array.isArray(b) ? b : hexToRgb(b));
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export function rgbToOklch([r8, g8, b8]) {
  const r = toLinear(r8), g = toLinear(g8), b = toLinear(b8);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.sqrt(A * A + B * B);
  let H = (Math.atan2(B, A) * 180) / Math.PI;
  if (H < 0) H += 360;
  return [L, C, H];
}

/** OKLCH to *unclamped* sRGB 0-255 (may fall outside the gamut). */
function oklchToRgbRaw([L, C, H]) {
  const hr = (H * Math.PI) / 180;
  const A = C * Math.cos(hr), B = C * Math.sin(hr);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

const inGamut = (rgb) => rgb.every((v) => v >= -0.5 && v <= 255.5);

/** OKLCH to sRGB, reducing chroma until the colour fits the sRGB gamut. */
export function oklchToRgb([L, C, H]) {
  let raw = oklchToRgbRaw([L, C, H]);
  if (!inGamut(raw)) {
    let lo = 0, hi = C;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToRgbRaw([L, mid, H]))) lo = mid;
      else hi = mid;
    }
    raw = oklchToRgbRaw([L, lo, H]);
  }
  return raw.map((v) => Math.round(Math.min(255, Math.max(0, v))));
}

/**
 * Builds a 50…950 scale from one brand colour.
 *
 * When the brand colour itself is dark enough to carry white text (AA), the
 * lightness curve is shifted so shade 600 *is* the brand colour: primary
 * buttons and the active tab then match the customer's own brand exactly.
 * Otherwise (yellow, light green, pastel brands) the hue is kept and 600 is
 * darkened until white text on it passes AA.
 *
 * Returns `{ 50: [r,g,b], … }`, or null for an invalid colour.
 */
export function generateScale(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const [bL, bC, bH] = rgbToOklch(rgb);
  const white = [255, 255, 255];
  const anchor = contrastRatio(rgb, white) >= AA_TEXT && bL >= 0.38 && bL <= 0.66;
  const offset = anchor ? bL - TARGET_L[600] : 0;

  const scale = {};
  for (const shade of SHADES) {
    const L = Math.min(0.985, Math.max(0.2, TARGET_L[shade] + offset * OFFSET_WEIGHT[shade]));
    scale[shade] = oklchToRgb([L, bC * CHROMA_SCALE[shade], bH]);
  }
  if (anchor) scale[600] = rgb;

  // Buttons use bg-600/700 with white text and text-600/700 on white: both must pass AA.
  for (const shade of [600, 700]) {
    let L = rgbToOklch(scale[shade])[0];
    while (contrastRatio(scale[shade], white) < AA_TEXT && L > 0.2) {
      L -= 0.01;
      scale[shade] = oklchToRgb([L, bC * CHROMA_SCALE[shade], bH]);
    }
  }
  return scale;
}

/** `{ 50: [r,g,b] }` → `{ '--c-blue-50': 'r g b' }` for one Tailwind colour family. */
export function scaleToCssVars(family, scale) {
  const vars = {};
  if (!scale) return vars;
  for (const shade of SHADES) vars[`--c-${family}-${shade}`] = scale[shade].join(' ');
  return vars;
}

/**
 * Most characteristic colours in an image's RGBA pixel data (e.g. a logo read
 * back from a canvas). Near-white, near-black, grey and transparent pixels are
 * ignored, since they are background or outline rather than brand. Returns up
 * to `count` hex colours, most frequent first, each distinct in hue.
 */
export function dominantColors(rgba, count = 2) {
  const buckets = new Map();
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2], a = rgba[i + 3];
    if (a < 200) continue;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max < 30 || min > 235 || max - min < 28) continue;
    // 4-bit quantisation per channel: similar anti-aliased edge pixels share a bucket.
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bucket = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    bucket.n += 1; bucket.r += r; bucket.g += g; bucket.b += b;
    buckets.set(key, bucket);
  }
  const ranked = [...buckets.values()]
    .sort((x, y) => y.n - x.n)
    .map((bk) => [bk.r / bk.n, bk.g / bk.n, bk.b / bk.n]);
  const picked = [];
  for (const c of ranked) {
    const h = rgbToOklch(c)[2];
    const distinct = picked.every((p) => {
      const d = Math.abs(rgbToOklch(p)[2] - h);
      return Math.min(d, 360 - d) > 25;
    });
    if (distinct) picked.push(c);
    if (picked.length >= count) break;
  }
  return picked.map(rgbToHex);
}
