import { RANKS } from '@tidebreaker/shared';
import { rankBadge } from './rankBadge.ts';
import { RankBook } from './rankBook.ts';

/** Which team a ship is on (`teamKey`): a plate takes the colour of the team's country. */
export type PlateTeam = 'a' | 'b' | 'pirate';

interface Plate {
  el: HTMLElement;
  badge: HTMLElement;
  /** -1: no rank (pirates). */
  rank: number;
  x: number;
  y: number;
  shown: boolean;
}

/**
 * The name plates above the ships: frosted glass (a blurred, tinted pane that shows the sea through it) with the
 * rank insignia and the name. They are page elements placed over the game every frame, because the blur
 * needs the page's `backdrop-filter`; a ship that is gone, sunk or off screen has its plate hidden.
 */
export class NamePlates {
  private readonly plates = new Map<number, Plate>();
  private readonly out = new Float32Array(2);

  constructor(private readonly root: HTMLElement) {}

  /** A plate for ship `id`; `rank` -1 shows no insignia. Shown as text only (names are never HTML). */
  add(id: number, name: string, team: PlateTeam, rank: number, own = false): void {
    this.remove(id);
    const el = document.createElement('div');
    el.className = `nplate ${team === 'pirate' ? team : `team-${team}`}${own ? ' own' : ''}`;
    el.style.display = 'none';
    const badge = document.createElement('span');
    badge.className = 'np-rank';
    const label = document.createElement('span');
    label.className = 'np-name';
    label.textContent = name;
    el.append(badge, label);
    this.root.append(el);
    const plate: Plate = { el, badge, rank: -2, x: -1e9, y: -1e9, shown: false };
    this.plates.set(id, plate);
    this.setRank(id, rank);
  }

  remove(id: number): void {
    const p = this.plates.get(id);
    if (!p) return;
    p.el.remove();
    this.plates.delete(id);
  }

  clear(): void {
    for (const p of this.plates.values()) p.el.remove();
    this.plates.clear();
  }

  /** Another insignia (or none: -1) on the plate of `id`. */
  setRank(id: number, rank: number): void {
    const p = this.plates.get(id);
    if (!p || p.rank === rank) return;
    p.rank = rank;
    p.el.classList.toggle('top', rank >= 0 && rank === RANK_TOP);
    p.badge.replaceChildren();
    if (rank >= 0) p.badge.append(rankBadge(rank, RankBook.title(rank)));
    p.badge.style.display = rank >= 0 ? '' : 'none';
  }

  /** New scores: the plates of players (not pirates) show their current rank. */
  applyRanks(rankOf: (id: number) => number): void {
    for (const [id, p] of this.plates) if (p.rank >= 0) this.setRank(id, rankOf(id));
  }

  /**
   * Every frame. `project(id, out)` writes the screen position (pixels) where the plate's bottom middle goes and
   * returns true, or returns false when there is nothing to show (the ship is hidden or off screen).
   */
  update(project: (id: number, out: Float32Array) => boolean): void {
    for (const [id, p] of this.plates) {
      const on = project(id, this.out);
      if (on !== p.shown) {
        p.shown = on;
        p.el.style.display = on ? '' : 'none';
      }
      if (!on) continue;
      const x = Math.round(this.out[0]!);
      const y = Math.round(this.out[1]!);
      if (x !== p.x || y !== p.y) {
        p.x = x;
        p.y = y;
        p.el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -100%)`;
      }
    }
  }
}

const RANK_TOP = RANKS.count - 1;
