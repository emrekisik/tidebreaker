import type { WeaponId } from './weapons.ts';

export interface MountDef {
  id: string;
  /** Turret pivot as [forward, starboard] in ship-local units. */
  offset: readonly [number, number];
  /** Distance from the pivot to the barrel tip; shots spawn here, along the fire direction. */
  muzzle: number;
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
  /** Key for the client AssetProvider / MODEL_SPECS. */
  modelKey: string;
  hull: number;
  shield: number;
  /** World units per second. */
  vMax: number;
  turnRateDeg: number;
  /** Must match the model's `length` in the client's MODEL_SPECS (checked by a test). */
  length: number;
  hitCircles: readonly HitCircle[];
  /** Index i is the i-th entry of `aimNodes` in MODEL_SPECS; earlier mounts fire first. */
  mounts: readonly MountDef[];
}

/** Movement model constants (GAME_DESIGN.md §5.2). */
export const SHIP_MOVEMENT = {
  /** Seconds from standstill to full speed at full throttle. */
  accelSeconds: 2.5,
  /** Seconds from full speed to standstill when coasting (no throttle). */
  coastSeconds: 5.0,
  /** Seconds from full speed to standstill with the brake held. */
  brakeSeconds: 1.5,
  /** Turn-rate factor when (almost) stationary; rises to 1 at `turnFullSpeedFrac` of vMax. */
  minTurnFactor: 0.35,
  turnFullSpeedFrac: 0.5,
  /** Fraction of target speed lost while the rudder is fully over. */
  turnDrag: 0.15,
} as const;

/** A 360 degree turret mount. Pivot and muzzle numbers are measured from the 3D model. */
function turret(
  id: string,
  forward: number,
  starboard: number,
  muzzle: number,
  weapon: WeaponId,
): MountDef {
  return { id, offset: [forward, starboard], muzzle, facingDeg: 0, arcDeg: 180, weapon };
}

