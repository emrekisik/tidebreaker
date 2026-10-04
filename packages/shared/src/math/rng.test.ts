import { describe, expect, it } from 'vitest';
import { Mulberry32 } from './rng.ts';

describe('Mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const a = new Mulberry32(12345);
    const b = new Mulberry32(12345);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('matches known reference values (guards against accidental changes)', () => {
    const r = new Mulberry32(1);
    expect([r.next(), r.next(), r.next()]).toEqual([
      0.6270739405881613, 0.002735721180215478, 0.5274470399599522,
    ]);
  });

  it('stays within [0, 1)', () => {
    const r = new Mulberry32(99);
    for (let i = 0; i < 10000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
