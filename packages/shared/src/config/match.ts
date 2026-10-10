import type { ShipDef } from './ships.ts';
import { WORLD_CENTER, WORLD_SIZE } from './world.ts';

/** Teams of the match (GAME_DESIGN.md §4.5). */
export const TEAM_BLUE = 0;
export const TEAM_RED = 1;
export const TEAM_COUNT = 2;

/**
 * The team base: an aircraft carrier anchored near the world edge. It cannot move (vMax 0) and
 * defends itself with the two turrets of its model (a machine gun and a rocket launcher) (pivots measured from the 3D model, like the
 * other ships). Hit circles cover the hull: 60 long, about 21 wide.
 */
export const CARRIER: ShipDef = {
  id: 'aircraft_carrier',
  tier: 0,
  modelKey: 'aircraft_carrier',
  hull: 4000,
  shield: 1500,
  vMax: 0,
  turnRateDeg: 0,
  length: 60,
  hitCircles: [
    { offset: -24, radius: 10.5 },
    { offset: -12, radius: 10.5 },
    { offset: 0, radius: 10.5 },
    { offset: 12, radius: 10.5 },
    { offset: 24, radius: 10.5 },
  ],
  mounts: [
    {
      id: 'tower1',
      offset: [-0.91, 8.02],
      muzzle: 0.3,
      facingDeg: 0,
      arcDeg: 180,
      weapon: 'carrier_gun',
    },
    {
      id: 'tower2',
      offset: [-2.66, 8.04],
      muzzle: 0.3,
      facingDeg: 0,
      arcDeg: 180,
      weapon: 'carrier_rocket',
    },
  ],
};

/** Room and match settings (GAME_DESIGN.md §4.5, §10, §11). */
export const MATCH = {
  maxPlayers: 24,
  /** Players per team (a new player joins the team with fewer players, blue on a tie). */
  perTeam: 12,
  /** Where the carriers are anchored; `heading` is where the bow points. */
  carriers: [
    { team: TEAM_BLUE, x: 130, y: WORLD_CENTER, heading: 0 },
    { team: TEAM_RED, x: WORLD_SIZE - 130, y: WORLD_CENTER, heading: Math.PI },
  ],
  /** Seconds before a sunk player returns at their carrier. */
  respawnSec: 5,
  /** Seconds between the end of a round and the start of the next. */
  intermissionSec: 15,
  /** Players appear on a ring of this radius around their carrier, on the side facing the enemy. */
  spawnRadius: 48,
  spawnCandidates: 9,
  /** Half of the angular spread of the spawn ring seen from the carrier (degrees). */
  spawnSpreadDeg: 70,
  /** Seconds of invulnerability after (re)spawning. */
  spawnProtectSec: 3,
} as const;
