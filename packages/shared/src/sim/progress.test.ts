import { describe, expect, it } from 'vitest';
import { ECONOMY, TIER_SHIPS } from '../config/economy.ts';
import { SHIPS } from '../config/ships.ts';
import {
  canTierUp,
  killReward,
  reloadMul,
  shieldMul,
  speedMul,
  statCap,
  statCost,
  tierOf,
  turnMul,
  zoneMultiplier,
} from './progress.ts';

describe('upgrade costs and effects', () => {
  it('follows the documented price curve', () => {
    expect(statCost(0)).toBe(12);
    expect(statCost(1)).toBe(17);
    expect(statCost(2)).toBe(24);
    expect(statCost(7)).toBe(127);
    for (let l = 0; l < 10; l++) expect(statCost(l + 1)).toBeGreaterThan(statCost(l));
  });

  it('caps grow with the tier and stay inside the table', () => {
    for (let t = 1; t < 5; t++) expect(statCap(t)).toBeGreaterThan(statCap(t - 1));
    expect(statCap(-3)).toBe(statCap(0));
    expect(statCap(99)).toBe(statCap(4));
  });

  it('level 0 changes nothing, higher levels help', () => {
    for (const f of [speedMul, reloadMul, turnMul, shieldMul]) {
      expect(f(0)).toBe(1);
    }
    expect(speedMul(3)).toBeGreaterThan(1);
    expect(turnMul(3)).toBeGreaterThan(1);
    expect(shieldMul(3)).toBeGreaterThan(1);
    expect(reloadMul(3)).toBeLessThan(1);
    // The best reload level must not reach zero or go negative.
    expect(reloadMul(ECONOMY.statCap[4]!)).toBeGreaterThan(0.5);
  });
});

describe('tiers', () => {
  it('the ladder is in tier order and every step needs more score', () => {
    TIER_SHIPS.forEach((id, i) => expect(SHIPS[id].tier).toBe(i + 1));
    for (let t = 1; t < ECONOMY.tierScore.length; t++) {
      expect(ECONOMY.tierScore[t]).toBeGreaterThan(ECONOMY.tierScore[t - 1]!);
    }
    expect(tierOf(SHIPS.cruiser)).toBe(3);
  });

  it('allows moving up only with enough score and never past T5', () => {
    const t1 = ECONOMY.tierScore[1]!;
    expect(canTierUp(0, t1 - 1)).toBe(false);
    expect(canTierUp(0, t1)).toBe(true);
    expect(canTierUp(3, ECONOMY.tierScore[4]!)).toBe(true);
    expect(canTierUp(4, 1e9)).toBe(false);
  });
});

describe('kill rewards', () => {
  it('is a share of the victim score, capped', () => {
    expect(killReward(1000, 2, 2, 0)).toBe(350);
    expect(killReward(100000, 4, 4, 0)).toBe(ECONOMY.kill.cap);
  });

  it('pays less for beating a weaker ship, never less than the minimum', () => {
    const even = killReward(1000, 3, 3, 0);
    expect(killReward(1000, 2, 3, 0)).toBeLessThan(even);
    expect(killReward(1000, 0, 3, 0)).toBeLessThan(killReward(1000, 1, 3, 0));
    expect(killReward(0, 0, 4, 0)).toBe(ECONOMY.kill.minReward);
  });

  it('repeat kills of the same victim pay a quarter', () => {
    const first = killReward(1000, 2, 2, 0);
    expect(killReward(1000, 2, 2, 1)).toBe(first);
    expect(killReward(1000, 2, 2, 2)).toBe(Math.round(first * ECONOMY.kill.repeatFactor));
  });
});

describe('zones', () => {
  it('pays more toward the middle of the map', () => {
    expect(zoneMultiplier(100, 200, 375)).toBe(ECONOMY.pickups.zoneMul.inner);
    expect(zoneMultiplier(300, 200, 375)).toBe(ECONOMY.pickups.zoneMul.middle);
    expect(zoneMultiplier(500, 200, 375)).toBe(ECONOMY.pickups.zoneMul.outer);
  });
});
