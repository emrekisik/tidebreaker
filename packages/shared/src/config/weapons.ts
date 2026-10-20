/** Cosmetic class of a projectile; the client picks mesh and effects from it. */
export type ProjectileVisual = 'bullet' | 'shell' | 'rocket' | 'missile' | 'heavy';

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
  /** Visual size of the projectile and its trail (default 1). */
  size?: number;
  /**
   * Area damage where the shot ends (it hits a ship, lands in the water or hits land): ships of other
   * teams within `radius` of the point take `damageFactor` of the damage, less toward the rim
   * (`edgeFactor` of that at the edge). The ship that was hit takes the full damage only.
   */
  splash?: { radius: number; damageFactor: number; edgeFactor: number };
  /**
   * Shots that lose strength with distance (the rapid-fire guns): over its flight the shot gets thinner and hits
   * softer, in a straight line from full strength at the muzzle to `damage` and `radius` (shares of the
   * full values) at the end of its range.
   */
  falloff?: { damage: number; radius: number };
  /** Guided shots only: how fast (degrees per second) the flight direction can turn toward the target. */
  turnRateDeg?: number;
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
    // (Reaches farther than the cannons, but a long shot is thin and soft: see `falloff`.)
    range: 72,
    projectileSpeed: 75,
    radius: 0.15,
    spreadDeg: 4.5,
    startSpeedPct: 1,
    accelSec: 0,
    visual: 'bullet',
    falloff: { damage: 0.3, radius: 0.45 },
  },
  // Turret cannons follow GAME_DESIGN.md §6.3 per tier (damage / interval); range grows with tier.
  cannon_t3: {
    damage: 16,
    intervalSec: 1,
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
    intervalSec: 1.1,
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
    intervalSec: 1.1,
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
    range: 88,
    projectileSpeed: 75,
    radius: 0.15,
    spreadDeg: 3,
    startSpeedPct: 1,
    accelSec: 0,
    visual: 'bullet',
    falloff: { damage: 0.3, radius: 0.45 },
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
  // The pirates' broadside guns: cannons only, a little weaker than the player classes'.
  pirate_cannon_s: {
    damage: 9,
    intervalSec: 1.1,
    range: 48,
    projectileSpeed: 55,
    radius: 0.22,
    spreadDeg: 3.5,
    startSpeedPct: 1,
    accelSec: 0,
    visual: 'shell',
  },
  pirate_cannon_m: {
    damage: 13,
    intervalSec: 1.2,
    range: 55,
    projectileSpeed: 58,
    radius: 0.25,
    spreadDeg: 3,
    startSpeedPct: 1,
    accelSec: 0,
    visual: 'shell',
  },
  pirate_cannon_l: {
    damage: 17,
    intervalSec: 1.3,
    range: 62,
    projectileSpeed: 60,
    radius: 0.28,
    spreadDeg: 2.5,
    startSpeedPct: 1,
    accelSec: 0,
    visual: 'shell',
  },
  // Drone guns (GAME_DESIGN.md §7.3): the FPV drone's small machine gun and the combat drone's rocket.
  drone_gun: {
    damage: 1.8,
    intervalSec: 0.12,
    range: 38,
    projectileSpeed: 75,
    radius: 0.15,
    spreadDeg: 5,
    startSpeedPct: 1,
    accelSec: 0,
    visual: 'bullet',
    falloff: { damage: 0.35, radius: 0.5 },
  },
  drone_rocket: {
    damage: 20,
    intervalSec: 2.4,
    range: 48,
    projectileSpeed: 66,
    radius: 0.3,
    spreadDeg: 2.5,
    startSpeedPct: 0.25,
    accelSec: 0.8,
    visual: 'rocket',
  },
  // The guided missile (GAME_DESIGN.md §7.4): one heavy hit, steered at the locked ship with a limited
  // turn rate, so a small ship that keeps turning can make it miss. Fired by the lock-on, not by a mount.
  missile: {
    damage: 80,
    intervalSec: 3,
    range: 280,
    projectileSpeed: 56,
    radius: 0.45,
    spreadDeg: 0,
    startSpeedPct: 0.35,
    accelSec: 1.2,
    visual: 'missile',
    turnRateDeg: 95,
  },
  // The cruiser's sniper rocket: one big, fast, accurate shot with a very long reload and a range that
  // needs the camera zoomed out. A near miss still hurts (splash).
  cruiser_rocket: {
    damage: 260,
    intervalSec: 6,
    range: 150,
    projectileSpeed: 90,
    radius: 0.5,
    spreadDeg: 0.4,
    startSpeedPct: 0.3,
    accelSec: 0.8,
    visual: 'heavy',
    size: 1.5,
    splash: { radius: 5, damageFactor: 0.6, edgeFactor: 0.4 },
  },
} as const satisfies Record<string, WeaponDef>;

export type WeaponId = keyof typeof WEAPONS;

/** Stable numeric ids (index into this list); used in projectile storage and, later, the wire. */
export const WEAPON_IDS = Object.keys(WEAPONS) as WeaponId[];

export function weaponIndex(id: WeaponId): number {
  return WEAPON_IDS.indexOf(id);
}
