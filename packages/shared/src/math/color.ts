/**
 * Colour distance as a person sees it, including people with the common kinds of colour blindness. Used to decide which
 * team colours may meet in one match (`COUNTRY_PAIRS`).
 */

export type Vision = 'normal' | 'protanopia' | 'deuteranopia';

/** How each kind of vision mixes linear RGB (Machado, Oliveira and Fernandes 2009, full severity). */
const MATRIX: Record<Vision, readonly number[]> = {
  normal: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  protanopia: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deuteranopia: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
};

export const VISIONS: readonly Vision[] = ['normal', 'protanopia', 'deuteranopia'];

const toLinear = (c: number): number => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

const labF = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);

/** CIE L*a*b* of an sRGB colour (0xRRGGBB) as seen with `vision`. */
export function lab(hex: number, vision: Vision = 'normal'): [number, number, number] {
  const r = toLinear((hex >> 16) & 255);
  const g = toLinear((hex >> 8) & 255);
  const b = toLinear(hex & 255);
  const m = MATRIX[vision];
  const r2 = clamp01(m[0]! * r + m[1]! * g + m[2]! * b);
  const g2 = clamp01(m[3]! * r + m[4]! * g + m[5]! * b);
  const b2 = clamp01(m[6]! * r + m[7]! * g + m[8]! * b);
  const x = 0.4124564 * r2 + 0.3575761 * g2 + 0.1804375 * b2;
  const y = 0.2126729 * r2 + 0.7151522 * g2 + 0.072175 * b2;
  const z = 0.0193339 * r2 + 0.119192 * g2 + 0.9503041 * b2;
  const fx = labF(x / 0.95047);
  const fy = labF(y);
  const fz = labF(z / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** How different two colours look (CIE76 delta E; about 2 is the least a person notices, 50 and more is plainly another colour). */
export function colorDistance(a: number, b: number, vision: Vision = 'normal'): number {
  const p = lab(a, vision);
  const q = lab(b, vision);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

/** The smallest distance of two colours over all the kinds of vision: the worst case for someone who has trouble with them. */
export function worstColorDistance(a: number, b: number): number {
  let worst = Infinity;
  for (const v of VISIONS) worst = Math.min(worst, colorDistance(a, b, v));
  return worst;
}
