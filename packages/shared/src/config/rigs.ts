import { WORLD_CENTER } from './world.ts';

/**
 * Offshore oil rigs (GAME_DESIGN.md §4.6): capture points in the middle of the sea. A team that
 * holds a rig earns money for every one of its players. The rigs stand on the line halfway
 * between the two carriers, so each is exactly as far from one team as from the other.
 */
export const RIG = {
  count: 3,
  /** The two outer rigs are this far from the center along the line between the sides. */
  spread: 280,
  /** Ships inside this circle count for the capture. */
  captureRadius: 32,
  /** The platform itself is a solid obstacle (a reef-like circle) in the middle. */
  platformRadius: 6,
  /** No island or reef is generated closer than this to the edge of the capture circle. */
  clearance: 28,
  /**
   * Seconds one point of power needs to move the gauge from neutral to full (the full swing from
   * one team to the other takes twice as long). Power of a ship = 1 + tier * powerPerTier.
   */
  captureSecPerPower: 30,
  powerPerTier: 0.5,
  /** More power than this on one side does not make the capture any faster. */
  maxPowerAdvantage: 3,
  /** Every owned rig pays this much (score and money) to every player of the owning team... */
  incomeCash: 1,
  /** ...this often (seconds). */
  incomeEverySec: 3,
} as const;

/** Centers of the rigs, north to south. */
export const RIGS: readonly { readonly x: number; readonly y: number }[] = [
  { x: WORLD_CENTER, y: WORLD_CENTER - RIG.spread },
  { x: WORLD_CENTER, y: WORLD_CENTER },
  { x: WORLD_CENTER, y: WORLD_CENTER + RIG.spread },
];

/** Gauge value: +1 = fully blue, -1 = fully red, 0 = neutral. Wire: i8, value * 127. */
export const RIG_NO_OWNER = 255;
