import type { ShipState } from '@tidebreaker/shared';
import type { ShipDef } from '@tidebreaker/shared';

const HINT_VISIBLE_MS = 15000;

/** DOM HUD: hull/shield bars, sunk counter and the control hint. Refreshed at <= 10 Hz. */
export class Hud {
  private readonly hull = document.getElementById('bar-hull') as HTMLElement;
  private readonly shield = document.getElementById('bar-shield') as HTMLElement;
  // The white "recently lost" bars: CSS delays and eases their shrink (see index.html).
  private readonly hullGhost = document.getElementById('ghost-hull') as HTMLElement;
  private readonly shieldGhost = document.getElementById('ghost-shield') as HTMLElement;
  private readonly sunk = document.getElementById('sunk-count') as HTMLElement;
  private readonly hint = document.getElementById('hint') as HTMLElement;
  private readonly startMs = performance.now();
  private hintHidden = false;

  update(ship: ShipState, def: ShipDef, kills: number, nowMs: number): void {
    const hull = `${(100 * ship.hull) / def.hull}%`;
    const shield = `${(100 * ship.shield) / def.shield}%`;
    this.hull.style.width = hull;
    this.shield.style.width = shield;
    this.hullGhost.style.width = hull;
    this.shieldGhost.style.width = shield;
    this.sunk.textContent = String(kills);
    if (!this.hintHidden && nowMs - this.startMs > HINT_VISIBLE_MS) {
      this.hint.classList.add('hidden');
      this.hintHidden = true;
    }
  }
}
