export interface WeaponDef {
  damage: number;
  /** Seconds between shots (before reload multipliers). */
  intervalSec: number;
  /** Max travel distance in world units. */
  range: number;
  /** World units per second. */
  projectileSpeed: number;
  /** Collision radius of the projectile. */
  radius: number;
  /** Max random deviation (degrees, +/-) applied by the server/sim RNG. */
  spreadDeg: number;
}

export const WEAPONS = {
  // T1 deck cannon (GAME_DESIGN.md §6.3): dmg 10, 0.9 s, projectile speed 60, range 42.
  deck_cannon_t1: {
    damage: 10,
    intervalSec: 0.9,
    range: 42,
    projectileSpeed: 60,
    radius: 0.5,
    spreadDeg: 1.5,
  },
} as const satisfies Record<string, WeaponDef>;

export type WeaponId = keyof typeof WEAPONS;
