import type { WeaponId } from './weapons.ts';

export interface MountDef {
  id: string;
  /** [forward, starboard] in ship-local units. */
  offset: readonly [number, number];
  /** 0 = bow, 90 = starboard, -90 = port, 180 = stern. */
  facingDeg: number;
  /** Half-arc in degrees; 180 = full 360 degree turret. */
  arcDeg: number;
  weapon: WeaponId;
}

/** Hull hit shape: circles along the ship's forward axis. */
export interface HitCircle {
  offset: number;
  radius: number;
}

export interface ShipDef {
  id: string;
  tier: number;
  /** Key for the client AssetProvider. */
  modelKey: string;
  hull: number;
  shield: number;
  /** World units per second. */
  vMax: number;
  turnRateDeg: number;
  length: number;
  hitCircles: readonly HitCircle[];
  mounts: readonly MountDef[];
}

/** Movement model constants (GAME_DESIGN.md §5.2). */
export const SHIP_MOVEMENT = {
  accelSeconds: 2.5,
  decelSeconds: 5.0,
  /** Speed factor when the desired heading is 180 degrees away. */
  minHeadingFactor: 0.4,
  moveEpsilon: 0.01,
} as const;

export const SHIPS = {
  coast_guard_boat: {
    id: 'coast_guard_boat',
    tier: 1,
    modelKey: 'coast_guard_boat',
    hull: 100,
    shield: 40,
    vMax: 16,
    turnRateDeg: 120,
    length: 5,
    hitCircles: [
      { offset: -1.4, radius: 1.1 },
      { offset: 0, radius: 1.2 },
      { offset: 1.4, radius: 1.0 },
    ],
    mounts: [{ id: 'deck', offset: [0.3, 0], facingDeg: 0, arcDeg: 180, weapon: 'deck_cannon_t1' }],
  },
} as const satisfies Record<string, ShipDef>;

export type ShipId = keyof typeof SHIPS;
