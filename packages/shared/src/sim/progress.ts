import { ECONOMY, TIER_SHIPS } from '../config/economy.ts';
import type { ShipDef } from '../config/ships.ts';

/** Money needed to raise a stat from `level` to `level + 1`. */
export function statCost(level: number): number {
  return Math.ceil(ECONOMY.statCost.base * ECONOMY.statCost.growth ** level);
}

/** Highest level a stat may reach at tier index `tier` (0 = T1). */
export function statCap(tier: number): number {
  const caps = ECONOMY.statCap;
  return caps[Math.max(0, Math.min(caps.length - 1, tier))]!;
}

/** Multipliers for the levels of the speed, reload, turn and shield stats. */
export const speedMul = (level: number): number => 1 + ECONOMY.perLevel.speed * level;
export const reloadMul = (level: number): number => 1 - ECONOMY.perLevel.reload * level;
export const turnMul = (level: number): number => 1 + ECONOMY.perLevel.turn * level;
export const shieldMul = (level: number): number => 1 + ECONOMY.perLevel.shield * level;

/** Tier index (0 = T1) of a ship class. */
export function tierOf(def: ShipDef): number {
  return Math.max(0, Math.min(TIER_SHIPS.length - 1, def.tier - 1));
}

/** True when `score` allows moving up from tier index `tier`. */
export function canTierUp(tier: number, score: number): boolean {
  return tier < TIER_SHIPS.length - 1 && score >= ECONOMY.tierScore[tier + 1]!;
}

/**
 * Score and money for sinking an enemy: a share of the victim's score, smaller for a victim of a
 * lower tier, and much smaller when the same pair keeps repeating (spawn camping).
 * `repeats` = how many times this killer already sank this victim within the repeat window.
 */
export function killReward(
  victimScore: number,
  victimTier: number,
  killerTier: number,
  repeats: number,
): number {
  const K = ECONOMY.kill;
  const diff = Math.max(0, killerTier - victimTier);
  const tierFactor = K.tierDiff[Math.min(diff, K.tierDiff.length - 1)]!;
  const repeatFactor = repeats >= K.repeatFree ? K.repeatFactor : 1;
  const base = Math.min(victimScore * K.victimScorePct, K.cap);
  return Math.max(K.minReward, Math.round(base * tierFactor * repeatFactor));
}

/** Region multiplier of a pickup by its distance from the map center. */
export function zoneMultiplier(distFromCenter: number, inner: number, outer: number): number {
  const z = ECONOMY.pickups.zoneMul;
  return distFromCenter < inner ? z.inner : distFromCenter < outer ? z.middle : z.outer;
}
