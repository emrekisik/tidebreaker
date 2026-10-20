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

  it('counts the symbols: 1-8 chevrons, then 1-4 bars, then 1-4 stars', () => {
    for (let r = 0; r < 8; r++) expect(count(rankSvg(r), 'ch')).toBe(r + 1);
    for (let r = 8; r < 12; r++) expect(count(rankSvg(r), 'bar')).toBe(r - 7);
    for (let r = 12; r < 16; r++) expect(count(rankSvg(r), 'st')).toBe(r - 11);
  });

  it('gives the top rank a design of its own', () => {
    const top = rankSvg(RANKS.count - 1);
    expect(top).toContain('class="laurel"');
    expect(top).toContain('url(#ruby)');
    expect(rankSvg(15)).not.toContain('class="laurel"');
  });

  it('keeps ranks that are out of range inside the ladder', () => {
    expect(rankSvg(-3)).toBe(rankSvg(0));
    expect(rankSvg(99)).toBe(rankSvg(RANKS.count - 1));
  });
});
