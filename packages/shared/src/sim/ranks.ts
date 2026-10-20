import { RANKS } from '../config/ranks.ts';

/** What the rank of a player depends on (the scoreboard rows have all of it). */
export interface RankInput {
  id: number;
  team: number;
  score: number;
  kills: number;
  deaths: number;
}

/** Order of the players of a team: best first (score, then kills, then fewer deaths, then the lower id, so it never flickers). */
export function compareRankOrder(a: RankInput, b: RankInput): number {
  return b.score - a.score || b.kills - a.kills || a.deaths - b.deaths || a.id - b.id;
}

/** How many players of a team of `teamSize` may hold rank `k` or higher. */
export function rankSeats(k: number, teamSize: number): number {
  if (k <= 0) return teamSize;
  if (k >= RANKS.count - 1) return Math.min(RANKS.topSeats, teamSize);
  return Math.min(teamSize, Math.max(1, Math.ceil(RANKS.quota[k]! * teamSize - 1e-9)));
}

/** The rank of a player who stands at `position` (0 = best) in a team of `teamSize` and has `score` points. */
export function rankAt(position: number, teamSize: number, score: number): number {
  for (let k = RANKS.count - 1; k > 0; k--) {
    if (score >= RANKS.minScore[k]! && position < rankSeats(k, teamSize)) return k;
  }
  return 0;
}

/**
 * The rank of every player: within each team the players are put in score order and each gets the highest rank
 * whose minimum score they have reached and whose seats (a share of the team) still reach their position.
 * Returns player id -> rank.
 */
export function rankTable(rows: readonly RankInput[]): Map<number, number> {
  const out = new Map<number, number>();
  const byTeam = new Map<number, RankInput[]>();
  for (const r of rows) {
    const list = byTeam.get(r.team);
    if (list) list.push(r);
    else byTeam.set(r.team, [r]);
  }
  for (const list of byTeam.values()) {
    list.sort(compareRankOrder);
    for (let p = 0; p < list.length; p++) out.set(list[p]!.id, rankAt(p, list.length, list[p]!.score));
  }
  return out;
}
