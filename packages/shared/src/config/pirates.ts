import { TEAM_COUNT } from './match.ts';
import type { MountDef, ShipDef } from './ships.ts';
import type { WeaponId } from './weapons.ts';
import { WORLD_CENTER, WORLD_SIZE } from './world.ts';

/** Team value of the pirates: hostile to both teams, friendly only to each other. */
export const TEAM_PIRATE = TEAM_COUNT;

/** What kind of pirate ship it is (GAME_DESIGN.md §7.2). */
export interface PirateType {
  /** Server-side label and i18n key suffix (`pirate.<id>`); also the name sent for the nameplate. */
  id: string;
  def: ShipDef;
  /** Tier used for the reward scale (1..3, like the player classes). */
  tier: number;
  /** Money (score and cash) for sinking it, before the tier scale (see `pirateReward`). */
  reward: number;
  /** Seconds until a sunk pirate of this type shows up again at its cove. */
  respawnSec: number;
  /** It notices a player this close. */
  detectRadius: number;
  /** Multiplies every reload time (above 1 = fires less often than a player ship of the model). */
  reload: number;
  /** Fraction of the weapon range it likes to fight at. */
  fightRange: number;
  /** Small and weak ones run for home when badly hurt. */
  flees: boolean;
}

/**
 * A pirate ship: one hull model (a sailing ship) at three sizes, armed with broadside cannons only
 * (`perSide` on each side, firing about 55 degrees either side of the beam). Hit circles follow the
 * hull along its length.
 */
function pirateShip(
  id: string,
  length: number,
  tier: number,
  perSide: number,
  weapon: WeaponId,
  stats: { hull: number; shield: number; vMax: number; turnRateDeg: number },
): ShipDef {
  const mounts: MountDef[] = [];
  for (const side of [1, -1]) {
    for (let k = 0; k < perSide; k++) {
      const along = perSide === 1 ? 0 : (k / (perSide - 1) - 0.5) * 0.4 * length;
      mounts.push({
        id: `${side > 0 ? 'starboard' : 'port'}_${k + 1}`,
        offset: [along, side * 0.09 * length],
        muzzle: 0.06 * length,
        facingDeg: side * 90,
        arcDeg: 55,
        weapon,
      });
    }
  }
  const circles = [-0.3, -0.15, 0, 0.15, 0.3].map((f) => ({
    offset: Math.round(f * length * 100) / 100,
    radius: Math.round(0.11 * length * 100) / 100,
  }));
  return {
    id,
    tier,
    modelKey: id,
    ...stats,
    length,
    hitCircles: circles,
    mounts,
  };
}

const skiff = pirateShip('pirate_skiff', 7, 1, 1, 'pirate_cannon_s', {
  hull: 45,
  shield: 10,
  vMax: 14,
  turnRateDeg: 110,
});
const raider = pirateShip('pirate_raider', 10, 2, 2, 'pirate_cannon_m', {
  hull: 140,
  shield: 30,
  vMax: 12.5,
  turnRateDeg: 90,
});
const corsair = pirateShip('pirate_corsair', 14, 3, 3, 'pirate_cannon_l', {
  hull: 380,
  shield: 90,
  vMax: 11.5,
  turnRateDeg: 75,
});

/** Index = the pirate's `shipId` on the wire (ENTER of a `KIND.PIRATE` entity). */
export const PIRATE_TYPES: readonly PirateType[] = [
  {
    id: 'skiff',
    def: skiff,
    tier: 1,
    reward: 18,
    respawnSec: 40,
    detectRadius: 65,
    reload: 1,
    fightRange: 0.65,
    flees: true,
  },
  {
    id: 'raider',
    def: raider,
    tier: 2,
    reward: 45,
    respawnSec: 70,
    detectRadius: 75,
    reload: 1,
    fightRange: 0.7,
    flees: true,
  },
  {
    id: 'corsair',
    def: corsair,
    tier: 3,
    reward: 140,
    respawnSec: 120,
    detectRadius: 85,
    reload: 1,
    fightRange: 0.8,
    flees: false,
  },
];

export const PIRATE_SKIFF = 0;
export const PIRATE_RAIDER = 1;
export const PIRATE_CORSAIR = 2;

/** Pirate behavior numbers (GAME_DESIGN.md §8). */
export const PIRATE = {
  /** Open water kept free of islands and reefs around each cove. */
  coveRadius: 40,
  /** Pirates at rest sail between random points this close to their cove. */
  patrolRadius: 45,
  /** Past this distance from the cove a pirate gives up the chase and sails home. */
  leash: 150,
  /** The AI thinks every this many ticks (spread over the pirates). */
  thinkEveryTicks: 4,
  /** A pirate keeps its target at least this long (no flickering between two players). */
  targetLockSec: 3,
  /** Players this close to a carrier are left alone: the carrier's guns would shred the pirate. */
  carrierAvoid: 105,
  /** Badly hurt skiffs and raiders run home below this hull share and return above the other. */
  fleeHullPct: 0.25,
  recoverHullPct: 0.6,
  /** Random aim error added to every shot decision (degrees, +/-). */
  aimErrorDeg: 3.5,
  /** Whiskers look this far ahead (units per unit of speed) for land, at +/- this angle. */
  whiskerSec: 2.2,
  whiskerDeg: 38,
  /** A target farther than this times the detect radius is lost. */
  loseTargetFactor: 1.8,
  /** The pirate's reward is cut by this much per tier the sinking player is above the pirate... */
  rewardTierPenalty: 0.25,
  /** ...but never below this share. */
  rewardMinFactor: 0.1,
} as const;

/** Where the pirates live, mirrored left to right so neither team is closer to any of them. */
export const PIRATE_COVES: readonly { readonly x: number; readonly y: number }[] = [
  { x: WORLD_CENTER, y: 110 },
  { x: WORLD_CENTER, y: WORLD_SIZE - 110 },
  { x: 360, y: 250 },
  { x: WORLD_SIZE - 360, y: 250 },
  { x: 360, y: WORLD_SIZE - 250 },
  { x: WORLD_SIZE - 360, y: WORLD_SIZE - 250 },
];

/** Pirate types living at each cove (same order as `PIRATE_COVES`). */
export const PIRATE_GARRISONS: readonly (readonly number[])[] = [
  [PIRATE_CORSAIR, PIRATE_SKIFF, PIRATE_SKIFF],
  [PIRATE_CORSAIR, PIRATE_SKIFF, PIRATE_SKIFF],
  [PIRATE_RAIDER, PIRATE_SKIFF],
  [PIRATE_RAIDER, PIRATE_SKIFF],
  [PIRATE_RAIDER, PIRATE_SKIFF],
  [PIRATE_RAIDER, PIRATE_SKIFF],
];

/** Number of pirate ships in a room (each has a fixed entity slot). */
export const PIRATE_COUNT = PIRATE_GARRISONS.reduce((n, g) => n + g.length, 0);
