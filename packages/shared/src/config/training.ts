import { WORLD_CENTER } from './world.ts';

/**
 * Offline sandbox: the player (blue team) and a fleet of stationary enemy ships (red team) made of
 * the real ship classes. Not part of the final game.
 */
export const TRAINING = {
  /** Seed of the practice map (the client can override it with `?seed=`). */
  mapSeed: 1337,
  playerShip: 'coast_guard_boat',
  playerSpawn: { x: WORLD_CENTER, y: WORLD_CENTER, heading: 0 },
  /** Positions are offsets from the player spawn; `heading` in radians (0 = facing +x). */
  targets: [
    { ship: 'coast_guard_boat', x: 34, y: -8, heading: 2.6 },
    { ship: 'gunboat', x: 22, y: 30, heading: -1.2 },
    { ship: 'landing_craft', x: -34, y: 16, heading: 0.4 },
    { ship: 'corvette', x: 52, y: 26, heading: 3.0 },
    { ship: 'frigate', x: -22, y: -34, heading: 1.4 },
    { ship: 'cruiser', x: 14, y: -52, heading: 2.2 },
    { ship: 'heavy_frigate', x: -62, y: -4, heading: 0.2 },
  ],
  targetRespawnSec: 4,
  playerRespawnSec: 3,
  /** Duration of the sinking animation (client cosmetic). */
  sinkAnimSec: 1.5,
} as const;

/** The fight behind the start screen (client only, cosmetic): two AI fleets that circle and shoot at each other. */
export const MENU_BATTLE = {
  /** The ship classes of each team (the same list for both). */
  fleet: ['gunboat', 'corvette', 'frigate', 'cruiser'],
  /** Distance a ship tries to keep from its target. */
  preferredRange: 24,
  /** Open fire inside this distance (the guns reach about 60). */
  fireRange: 52,
  /** How far a ship may stray from the middle of the fight before it turns back. */
  arenaRadius: 30,
  /** Open water needed around the middle of the fight, and how fast that middle may move (units per second). */
  clearRadius: 52,
  moveSpeed: 8,
  /** A sunk ship comes back after this long, at its side of the fight this far from the middle (out of sight, it sails in). */
  respawnSec: 4,
  startGap: 95,
  /** How far a ship's aim wanders from the target (radians): the fight has misses. */
  aimError: 0.09,
} as const;
