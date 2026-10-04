import { WORLD_CENTER } from './world.ts';

/** Offline phase 1a sandbox: stationary targets to shoot at. Not part of the final game. */
export const TRAINING = {
  playerShip: 'coast_guard_boat',
  playerSpawn: { x: WORLD_CENTER, y: WORLD_CENTER, heading: 0 },
  targetShip: 'coast_guard_boat',
  /** Offsets from the player spawn. */
  targetOffsets: [
    { x: 32, y: -6 },
    { x: 20, y: 28 },
    { x: -30, y: 14 },
  ],
  targetRespawnSec: 3,
  /** Duration of the sinking animation (client cosmetic). */
  sinkAnimSec: 1.5,
} as const;
