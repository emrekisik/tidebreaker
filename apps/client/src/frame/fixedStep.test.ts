import { describe, expect, it } from 'vitest';
import { FixedStep } from './fixedStep.ts';

describe('FixedStep', () => {
  it('runs one step per full step of elapsed time and keeps the remainder as alpha', () => {
    const f = new FixedStep(50);
    expect(f.advance(16)).toBe(0);
    expect(f.alpha).toBeCloseTo(0.32);
    expect(f.advance(16)).toBe(0);
    expect(f.advance(20)).toBe(1); // 52 ms elapsed
    expect(f.alpha).toBeCloseTo(0.04);
  });

  it('runs several steps after a slow frame', () => {
    const f = new FixedStep(50);
    expect(f.advance(120)).toBe(2);
  });

  it('drops the backlog after a long stall instead of catching up', () => {
    const f = new FixedStep(50, 3);
    expect(f.advance(5000)).toBe(3);
    expect(f.alpha).toBe(0);
    expect(f.advance(10)).toBe(0);
  });

  it('ignores negative frame times', () => {
    const f = new FixedStep(50);
    expect(f.advance(-100)).toBe(0);
    expect(f.alpha).toBe(0);
  });
});
