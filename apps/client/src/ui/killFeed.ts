import { KILL_CAUSE, TEAM_BLUE, TEAM_PIRATE, WEAPONS, WEAPON_IDS } from '@tidebreaker/shared';
import barrelIcon from './icons/barrel.svg?raw';
import killIcon from './icons/kill.svg?raw';
import mineIcon from './icons/mine.svg?raw';
import missileIcon from './icons/missile.svg?raw';
import ramIcon from './icons/ram.svg?raw';
import rocksIcon from './icons/rocks.svg?raw';
import { rankBadge } from './rankBadge.ts';
import { RankBook } from './rankBook.ts';

const MAX_ROWS = 6;
const LIFETIME_MS = 7000;

/**
 * The mark between the two names, by what sank the ship: a crosshair for a kill by gunfire (a missile for a
 * missile), a bow hitting something for a ram, a barrel, a sea mine, or rocks when a ship wrecked itself.
 */
function causeIcon(weapon: number): { svg: string; cls: string } {
  switch (weapon) {
    case KILL_CAUSE.RAM:
      return { svg: ramIcon, cls: 'ram' };
    case KILL_CAUSE.BARREL:
      return { svg: barrelIcon, cls: 'barrel' };
    case KILL_CAUSE.MINE:
      return { svg: mineIcon, cls: 'mine' };
    case KILL_CAUSE.ROCKS:
      return { svg: rocksIcon, cls: 'rocks' };
  }
  const id = WEAPON_IDS[weapon];
  const visual = id ? WEAPONS[id].visual : 'bullet';
  return visual === 'missile' || visual === 'rocket' ? { svg: missileIcon, cls: 'missile' } : { svg: killIcon, cls: 'kill' };
}

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
    // (A ship that wrecked itself on rocks has no killer: the mark comes first.)
    if (killerName !== '') row.append(this.name(killerName, killerTeam, killerRank));
    row.append(this.icon(weapon), this.name(victimName, victimTeam, victimRank));
    this.root.append(row);
    while (this.root.childElementCount > MAX_ROWS) this.root.firstElementChild?.remove();
    setTimeout(() => row.classList.add('fading'), LIFETIME_MS - 600);
    setTimeout(() => row.remove(), LIFETIME_MS);
  }

  private icon(weapon: number): HTMLElement {
    const { svg, cls } = causeIcon(weapon);
    const el = document.createElement('span');
    el.className = `feed-icon ${cls}`;
    el.innerHTML = svg.replace(/ width="\d+" height="\d+"/, '');
    return el;
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
