import { RANKS, rankTable } from '@tidebreaker/shared';
import type { ScoreEntry } from '@tidebreaker/shared';
import { t } from '../i18n/index.ts';
import type { MessageKey } from '../i18n/index.ts';

/**
 * The rank of every player, worked out from the scoreboard rows the server sends (the rank depends only on the
 * scores of a player's own team, see `rankTable`), so the server needs to know nothing about it.
 */
export class RankBook {
  private ranks = new Map<number, number>();
  /** The player's own rank went up (the new rank). */
  onPromoted: ((rank: number) => void) | null = null;
  /** The player's own rank changed (up or down); `rank` is the new one. */
  onOwnRank: ((rank: number) => void) | null = null;
  private lastOwn = -1;

  /** The server's latest scores. */
  update(rows: readonly ScoreEntry[], myId: number): void {
    this.ranks = rankTable(rows);
    const own = this.ranks.get(myId);
    if (own === undefined) return;
    if (own !== this.lastOwn) {
      if (this.lastOwn >= 0 && own > this.lastOwn) this.onPromoted?.(own);
      this.lastOwn = own;
      this.onOwnRank?.(own);
    }
  }

  /** Rank of a player (0 when unknown). */
  of(id: number): number {
    return this.ranks.get(id) ?? 0;
  }

  /** A new match or connection: the next rank is not a promotion. */
  reset(): void {
    this.ranks = new Map();
    this.lastOwn = -1;
  }

  /** The name of a rank ("Petty Officer"), also the tooltip of its insignia. */
  static title(rank: number): string {
    const k = Math.max(0, Math.min(RANKS.count - 1, Math.floor(rank)));
    return t(`rank.name.${k}` as MessageKey);
  }
}
