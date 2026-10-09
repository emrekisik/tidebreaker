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
