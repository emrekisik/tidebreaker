import type { ShipDef, ShipState } from '@tidebreaker/shared';
import { GhostTracker } from '../frame/ghost.ts';

const HINT_VISIBLE_MS = 15000;

/** DOM HUD: hull/shield bars (with numbers) and the white "recently lost" part, sunk counter, control hint. */
export class Hud {
  private readonly hull = document.getElementById('bar-hull') as HTMLElement;
  private readonly shield = document.getElementById('bar-shield') as HTMLElement;
  private readonly hullGhost = document.getElementById('ghost-hull') as HTMLElement;
  private readonly shieldGhost = document.getElementById('ghost-shield') as HTMLElement;
  private readonly hullNum = document.getElementById('num-hull') as HTMLElement;
  private readonly shieldNum = document.getElementById('num-shield') as HTMLElement;
  private readonly sunk = document.getElementById('sunk-count') as HTMLElement;
  private readonly hint = document.getElementById('hint') as HTMLElement;
  private readonly startMs = performance.now();
  private hintHidden = false;
  private readonly hullTrack = new GhostTracker();
  private readonly shieldTrack = new GhostTracker();
  private lastKills = -1;
  /** The numbers last written (the text is only touched when one changes). */
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

  /** "hull / max" and "shield / max" as whole numbers, rewritten only when they change. */
  private numbers(ship: ShipState, maxHull: number, maxShield: number): void {
    const hull = Math.max(0, Math.ceil(ship.hull));
    const hullMax = Math.round(maxHull);
    if (hull !== this.lastHull || hullMax !== this.lastHullMax) {
      this.lastHull = hull;
      this.lastHullMax = hullMax;
      this.hullNum.innerHTML = `${hull}<i>/${hullMax}</i>`;
    }
    const shield = Math.max(0, Math.ceil(ship.shield));
    const shieldMax = Math.round(maxShield);
    if (shield !== this.lastShield || shieldMax !== this.lastShieldMax) {
      this.lastShield = shield;
      this.lastShieldMax = shieldMax;
      this.shieldNum.innerHTML = `${shield}<i>/${shieldMax}</i>`;
    }
  }
}
