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
  /** Top reverse speed as a fraction of vMax, and how fast reverse builds up (fraction of accel). */
  reverseSpeedFactor: 0.4,
  reverseAccelFactor: 0.6,
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
    length: 5.8,
    hitCircles: [
      { offset: -1.96, radius: 0.85 },
      { offset: -0.65, radius: 0.85 },
      { offset: 0.65, radius: 0.85 },
      { offset: 1.96, radius: 0.85 },
    ],
    mounts: [turret('mg', -0.03, -0.02, 0.64, 'machine_gun')],
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
    length: 8,
    hitCircles: [
      { offset: -2.74, radius: 1.14 },
      { offset: -0.91, radius: 1.14 },
      { offset: 0.91, radius: 1.14 },
      { offset: 2.74, radius: 1.14 },
    ],
    mounts: [
      turret('mg_1', -1.49, 0.3, 0.38, 'machine_gun'),
      turret('mg_2', -1.51, -0.25, 0.4, 'machine_gun'),
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
    length: 12.5,
    hitCircles: [
      { offset: -5.17, radius: 0.99 },
      { offset: -3.44, radius: 0.99 },
      { offset: -1.73, radius: 0.99 },
      { offset: 0, radius: 0.99 },
      { offset: 1.73, radius: 0.99 },
      { offset: 3.44, radius: 0.99 },
      { offset: 5.17, radius: 0.99 },
    ],
    mounts: [
      turret('front', 4.43, 0.2, 0.58, 'cannon_t3'),
      turret('back', -2.93, -0.01, 0.58, 'cannon_t3'),
      turret('launcher_1', 1.42, 0.26, 0.24, 'rocket'),
      turret('launcher_2', 1.42, -0.27, 0.25, 'rocket'),
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
    length: 12.5,
    hitCircles: [
      { offset: -5.23, radius: 0.93 },
      { offset: -3.49, radius: 0.93 },
      { offset: -1.74, radius: 0.93 },
      { offset: 0, radius: 0.93 },
      { offset: 1.74, radius: 0.93 },
      { offset: 3.49, radius: 0.93 },
      { offset: 5.23, radius: 0.93 },
    ],
    mounts: [
      turret('front', 4.7, -0.08, 0.76, 'cannon_t4'),
      turret('back_1', -5.75, 0.36, 0.65, 'cannon_t4'),
      turret('back_2', -5.76, -0.36, 0.65, 'cannon_t4'),
      turret('mg', 0.4, -0.05, 0.3, 'machine_gun'),
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
    length: 16.5,
    hitCircles: [
      { offset: -6.91, radius: 1.23 },
      { offset: -4.61, radius: 1.23 },
      { offset: -2.3, radius: 1.23 },
      { offset: 0, radius: 1.23 },
      { offset: 2.3, radius: 1.23 },
      { offset: 4.61, radius: 1.23 },
      { offset: 6.91, radius: 1.23 },
    ],
    mounts: [
      turret('front_1', 5.47, -0.6, 0.68, 'cannon_t4'),
      turret('front_2', 5.48, 0.6, 0.68, 'cannon_t4'),
      turret('mg', 1.45, 0, 0.15, 'machine_gun'),
      turret('launcher_1', -1.47, -0.08, 0.14, 'rocket'),
      turret('launcher_2', -1.07, 0.07, 0.14, 'rocket'),
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
    length: 20.5,
    hitCircles: [
      { offset: -8.67, radius: 1.45 },
      { offset: -6.2, radius: 1.45 },
      { offset: -3.71, radius: 1.45 },
      { offset: -1.24, radius: 1.45 },
      { offset: 1.24, radius: 1.45 },
      { offset: 3.71, radius: 1.45 },
      { offset: 6.2, radius: 1.45 },
      { offset: 8.67, radius: 1.45 },
    ],
    mounts: [
      turret('front_1', 1.82, 0.09, 1.82, 'cannon_t5'),
      turret('front_2', 3.39, 0.08, 1.82, 'cannon_t5'),
      turret('back', -8.68, 0.09, 1.25, 'cannon_t5'),
      turret('launcher_1', -1.08, 0.05, 0.2, 'rocket'),
      turret('launcher_2', -1.73, 0.23, 0.18, 'rocket'),
    ],
  },
} as const satisfies Record<string, ShipDef>;

export type ShipId = keyof typeof SHIPS;

/** Stable numeric ids (index into this list): the class a player picks on the wire. */
export const SHIP_IDS = Object.keys(SHIPS) as ShipId[];
