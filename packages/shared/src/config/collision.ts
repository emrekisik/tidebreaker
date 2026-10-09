/** Ship-to-ship collision tuning (GAME_DESIGN.md §5.2). */
export const COLLISION = {
  /** 0 = ships stop dead along the contact normal, 1 = perfect bounce. */
  restitution: 0.3,
  /** Closing speeds below this (world units/s) bump without damage. */
  minDamageSpeed: 2.5,
  /** Hull points per unit of closing speed, before the mass split (see resolveCollisions). */
  damagePerSpeed: 3,
  /** Sideways knock-back and spin die out with these time constants (seconds). */
  knockDecaySec: 1.1,
  spinDecaySec: 0.9,
  /** Radians per second of spin gained per unit of (lever arm x velocity change) / ship length. */
  spinPerTorque: 0.35,
  maxSpin: 2.2,
  maxKnock: 14,
  /** Ships are pushed apart a little more than the exact overlap so they do not stay glued. */
  slop: 0.03,
  /** Closing speeds below this report no collision event at all (no shake, no effects). */
  eventSpeed: 1,
} as const;

/** Ship-to-island and projectile-to-island settings (GAME_DESIGN.md §4.3, §5.2). */
export const ISLAND_COLLISION = {
  /** Fraction of the sliding speed kept each tick while a hull scrapes a coast (no damage). */
  tangentKeep: 0.96,
  /** Extra push-out beyond the exact overlap so a hull does not stay glued to the shore. */
  slop: 0.02,
  /** Impacts below this normal speed (units/s) report no event (no shake, no splash). */
  eventSpeed: 2,
} as const;
