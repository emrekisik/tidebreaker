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
