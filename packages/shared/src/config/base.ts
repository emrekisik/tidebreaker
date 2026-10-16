/**
 * The base shop (GAME_DESIGN.md §7.3): what a player can buy for the team at their own carrier, besides
 * drones. Both items work on the carrier of the buyer's team.
 */
export const BASE = {
  /** Mending the carrier: each purchase gives back this share of its full hull, for this much money. */
  repair: { pct: 0.1, price: 200 },
  /**
   * Better defense guns: each level makes the carrier's guns hit harder and fire faster. The cost of
   * level L + 1 is `ceil(base * growth^L)`; the level is the team's, and a new round starts it over.
   */
  guns: {
    maxLevel: 5,
    damagePerLevel: 0.15,
    reloadPerLevel: 0.08,
    cost: { base: 250, growth: 1.6 },
  },
} as const;

/** What the BASE_BUY message asks for (the wire value). */
export const BASE_ITEM = { REPAIR: 0, GUNS: 1 } as const;

/** Money for the next level of the carrier guns (Infinity at the top level). */
export function gunsCost(level: number): number {
  return level >= BASE.guns.maxLevel ? Infinity : Math.ceil(BASE.guns.cost.base * BASE.guns.cost.growth ** level);
}

export const gunsDamageMul = (level: number): number => 1 + BASE.guns.damagePerLevel * level;
export const gunsReloadMul = (level: number): number => 1 - BASE.guns.reloadPerLevel * level;
