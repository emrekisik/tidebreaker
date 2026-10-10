import { TICK_RATE } from '../config/net.ts';
import type { ShipDef } from '../config/ships.ts';
import { SALVO_GAP_SEC, WEAPONS } from '../config/weapons.ts';

/**
 * Damage per second a ship deals when every mount keeps firing and every shot hits (an upper
 * bound: broadside mounts can only fire into their arcs). Reload times are rounded up to whole
 * ticks and at most one shot leaves the ship per `SALVO_GAP_SEC`, like in the simulation.
 */
export function sustainedDps(def: ShipDef): number {
  let dps = 0;
  let shotsPerSec = 0;
  for (const m of def.mounts) {
    const w = WEAPONS[m.weapon];
    const interval = Math.ceil(w.intervalSec * TICK_RATE - 1e-9) / TICK_RATE;
    dps += w.damage / interval;
    shotsPerSec += 1 / interval;
  }
  const cap = 1 / SALVO_GAP_SEC;
  return shotsPerSec > cap ? (dps * cap) / shotsPerSec : dps;
}

/** Shield plus hull: the damage needed to sink a ship. */
export function effectiveHealth(def: ShipDef): number {
  return def.shield + def.hull;
}

/**
 * Seconds `attackers` ships of class `attacker` need to sink one `victim`, when a fraction
 * `accuracy` of their shots hit (no recharge, no dodging).
 */
export function timeToKill(
  attacker: ShipDef,
  victim: ShipDef,
  accuracy: number,
  attackers = 1,
): number {
  const dps = sustainedDps(attacker) * accuracy * attackers;
  return dps > 0 ? effectiveHealth(victim) / dps : Infinity;
}