// Hit circles follow each model's hull footprint (width * 0.45 radius, spaced to cover the length).
export const SHIPS = {
  coast_guard_boat: {
    id: 'coast_guard_boat',
    tier: 1,
    modelKey: 'assault_boat',
    hull: 100,
    shield: 40,
    vMax: 16,
    turnRateDeg: 120,
    length: 5,
    hitCircles: [
      { offset: -1.69, radius: 0.73 },
      { offset: -0.56, radius: 0.73 },
      { offset: 0.56, radius: 0.73 },
      { offset: 1.69, radius: 0.73 },
    ],
    mounts: [turret('mg', -0.03, -0.02, 0.55, 'machine_gun')],
  },
  gunboat: {
    id: 'gunboat',
    tier: 2,
    modelKey: 'hovercraft',
    hull: 180,
    shield: 70,
    vMax: 14.5,
    turnRateDeg: 100,
    length: 7,
    hitCircles: [
      { offset: -0.99, radius: 2.28 },
      { offset: 0.99, radius: 2.28 },
    ],
    mounts: [
      turret('mg_port', 1.91, -0.95, 0.84, 'machine_gun'),
      turret('mg_starboard', 1.91, 1.05, 0.84, 'machine_gun'),
    ],
  },
  landing_craft: {
    id: 'landing_craft',
    tier: 2,
    modelKey: 'landing_craft',
    hull: 220,
    shield: 70,
    vMax: 12,
    turnRateDeg: 85,
    length: 7,
    hitCircles: [
      { offset: -2.4, radius: 1 },
      { offset: -0.8, radius: 1 },
      { offset: 0.8, radius: 1 },
      { offset: 2.4, radius: 1 },
    ],
    mounts: [
      turret('mg_1', -1.3, 0.26, 0.33, 'machine_gun'),
      turret('mg_2', -1.32, -0.22, 0.35, 'machine_gun'),
    ],
  },
  corvette: {
    id: 'corvette',
    tier: 3,
    modelKey: 'frigate1',
    hull: 320,
    shield: 130,
    vMax: 13,
    turnRateDeg: 85,
    length: 9,
    hitCircles: [
      { offset: -3.72, radius: 0.71 },
      { offset: -2.48, radius: 0.71 },
      { offset: -1.24, radius: 0.71 },
      { offset: 0, radius: 0.71 },
      { offset: 1.24, radius: 0.71 },
      { offset: 2.48, radius: 0.71 },
      { offset: 3.72, radius: 0.71 },
    ],
    mounts: [
      turret('front', 3.19, 0.15, 0.42, 'cannon_t3'),
      turret('back', -2.11, -0.01, 0.42, 'cannon_t3'),
      turret('launcher_1', 1.02, 0.19, 0.17, 'rocket'),
      turret('launcher_2', 1.02, -0.2, 0.18, 'rocket'),
    ],
  },
  frigate: {
    id: 'frigate',
    tier: 4,
    modelKey: 'frigate2',
    hull: 560,
    shield: 220,
    vMax: 12,
    turnRateDeg: 70,
    length: 9,
    hitCircles: [
      { offset: -3.76, radius: 0.67 },
      { offset: -2.51, radius: 0.67 },
      { offset: -1.25, radius: 0.67 },
      { offset: 0, radius: 0.67 },
      { offset: 1.25, radius: 0.67 },
      { offset: 2.51, radius: 0.67 },
      { offset: 3.76, radius: 0.67 },
    ],
    mounts: [
      turret('front', 3.39, -0.06, 0.55, 'cannon_t4'),
      turret('back_1', -4.14, 0.26, 0.47, 'cannon_t4'),
      turret('back_2', -4.15, -0.26, 0.47, 'cannon_t4'),
      turret('mg', 0.29, -0.03, 0.21, 'machine_gun'),
    ],
  },
  cruiser: {
    id: 'cruiser',
    tier: 4,
    modelKey: 'cruiser',
    hull: 560,
    shield: 220,
    vMax: 12,
    turnRateDeg: 70,
    length: 12,
    hitCircles: [
      { offset: -5.02, radius: 0.89 },
      { offset: -3.35, radius: 0.89 },
      { offset: -1.67, radius: 0.89 },
      { offset: 0, radius: 0.89 },
      { offset: 1.67, radius: 0.89 },
      { offset: 3.35, radius: 0.89 },
      { offset: 5.02, radius: 0.89 },
    ],
    mounts: [
      turret('front_1', 3.98, -0.44, 0.5, 'cannon_t4'),
      turret('front_2', 3.99, 0.44, 0.5, 'cannon_t4'),
      turret('mg', 1.05, 0, 0.11, 'machine_gun'),
      turret('launcher_1', -1.07, -0.06, 0.1, 'rocket'),
      turret('launcher_2', -0.78, 0.05, 0.1, 'rocket'),
    ],
  },
  heavy_frigate: {
    id: 'heavy_frigate',
    tier: 5,
    modelKey: 'battleship',
    hull: 900,
    shield: 380,
    vMax: 11,
    turnRateDeg: 60,
    length: 15,
    hitCircles: [
      { offset: -6.34, radius: 1.06 },
      { offset: -4.53, radius: 1.06 },
      { offset: -2.72, radius: 1.06 },
      { offset: -0.91, radius: 1.06 },
      { offset: 0.91, radius: 1.06 },
      { offset: 2.72, radius: 1.06 },
      { offset: 4.53, radius: 1.06 },
      { offset: 6.34, radius: 1.06 },
    ],
    mounts: [
      turret('front_1', 1.33, 0.07, 1.33, 'cannon_t5'),
      turret('front_2', 2.48, 0.06, 1.33, 'cannon_t5'),
      turret('back', -6.35, 0.07, 0.92, 'cannon_t5'),
      turret('launcher_1', -0.79, 0.03, 0.15, 'rocket'),
      turret('launcher_2', -1.27, 0.17, 0.13, 'rocket'),
    ],
  },
} as const satisfies Record<string, ShipDef>;

export type ShipId = keyof typeof SHIPS;
