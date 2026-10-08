import { describe, expect, it } from 'vitest';
import { WAVE_MAX, glslWaveFunction, glslWaveSlope, waveHeight, waveSlope } from './waves.ts';

describe('waves', () => {
  it('averages to zero height and stays below WAVE_MAX', () => {
    let sum = 0;
    let max = -Infinity;
    const n = 4000;
    for (let i = 0; i < n; i++) {
      const h = waveHeight((i * 7.31) % 400, (i * 3.17) % 400, i * 0.013);
      sum += h;
      max = Math.max(max, h);
    }
    expect(Math.abs(sum / n)).toBeLessThan(0.02);
    expect(max).toBeLessThanOrEqual(WAVE_MAX + 1e-6);
  });

  it('has sharper crests than troughs (peaky, like real waves)', () => {
    let hi = 0;
    let lo = 0;
    for (let i = 0; i < 4000; i++) {
      const h = waveHeight((i * 5.7) % 300, (i * 2.3) % 300, 0);
      hi = Math.max(hi, h);
      lo = Math.min(lo, h);
    }
    expect(hi).toBeGreaterThan(-lo);
  });

  it('reports a slope that matches the height differences', () => {
    const out = new Float32Array(2);
    waveSlope(10, 20, 1.5, out);
    const e = 0.01;
    const dx = (waveHeight(10 + e, 20, 1.5) - waveHeight(10 - e, 20, 1.5)) / (2 * e);
    expect(out[0]).toBeCloseTo(dx, 1);
  });

  it('generates GLSL for the same number of components', () => {
    const count = (s: string): number => (s.match(/pow\(/g) ?? []).length;
    expect(count(glslWaveSlope())).toBe(count(glslWaveFunction()));
  });
});
