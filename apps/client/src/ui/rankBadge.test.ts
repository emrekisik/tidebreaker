import { RANKS } from '@tidebreaker/shared';
import { describe, expect, it } from 'vitest';
import { RANK_PALETTE, RANK_PIXELS, rankPixels } from './rankBadge.ts';

describe('rank insignia (pixel art)', () => {
  it('draws a different, well-formed picture for every rank', () => {
    const seen = new Set<string>();
    for (let r = 0; r < RANKS.count; r++) {
      const rows = rankPixels(r);
      expect(rows).toHaveLength(RANK_PIXELS);
      for (const row of rows) {
        expect(row).toHaveLength(RANK_PIXELS);
        for (const c of row) expect(c === '.' || RANK_PALETTE[c] !== undefined).toBe(true);
      }
      seen.add(rows.join('/'));
    }
    expect(seen.size).toBe(RANKS.count);
  });

  it('keeps the chevrons mirror-symmetrical and gives every picture an outline', () => {
    for (let r = 0; r < 8; r++) {
      for (const row of rankPixels(r)) expect([...row].reverse().join('')).toBe(row);
    }
    for (let r = 0; r < RANKS.count; r++) expect(rankPixels(r).join('')).toContain('k');
  });

  it('draws more chevrons as the rank rises (more lit pixels)', () => {
    const lit = (r: number): number => rankPixels(r).join('').replace(/[^wlmd]/g, '').length;
    for (const r of [1, 2, 4, 5, 6, 7]) expect(lit(r)).toBeGreaterThan(lit(r - 1));
  });

  it('keeps ranks that are out of range inside the ladder', () => {
    expect(rankPixels(-3)).toEqual(rankPixels(0));
    expect(rankPixels(99)).toEqual(rankPixels(RANKS.count - 1));
  });
});
