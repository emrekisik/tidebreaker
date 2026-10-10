/** Cosmetic class of a projectile; the client picks mesh and effects from it. */
export type ProjectileVisual = 'bullet' | 'shell' | 'rocket';

export interface WeaponDef {
  damage: number;
  /** Seconds between shots of one mount (rounded up to whole sim ticks at 20 Hz). */
  intervalSec: number;
  /** Max travel distance in world units. */
  range: number;
  /** World units per second. Projectiles fly straight at constant speed. */
  projectileSpeed: number;
  /** Collision radius of the projectile. */
  radius: number;
  /** Max random deviation (degrees, +/-) applied by the server/sim RNG. */
  spreadDeg: number;
  /** Fraction of `projectileSpeed` the shot leaves the barrel with (1 = constant speed). */
  startSpeedPct: number;
  /** Seconds to ease (quadratically) from the start speed to `projectileSpeed` (0 = constant speed). */
  accelSec: number;
  visual: ProjectileVisual;
}

/**
 * Mounts spread over the hull aim at the point under the cursor, so their shots converge there
 * instead of flying parallel. The aim distance is clamped to at least this many units.
 */
export const MOUNT_CONVERGE_MIN = 8;

/** Minimum time between two shots of the same ship, so mounts fire one after another. */
export const SALVO_GAP_SEC = 0.1;

export const WEAPONS = {
  machine_gun: {
    damage: 2,
    intervalSec: 0.15,
    range: 45,
    projectileSpeed: 75,
    radius: 0.15,
    spreadDeg: 4.5,
    startSpeedPct: 1,
    accelSec: 0,
    visual: 'bullet',
  },
  // Turret cannons follow GAME_DESIGN.md §6.3 per tier (damage / interval); range grows with tier.
  cannon_t3: {
    damage: 16,
    intervalSec: 0.75,
    range: 58,
    projectileSpeed: 60,
    radius: 0.25,
    spreadDeg: 2.5,
    startSpeedPct: 1,
    accelSec: 0,
    visual: 'shell',
  },
  cannon_t4: {
    damage: 18,
    intervalSec: 0.8,
    range: 63,
    projectileSpeed: 60,
    radius: 0.28,
    spreadDeg: 2.5,
    startSpeedPct: 1,
    accelSec: 0,
    visual: 'shell',
  },
  cannon_t5: {
    damage: 22,
    intervalSec: 0.8,
    range: 70,
    projectileSpeed: 60,
    radius: 0.32,
    spreadDeg: 2,
    startSpeedPct: 1,
    accelSec: 0,
    visual: 'shell',
  },
  // Direct hit only (no splash). Slower and longer reload than cannons.
  rocket: {
    damage: 15,
    intervalSec: 2,
    range: 70,
    projectileSpeed: 66,
    radius: 0.3,
    spreadDeg: 2.5,
    // Rockets crawl out of the tube and keep building speed (quadratic ease-in), so they are
    // slow at the start and fast near the target.
    startSpeedPct: 0.25,
    accelSec: 0.8,
    visual: 'rocket',
  },
  // The aircraft carrier's defensive guns (GAME_DESIGN.md §4.5).
  carrier_gun: {
    damage: 8,
    intervalSec: 0.25,
    range: 60,
    projectileSpeed: 75,
    radius: 0.15,
    spreadDeg: 3,
    startSpeedPct: 1,
    accelSec: 0,
    visual: 'bullet',
  },
  // The carrier's second turret fires rockets instead of bullets (an exception to its turret type).
  carrier_rocket: {
    damage: 36,
    intervalSec: 1.5,
    range: 70,
    projectileSpeed: 66,
    radius: 0.35,
    spreadDeg: 2,
    startSpeedPct: 0.25,
    accelSec: 0.8,
    visual: 'rocket',
  },
} as const satisfies Record<string, WeaponDef>;

export type WeaponId = keyof typeof WEAPONS;

/** Stable numeric ids (index into this list); used in projectile storage and, later, the wire. */
export const WEAPON_IDS = Object.keys(WEAPONS) as WeaponId[];

export function weaponIndex(id: WeaponId): number {
  return WEAPON_IDS.indexOf(id);
}
