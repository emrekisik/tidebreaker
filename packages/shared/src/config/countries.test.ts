import { describe, expect, it } from 'vitest';
import { COUNTRIES, COUNTRY_COUNT, COUNTRY_MIN_DISTANCE, COUNTRY_PAIRS, countryOf, pickCountries } from './countries.ts';
import { Mulberry32 } from '../math/rng.ts';
import { colorDistance, worstColorDistance } from '../math/color.ts';

describe('colour distance', () => {
  it('is zero for the same colour and large for black and white', () => {
    expect(colorDistance(0x336699, 0x336699)).toBeCloseTo(0, 6);
    expect(colorDistance(0x000000, 0xffffff)).toBeGreaterThan(95);
  });

  it('shows that red and green are hard to tell apart for someone with deuteranopia', () => {
    const normal = colorDistance(0xff4a5c, 0x7be03a);
    const deutan = colorDistance(0xff4a5c, 0x7be03a, 'deuteranopia');
    expect(deutan).toBeLessThan(normal / 2);
  });
});

describe('countries', () => {
  it('has five countries with different names and ids', () => {
    expect(COUNTRY_COUNT).toBe(5);
    expect(new Set(COUNTRIES.map((c) => c.id)).size).toBe(5);
    expect(new Set(COUNTRIES.map((c) => c.name)).size).toBe(5);
  });

  it('allows only pairs whose colours stay plainly different for every kind of vision', () => {
    expect(COUNTRY_PAIRS.length).toBeGreaterThanOrEqual(4);
    for (const [a, b] of COUNTRY_PAIRS) {
      expect(worstColorDistance(COUNTRIES[a]!.ui, COUNTRIES[b]!.ui)).toBeGreaterThanOrEqual(COUNTRY_MIN_DISTANCE);
    }
  });

  it('lets every country play, against at least two others', () => {
    for (let c = 0; c < COUNTRY_COUNT; c++) {
      const opponents = COUNTRY_PAIRS.filter(([a, b]) => a === c || b === c).length;
      expect(opponents, COUNTRIES[c]!.name).toBeGreaterThanOrEqual(2);
    }
  });

  it('picks two different countries of an allowed pair, in either order, and every pair comes up', () => {
    const rng = new Mulberry32(7);
    const seen = new Set<string>();
    const first = new Set<number>();
    for (let i = 0; i < 400; i++) {
      const [a, b] = pickCountries(() => rng.next());
      expect(a).not.toBe(b);
      expect(COUNTRY_PAIRS.some(([x, y]) => (x === a && y === b) || (x === b && y === a))).toBe(true);
      seen.add([Math.min(a, b), Math.max(a, b)].join('-'));
      first.add(a);
    }
    expect(seen.size).toBe(COUNTRY_PAIRS.length);
    expect(first.size).toBe(COUNTRY_COUNT);
  });

  it('gives the first country for an index that does not exist', () => {
    expect(countryOf(-1)).toBe(COUNTRIES[0]);
    expect(countryOf(99)).toBe(COUNTRIES[0]);
  });
});
