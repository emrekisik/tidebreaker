/**
 * Ocean wave function. The same constants feed the water shader (via `glslWaveFunction`) and the
 * JS side (`waveHeight`), so ships can bob on exactly the waves that are drawn.
 *
 * Each component is a "sharpened" sine: h = 2a * (s^p - mean), s = (1 + sin(phase)) / 2. For p > 1
 * the crests get narrow and peaky and the troughs wide and flat, like real wind waves, while the
 * height stays a pure function of (x, z, t) so ships and decals can look it up.
 */
interface Wave {
  /** Unit direction of travel in the xz plane. */
  dx: number;
  dz: number;
  wavelength: number;
  amplitude: number;
  /** Phase speed in world units per second. */
  speed: number;
  /** Sharpness exponent p (1 = plain sine shape). */
  sharp: number;
  /** Mean of s^p over a period, so the wave averages to zero height. */
  mean: number;
}

function meanOfPower(p: number): number {
  const n = 2048;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.pow(0.5 + 0.5 * Math.sin((i / n) * Math.PI * 2), p);
  return sum / n;
}

/** Deep-water style dispersion: longer waves travel faster (scaled to game units). */
function wave(angleDeg: number, wavelength: number, amplitude: number, sharp: number): Wave {
  const a = (angleDeg * Math.PI) / 180;
  return {
    dx: Math.cos(a),
    dz: Math.sin(a),
    wavelength,
    amplitude,
    speed: 0.45 * Math.sqrt(wavelength),
    sharp,
    mean: meanOfPower(sharp),
  };
}

const WAVES: readonly Wave[] = [
  wave(20, 46, 0.24, 1.7),
  wave(100, 27, 0.14, 2),
  wave(-55, 16, 0.077, 2.2),
  wave(160, 10.5, 0.042, 2.4),
];

/** Highest possible crest; foam and shadows are placed relative to this. */
export const WAVE_MAX = WAVES.reduce((sum, w) => sum + 2 * w.amplitude * (1 - w.mean), 0);

export function waveHeight(x: number, z: number, t: number): number {
  let h = 0;
  for (let i = 0; i < WAVES.length; i++) {
    const w = WAVES[i]!;
    const k = (Math.PI * 2) / w.wavelength;
    const s = 0.5 + 0.5 * Math.sin(k * (x * w.dx + z * w.dz) + k * w.speed * t);
    h += 2 * w.amplitude * (Math.pow(s, w.sharp) - w.mean);
  }
  return h;
}

/** Writes the surface slope (dh/dx, dh/dz) into `out[0..1]`. */
export function waveSlope(x: number, z: number, t: number, out: Float32Array): void {
  const e = 0.6;
  out[0] = (waveHeight(x + e, z, t) - waveHeight(x - e, z, t)) / (2 * e);
  out[1] = (waveHeight(x, z + e, t) - waveHeight(x, z - e, t)) / (2 * e);
}

/** GLSL source of `float waveHeight(vec2 p, float t)` generated from the same constants. */
export function glslWaveFunction(): string {
  const lines = WAVES.map((w) => {
    const k = (Math.PI * 2) / w.wavelength;
    return `  h += ${(2 * w.amplitude).toFixed(5)} * (pow(0.5 + 0.5 * sin(${k.toFixed(6)} * dot(p, vec2(${w.dx.toFixed(6)}, ${w.dz.toFixed(6)})) + ${(k * w.speed).toFixed(6)} * t), ${w.sharp.toFixed(3)}) - ${w.mean.toFixed(6)});`;
  });
  return `float waveHeight(vec2 p, float t) {\n  float h = 0.0;\n${lines.join('\n')}\n  return h;\n}`;
}

/** GLSL source of `vec2 waveSlope(vec2 p, float t)`: the exact (dh/dx, dh/dz) of the waves. */
export function glslWaveSlope(): string {
  const lines = WAVES.map((w) => {
    const k = (Math.PI * 2) / w.wavelength;
    const phase = `${k.toFixed(6)} * dot(p, vec2(${w.dx.toFixed(6)}, ${w.dz.toFixed(6)})) + ${(k * w.speed).toFixed(6)} * t`;
    // d/dp of 2a * s^p, with s = 0.5 + 0.5 sin(phase): 2a * p * s^(p-1) * 0.5 * cos(phase) * k * dir
    return `  { float ph = ${phase}; s += ${(w.amplitude * w.sharp * k).toFixed(6)} * pow(max(0.5 + 0.5 * sin(ph), 0.0001), ${(w.sharp - 1).toFixed(3)}) * cos(ph) * vec2(${w.dx.toFixed(6)}, ${w.dz.toFixed(6)}); }`;
  });
  return `vec2 waveSlope(vec2 p, float t) {\n  vec2 s = vec2(0.0);\n${lines.join('\n')}\n  return s;\n}`;
}
