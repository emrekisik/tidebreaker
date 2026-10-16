import type { MountDef, ShipDef } from './ships.ts';
import type { WeaponId } from './weapons.ts';

/** What kind of drone it is (GAME_DESIGN.md §7.3). */
export interface DroneType {
  /** Label, model key and i18n key suffix (`drone.<id>`). */
  id: string;
  def: ShipDef;
  /** Money for buying it at the own carrier. */
  price: number;
  /** Score the team that shoots it down gets. */
  bounty: number;
}

/**
 * A drone: a small flying gun that escorts its owner and shoots enemies on its own. It is a
 * combatant like a ship (same hit test, projectile and mount code) but flies over land and does not
 * collide with ships. One fixed gun in the nose, firing within `arcDeg` either side of the heading.
 */
function droneShip(
  id: string,
  length: number,
  weapon: WeaponId,
  stats: { hull: number; shield: number; vMax: number; turnRateDeg: number },
): ShipDef {
  const mount: MountDef = {
    id: 'nose',
    offset: [length * 0.3, 0],
    muzzle: length * 0.4,
    facingDeg: 0,
    arcDeg: 28,
    weapon,
  };
  return {
    id,
    tier: 1,
    modelKey: id,
    ...stats,
    length,
    hitCircles: [{ offset: 0, radius: Math.round(length * 0.38 * 100) / 100 }],
    mounts: [mount],
    flying: true,
  };
}

const fpv = droneShip('fpv_drone', 3.4, 'drone_gun', {
  hull: 35,
  shield: 10,
  vMax: 32,
  turnRateDeg: 260,
});
const combat = droneShip('combat_drone', 4.4, 'drone_rocket', {
  hull: 70,
  shield: 25,
  vMax: 22,
  turnRateDeg: 170,
});

/** Index = the drone's `shipId` on the wire (ENTER of a `KIND.DRONE` entity) and in BUY_DRONE. */
export const DRONE_TYPES: readonly DroneType[] = [
  { id: 'fpv_drone', def: fpv, price: 60, bounty: 8 },
  { id: 'combat_drone', def: combat, price: 140, bounty: 18 },
];

export const DRONE = {
  /** Drones one player may have at a time (any mix of types). */
  perPlayer: 2,
  /** A drone can be bought within this distance of the own carrier's hull. */
  buyRadius: 50,
  /** The AI thinks this often (every n-th tick; drones are spread over the ticks). */
  thinkEveryTicks: 3,
  /** Resting positions around the owner: distance, and the angle between the owner's drones. */
  orbitRadius: 13,
  /** Seconds one full turn of the resting position around the owner takes (they drift slowly). */
  orbitSec: 14,
  /** It attacks an enemy this close to itself... */
  detectRadius: 58,
  /** ...as long as the enemy is no further than this from the owner (otherwise it goes home). */
  leash: 85,
  /** It likes to fight at this fraction of its weapon range, and keeps shooting inside this one. */
  fightDistFactor: 0.7,
  /** Linear acceleration (units/s^2) and how much speed it loses per second when not accelerating. */
  accel: 70,
  drag: 1.2,
  /** Spread of aim (degrees) so they do not hit every shot. */
  aimErrorDeg: 2.5,
  /** Seconds a bought drone needs to leave the carrier before it can shoot (and be shot). */
  launchSec: 1.5,
  /** Height (world units) the client draws drones above the water. */
  hover: 4.2,
} as const;
