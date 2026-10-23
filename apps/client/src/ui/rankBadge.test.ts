import { RANKS } from '@tidebreaker/shared';
import { describe, expect, it } from 'vitest';
import en from '../i18n/en.json';
import tr from '../i18n/tr.json';
import { rankIconUrl } from './rankBadge.ts';

describe('rank insignia', () => {
  it('has its own picture for every rank', () => {
    const urls = new Set<string>();
    for (let r = 0; r < RANKS.count; r++) {
      const url = rankIconUrl(r);
      expect(url).toMatch(new RegExp(`ranks/${r}\\.png$`));
      urls.add(url);
    }
    expect(urls.size).toBe(RANKS.count);
  });

  it('keeps ranks that are out of range inside the ladder', () => {
    expect(rankIconUrl(-3)).toBe(rankIconUrl(0));
    expect(rankIconUrl(99)).toBe(rankIconUrl(RANKS.count - 1));
  });

  it('has a name for every rank, in every language, and none for ranks that do not exist', () => {
    for (const lang of [en, tr] as Record<string, string>[]) {
      const names = new Set<string>();
      for (let r = 0; r < RANKS.count; r++) {
        const name = lang[`rank.name.${r}`];
        expect(name, `rank.name.${r}`).toBeTruthy();
        names.add(name!);
      }
      expect(names.size).toBe(RANKS.count);
      expect(lang[`rank.name.${RANKS.count}`]).toBeUndefined();
    }
  });
});
