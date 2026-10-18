import { MATCH, TEAM_COUNT } from './match.ts';
import { RIG, RIGS } from './rigs.ts';

/**
 * Sea mines (GAME_DESIGN.md §7.3c): bought at the own carrier (base shop) by T3 and higher ships,
 * laid with a key, floating where they were laid. They go off when an enemy ship touches them, or when
 * they are shot; the blast hurts enemy ships (never the layer's team) within its radius.
 */
export const MINE = {
  /** Lowest class that may carry mines (tier index: 2 = T3). */
  minTier: 2,
  /** Mines one ship carries, and the money for one at the base shop. */
  maxStock: 3,
  price: 60,
  /** Seconds between two mines of one ship. */
  layCooldownSec: 1.5,
  /** A new mine does nothing for this long. */
  armSec: 1.5,
  /** A mine that was not set off vanishes after this long. */
  lifeSec: 90,
  /** Mines of one player and of one team in the water at once (a new mine replaces its layer's oldest). */
  perPlayer: 4,
  perTeam: 12,
  /** Hit points, and how big the mine counts for shots. Any shot hurts it, from either team. */
  hp: 15,
  hitRadius: 1.4,
  /** An armed mine goes off when an enemy hull comes this close to it. */
  triggerRadius: 2.6,
  /** The blast: enemy ships within `radius` of the hull take `damage`, down to `edgeFactor` of it at the rim. */
  blast: { radius: 9, damage: 70, edgeFactor: 0.35 },
  /** No mines inside an oil rig's capture circle plus this margin... */
  rigClear: 10,
  /** ...nor this close to the enemy carrier (its spawn area and guns). */
  carrierClear: 120,
} as const;

/** Mines in the water at most (every team at its limit). */
export const MINE_CAPACITY = MINE.perTeam * TEAM_COUNT;

/** Mines get entity ids from here up (ships use 1 + slot, pickups `PICKUP_ID_BASE` + slot). */
export const MINE_ID_BASE = 3000;

/** Why a mine cannot be laid at a spot (see `mineBlocked`). */
export const MINE_BLOCK = { NONE: 0, RIG: 1, CARRIER: 2 } as const;

/** `MINE_BLOCK.*`: whether a mine of `team` may not be laid at (x, y). Server and client use the same rule. */
export function mineBlocked(x: number, y: number, team: number): number {
  const reach = RIG.captureRadius + MINE.rigClear;
  for (let i = 0; i < RIGS.length; i++) {
    const dx = x - RIGS[i]!.x;
    const dy = y - RIGS[i]!.y;
    if (dx * dx + dy * dy < reach * reach) return MINE_BLOCK.RIG;
  }
  const enemy = MATCH.carriers[team === 0 ? 1 : 0]!;
  const dx = x - enemy.x;
  const dy = y - enemy.y;
  if (dx * dx + dy * dy < MINE.carrierClear * MINE.carrierClear) return MINE_BLOCK.CARRIER;
  return MINE_BLOCK.NONE;
}
