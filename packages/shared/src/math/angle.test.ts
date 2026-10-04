import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { TAU, angleDiff, lerpAngle, normalizeAngle } from './angle.ts';

const finiteAngle = fc.double({ min: -1000, max: 1000, noNaN: true });

describe('normalizeAngle', () => {
  it('always lands in [-PI, PI]', () => {
    fc.assert(
      fc.property(finiteAngle, (a) => {
        const n = normalizeAngle(a);
        return n >= -Math.PI && n <= Math.PI;
      }),
    );
  });

  it('keeps the same direction (sin/cos preserved)', () => {
    fc.assert(
      fc.property(finiteAngle, (a) => {
        const n = normalizeAngle(a);
        return (
          Math.abs(Math.sin(n) - Math.sin(a)) < 1e-9 && Math.abs(Math.cos(n) - Math.cos(a)) < 1e-9
        );
      }),
    );
  });
});

describe('angleDiff', () => {
  it('takes the short way around', () => {
    expect(angleDiff(-3, 3)).toBeCloseTo(TAU - 6);
    expect(angleDiff(3, -3)).toBeCloseTo(6 - TAU);
    expect(angleDiff(1, 0.5)).toBeCloseTo(0.5);
  });

  it('is always within a half turn', () => {
    fc.assert(
      fc.property(finiteAngle, finiteAngle, (a, b) => Math.abs(angleDiff(a, b)) <= Math.PI),
    );
  });
});

describe('lerpAngle', () => {
  it('interpolates across the wrap point', () => {
    const r = lerpAngle(3, -3, 0.5);
    expect(Math.abs(normalizeAngle(r - Math.PI))).toBeLessThan(0.2);
  });
});
