import { CAMERA } from './camera.ts';

/**
 * The guided missile (GAME_DESIGN.md §7.4): bought at the own carrier (base shop), locked onto one
 * visible enemy ship for `lockSec` seconds, then it flies after the ship. Its flight numbers are the
 * `missile` entry of `WEAPONS`.
 */
export const MISSILE = {
  /** Missiles one ship carries (bought one by one). */
  maxStock: 2,
  /** Lowest class that may carry them (tier index: 2 = T3), so T1 and T2 ships cannot buy any. */
  minTier: 2,
  /** Money for one missile at the base shop. */
  price: 160,
  /** Seconds the target has to stay locked before the missile leaves. */
  lockSec: 2,
  /**
   * How far a ship may be locked: the missile reaches what the player sees on the screen. The
   * server does not know the zoom or the window shape, so it only enforces this loose limit, a bit
   * more than the farthest screen corner at full zoom-out; the client demands that the target is
   * really on the screen. (Multiplies the camera distance of the shooter's class at full zoom-out.)
   */
  lockReach: 1.3,
  /** The missile leaves the ship this far ahead of its center (fraction of the ship length). */
  launchAhead: 0.35,
} as const;

/** Farthest distance (world units) a ship of class `tier` (index) may lock a target. */
export function lockRange(tier: number): number {
  return (CAMERA.baseDistance + CAMERA.perTier * tier) * CAMERA.zoomMax * MISSILE.lockReach;
}
