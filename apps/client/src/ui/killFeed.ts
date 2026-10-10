import { NO_WEAPON, TEAM_BLUE } from '@tidebreaker/shared';
import { t } from '../i18n/index.ts';

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
  ): void {
    const row = document.createElement('div');
    row.className = mine ? 'feed-row mine' : 'feed-row';
    row.append(
      this.name(killerName, killerTeam),
      this.text(weapon === NO_WEAPON ? ` ${t('feed.ram')} ` : ' ▸ ', 'feed-arrow'),
      this.name(victimName, victimTeam),
    );
    this.root.append(row);
    while (this.root.childElementCount > MAX_ROWS) this.root.firstElementChild?.remove();
    setTimeout(() => row.classList.add('fading'), LIFETIME_MS - 600);
    setTimeout(() => row.remove(), LIFETIME_MS);
  }

  private name(text: string, team: number): HTMLElement {
    return this.text(text, team === TEAM_BLUE ? 'feed-blue' : 'feed-red');
  }

  private text(text: string, cls: string): HTMLElement {
    const el = document.createElement('span');
    el.className = cls;
    el.textContent = text;
    return el;
  }
}
