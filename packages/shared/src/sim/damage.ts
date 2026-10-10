import type { ShipState } from './types.ts';

export const HIT_SHIELD = 1;
export const HIT_KILLED = 2;

/**
 * Applies damage: shield first, overflow goes to the hull (GAME_DESIGN.md §5.4).
 * Returns a bit set of HIT_* flags.
 */
export function applyDamage(s: ShipState, amount: number): number {
  let flags = 0;
  let remaining = amount;
  if (amount > 0) s.sinceDamage = 0;
  if (s.shield > 0) {
    flags |= HIT_SHIELD;
    const absorbed = Math.min(s.shield, remaining);
    s.shield -= absorbed;
    remaining -= absorbed;
  }
  if (remaining > 0) {
    s.hull = Math.max(0, s.hull - remaining);
  }
  if (s.hull <= 0 && s.alive) {
    s.alive = false;
    flags |= HIT_KILLED;
  }
  return flags;
}

/**
 * Recharges the shield of a living ship that has been left alone for `delaySec`; an empty shield
 * takes `rechargeSec` to fill (GAME_DESIGN.md §5.4). Call once per tick.
 */
export function regenShield(
  s: ShipState,
  maxShield: number,
  delaySec: number,
  rechargeSec: number,
  dt: number,
): void {
  if (!s.alive) return;
  s.sinceDamage += dt;
  if (s.sinceDamage < delaySec || s.shield >= maxShield) return;
  s.shield = Math.min(maxShield, s.shield + (maxShield / rechargeSec) * dt);
}
