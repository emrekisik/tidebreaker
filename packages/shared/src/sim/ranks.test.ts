import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { RANKS } from '../config/ranks.ts';
import { rankAt, rankSeats, rankTable } from './ranks.ts';
import type { RankInput } from './ranks.ts';

const TOP = RANKS.count - 1;

function player(id: number, team: number, score: number, kills = 0, deaths = 0): RankInput {
  return { id, team, score, kills, deaths };
}

describe('ranks', () => {
  it('has a minimum score and a share for every rank, in order', () => {
    expect(RANKS.minScore).toHaveLength(RANKS.count);
    expect(RANKS.quota).toHaveLength(RANKS.count);
    for (let k = 1; k < RANKS.count; k++) expect(RANKS.minScore[k]!).toBeGreaterThan(RANKS.minScore[k - 1]!);
    for (let k = 1; k < RANKS.count - 1; k++) expect(RANKS.quota[k]!).toBeLessThanOrEqual(RANKS.quota[k - 1]!);
  });

  it('everyone starts at the lowest rank, whatever the team looks like', () => {
    const rows = Array.from({ length: 12 }, (_, i) => player(i + 1, 0, 0));
    for (const rank of rankTable(rows).values()) expect(rank).toBe(0);
  });

  it('only one player of a team can hold the top rank, even when scores tie', () => {
    const rows = Array.from({ length: 10 }, (_, i) => player(i + 1, 0, 99999));
    const ranks = [...rankTable(rows).values()];
    expect(ranks.filter((r) => r === TOP)).toHaveLength(1);
  });

  it('the top rank also needs its score', () => {
    const rows = [player(1, 0, RANKS.minScore[TOP]! - 1), player(2, 0, 5)];
    expect(rankTable(rows).get(1)).toBeLessThan(TOP);
  });

  it('is relative: the same score ranks lower in a team of stronger players', () => {
    const alone = rankTable([player(1, 0, 340)]).get(1)!;
    const strong = Array.from({ length: 11 }, (_, i) => player(i + 2, 0, 1500 + i));
    const crowded = rankTable([player(1, 0, 340), ...strong]).get(1)!;
    expect(crowded).toBeLessThan(alone);
  });

  it('ranks the teams separately', () => {
    const rows = [player(1, 0, 1200), player(2, 1, 1200)];
    const ranks = rankTable(rows);
    expect(ranks.get(1)).toBe(TOP);
    expect(ranks.get(2)).toBe(TOP);
  });

  it('a player rises when they pass another one', () => {
    const before = rankTable([player(1, 0, 900), player(2, 0, 880)]);
    const after = rankTable([player(1, 0, 900), player(2, 0, 950)]);
    expect(after.get(2)!).toBeGreaterThanOrEqual(before.get(2)!);
    expect(after.get(1)!).toBeLessThanOrEqual(before.get(1)!);
  });

  it('seats: everybody for rank 0, one for the top, a share (rounded up) in between', () => {
    expect(rankSeats(0, 12)).toBe(12);
    expect(rankSeats(TOP, 12)).toBe(RANKS.topSeats);
    expect(rankSeats(TOP, 1)).toBe(1);
    expect(rankSeats(8, 12)).toBe(Math.ceil(RANKS.quota[8]! * 12));
    expect(rankSeats(5, 1)).toBe(1);
  });

  it('property: ranks never rise as the position gets worse, and ranks are in range', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 3000 }), { minLength: 1, maxLength: 24 }), (scores) => {
        const sorted = [...scores].sort((a, b) => b - a);
        const ranks = sorted.map((s, p) => rankAt(p, sorted.length, s));
        for (let i = 0; i < ranks.length; i++) {
          expect(ranks[i]!).toBeGreaterThanOrEqual(0);
          expect(ranks[i]!).toBeLessThanOrEqual(TOP);
          if (i > 0) expect(ranks[i]!).toBeLessThanOrEqual(ranks[i - 1]!);
        }
        expect(ranks.filter((r) => r === TOP).length).toBeLessThanOrEqual(RANKS.topSeats);
      }),
    );
  });
});
