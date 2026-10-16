import type { ShipDef, ShipState } from '@tidebreaker/shared';
import { GhostTracker } from '../frame/ghost.ts';
import hullIcon from './icons/hull.svg?raw';
import shieldIcon from './icons/shield.svg?raw';

const HINT_VISIBLE_MS = 15000;
/** One line is drawn on a bar for every this many points. */
const TICK_POINTS = 20;

/** DOM HUD: hull/shield bars (a number and a mark every 20 points) and the white "recently lost" part, sunk counter, control hint. */
export class Hud {
  private readonly hull = document.getElementById('bar-hull') as HTMLElement;
  private readonly shield = document.getElementById('bar-shield') as HTMLElement;
  private readonly hullGhost = document.getElementById('ghost-hull') as HTMLElement;
  private readonly shieldGhost = document.getElementById('ghost-shield') as HTMLElement;
  private readonly hullNum = document.getElementById('num-hull') as HTMLElement;
  private readonly shieldNum = document.getElementById('num-shield') as HTMLElement;
  private readonly hullTicks = document.getElementById('ticks-hull') as HTMLElement;
  private readonly shieldTicks = document.getElementById('ticks-shield') as HTMLElement;
  private readonly sunk = document.getElementById('sunk-count') as HTMLElement;
  private readonly hint = document.getElementById('hint') as HTMLElement;
  private readonly startMs = performance.now();
  private hintHidden = false;
  private readonly hullTrack = new GhostTracker();
  private readonly shieldTrack = new GhostTracker();
  private lastKills = -1;

  constructor() {
    const set = (id: string, svg: string): void => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = svg.replace(/ width="\d+" height="\d+"/, '');
    };
    set('ico-hull', hullIcon);
    set('ico-shield', shieldIcon);
  }
  /** What was last written (the page is only touched when something changes). */
  private lastHull = -1;
  private lastHullMax = -1;
  private lastShield = -1;
  private lastShieldMax = -1;

  /** Called every frame so the white part drains smoothly. */
  update(
    ship: ShipState,
    def: ShipDef,
    kills: number,
    nowMs: number,
    dtSec: number,
    maxShield: number = def.shield,
  ): void {
    const hullFrac = ship.hull / def.hull;
    const shieldFrac = Math.min(1, ship.shield / maxShield);
    this.hull.style.width = `${100 * hullFrac}%`;
    this.shield.style.width = `${100 * shieldFrac}%`;
    this.hullGhost.style.width = `${100 * this.hullTrack.update(hullFrac, dtSec)}%`;
    this.shieldGhost.style.width = `${100 * this.shieldTrack.update(shieldFrac, dtSec)}%`;
    this.numbers(ship, def.hull, maxShield);
    if (kills !== this.lastKills) {
      this.sunk.textContent = String(kills);
      this.lastKills = kills;
    }
    if (!this.hintHidden && nowMs - this.startMs > HINT_VISIBLE_MS) {
      this.hint.classList.add('hidden');
      this.hintHidden = true;
    }
  }

  /** The hull and shield points as whole numbers; the bar marks follow the maximum. Only written on a change. */
  private numbers(ship: ShipState, maxHull: number, maxShield: number): void {
    const hull = Math.max(0, Math.ceil(ship.hull));
    const hullMax = Math.round(maxHull);
    if (hullMax !== this.lastHullMax) {
      this.lastHullMax = hullMax;
      this.hullTicks.style.setProperty('--tick', `${(100 * TICK_POINTS) / hullMax}%`);
    }
    if (hull !== this.lastHull) {
      this.lastHull = hull;
      this.hullNum.textContent = String(hull);
    }
    const shield = Math.max(0, Math.ceil(ship.shield));
    const shieldMax = Math.round(maxShield);
    if (shieldMax !== this.lastShieldMax) {
      this.lastShieldMax = shieldMax;
      this.shieldTicks.style.setProperty('--tick', `${(100 * TICK_POINTS) / shieldMax}%`);
    }
    if (shield !== this.lastShield) {
      this.lastShield = shield;
      this.shieldNum.textContent = String(shield);
    }
  }
}
