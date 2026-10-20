import { NO_WEAPON, TEAM_BLUE, TEAM_PIRATE } from '@tidebreaker/shared';
import { t } from '../i18n/index.ts';
import { rankBadge } from './rankBadge.ts';
import { RankBook } from './rankBook.ts';

const MAX_ROWS = 6;
const LIFETIME_MS = 7000;

/** "Who sank whom" list in a corner of the screen. Rows fade out by themselves. */
export class KillFeed {
  constructor(private readonly root: HTMLElement) {}

  /** Names are shown as text only (never as HTML). `mine`: the player is one of the two. */
  add(
    killerName: string,
    victimName: string,
    killerTeam: number,
    victimTeam: number,
    weapon: number,
    mine: boolean,
    killerRank: number | null = null,
    victimRank: number | null = null,
  ): void {
    const row = document.createElement('div');
    row.className = mine ? 'feed-row panel mine' : 'feed-row panel';
    row.append(
      this.name(killerName, killerTeam, killerRank),
      this.text(weapon === NO_WEAPON ? ` ${t('feed.ram')} ` : ' ▸ ', 'feed-arrow'),
      this.name(victimName, victimTeam, victimRank),
    );
    this.root.append(row);
    while (this.root.childElementCount > MAX_ROWS) this.root.firstElementChild?.remove();
    setTimeout(() => row.classList.add('fading'), LIFETIME_MS - 600);
    setTimeout(() => row.remove(), LIFETIME_MS);
  }

  private name(text: string, team: number, rank: number | null): HTMLElement {
    const el = this.text(
      text,
      team === TEAM_BLUE ? 'feed-blue' : team === TEAM_PIRATE ? 'feed-pirate' : 'feed-red',
    );
    if (rank !== null) el.prepend(rankBadge(rank, RankBook.title(rank)));
    return el;
  }

  private text(text: string, cls: string): HTMLElement {
    const el = document.createElement('span');
    el.className = cls;
    el.textContent = text;
    return el;
  }
}
