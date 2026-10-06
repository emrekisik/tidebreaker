/**
 * Ocean wave function. The same constants feed the water shader (via `glslWaveFunction`) and the
 * JS side (`waveHeight`), so ships can bob on exactly the waves that are drawn.
 */
interface Wave {
  /** Unit direction of travel in the xz plane. */
  dx: number;
  dz: number;
  wavelength: number;
  amplitude: number;
  /** Phase speed in world units per second. */
  speed: number;
}

function wave(angleDeg: number, wavelength: number, amplitude: number, speed: number): Wave {
  const a = (angleDeg * Math.PI) / 180;
  return { dx: Math.cos(a), dz: Math.sin(a), wavelength, amplitude, speed };
}

const WAVES: readonly Wave[] = [
  wave(25, 30, 0.17, 2.3),
  wave(112, 17, 0.1, 2.7),
  wave(-80, 9.5, 0.06, 3.1),
];

/** Highest possible crest; foam and shadows are placed relative to this. */
export const WAVE_MAX = WAVES.reduce((sum, w) => sum + w.amplitude, 0);

export function waveHeight(x: number, z: number, t: number): number {
  let h = 0;
  for (let i = 0; i < WAVES.length; i++) {
    const w = WAVES[i]!;
    const k = (Math.PI * 2) / w.wavelength;
    h += w.amplitude * Math.sin(k * (x * w.dx + z * w.dz) + k * w.speed * t);
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
    return `  h += ${w.amplitude.toFixed(5)} * sin(${k.toFixed(6)} * dot(p, vec2(${w.dx.toFixed(6)}, ${w.dz.toFixed(6)})) + ${(k * w.speed).toFixed(6)} * t);`;
  });
  return `float waveHeight(vec2 p, float t) {\n  float h = 0.0;\n${lines.join('\n')}\n  return h;\n}`;
}

/** GLSL source of `vec2 waveSlope(vec2 p, float t)`: the exact (dh/dx, dh/dz) of the waves. */
export function glslWaveSlope(): string {
  const lines = WAVES.map((w) => {
    const k = (Math.PI * 2) / w.wavelength;
    return `  s += ${(w.amplitude * k).toFixed(6)} * vec2(${w.dx.toFixed(6)}, ${w.dz.toFixed(6)}) * cos(${k.toFixed(6)} * dot(p, vec2(${w.dx.toFixed(6)}, ${w.dz.toFixed(6)})) + ${(k * w.speed).toFixed(6)} * t);`;
  });
  return `vec2 waveSlope(vec2 p, float t) {\n  vec2 s = vec2(0.0);\n${lines.join('\n')}\n  return s;\n}`;
}
