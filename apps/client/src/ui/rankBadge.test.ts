import { RANKS } from '@tidebreaker/shared';
import { describe, expect, it } from 'vitest';
import { rankSvg } from './rankBadge.ts';

describe('rank insignia', () => {
  it('draws a different, well-formed picture for every rank', () => {
    const seen = new Set<string>();
    for (let r = 0; r < RANKS.count; r++) {
      const svg = rankSvg(r);
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg.endsWith('</svg>')).toBe(true);
      expect(svg).not.toContain('NaN');
      seen.add(svg);
    }
    expect(seen.size).toBe(RANKS.count);
  });

  it('puts one more star on each gold rank, and the top rank looks different', () => {
    const stars = (r: number): number => {
      let n = 0;
      for (const m of rankSvg(r).matchAll(/<polygon points="([^"]*)" fill="url\(#m\)"/g)) if (m[1]!.split(' ').length === 10) n++;
      return n;
    };
    expect(stars(13)).toBe(stars(12) + 1);
    expect(stars(15)).toBe(stars(12) + 3);
    // The top rank is a design of its own: five stars, a laurel wreath and a ruby.
    expect(stars(RANKS.count - 1)).toBe(5);
    expect(rankSvg(RANKS.count - 1)).toContain('url(#ruby)');
    expect(rankSvg(15)).not.toContain('url(#ruby)');
  });

  it('keeps ranks that are out of range inside the ladder', () => {
    expect(rankSvg(-3)).toBe(rankSvg(0));
    expect(rankSvg(99)).toBe(rankSvg(RANKS.count - 1));
  });
});
