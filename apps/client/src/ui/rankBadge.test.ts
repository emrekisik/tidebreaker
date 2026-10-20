import { RANKS } from '@tidebreaker/shared';
import { describe, expect, it } from 'vitest';
import { rankSvg } from './rankBadge.ts';

const count = (svg: string, cls: string): number => svg.split(`class="${cls}"`).length - 1;

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

  it('counts the symbols like the DarkOrbit ranks: 1-3 narrow and 1-5 wide chevrons, four gold shields, stars on bronze', () => {
    for (let r = 0; r < 3; r++) expect(count(rankSvg(r), 'ch')).toBe(r + 1);
    for (let r = 3; r < 8; r++) expect(count(rankSvg(r), 'ch')).toBe(r - 2);
    expect(count(rankSvg(9), 'band')).toBe(1);
    expect(count(rankSvg(10), 'col')).toBe(3);
    expect(count(rankSvg(11), 'tri')).toBe(1);
    for (let r = 12; r < 15; r++) expect(count(rankSvg(r), 'st')).toBe(r - 11);
    expect(count(rankSvg(15), 'st')).toBe(1);
  });

  it('gives the top rank a design of its own', () => {
    const top = rankSvg(RANKS.count - 1);
    expect(top).toContain('class="laurel"');
    expect(rankSvg(15)).not.toContain('class="laurel"');
  });

  it('keeps ranks that are out of range inside the ladder', () => {
    expect(rankSvg(-3)).toBe(rankSvg(0));
    expect(rankSvg(99)).toBe(rankSvg(RANKS.count - 1));
  });
});
