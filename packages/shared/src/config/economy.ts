import { TEAM_COUNT } from './match.ts';
import type { ShipId } from './ships.ts';

/** The six upgradable stats (GAME_DESIGN.md §6.2). The index is also the wire value. */
export const STAT = { SPEED: 0, RELOAD: 1, TURN: 2, SHIELD: 3, REGEN: 4, DAMAGE: 5 } as const;
export const STAT_COUNT = 6;

/** The class ladder a player climbs, T1 to T5 (the other models are side branches for later). */
export const TIER_SHIPS: readonly ShipId[] = [
  'coast_guard_boat',
  'gunboat',
  'corvette',
  'frigate',
  'heavy_frigate',
];

/** Pickup kinds (their `KIND` values in snapshots are in net/messages.ts). */
export type PickupKind = 'crate' | 'barrel' | 'chest' | 'banknote';

/**
 * Money, score and upgrades (GAME_DESIGN.md §6, §7). Money (cash) buys upgrades AND the next class;
 * score only counts (leaderboard) and comes from sinking ships (players, pirates) and capturing oil
 * rigs, never from picking money up. Every number here is a first guess that `pnpm balance-sim`
 * helps to tune; the pacing goal is T2 ~1.5 min, T3 ~4, T4 ~8, T5 ~15.
 */
export const ECONOMY = {
  /** Money the move up to tier index i costs (0 = T1); it is spent, like an upgrade. */
  tierCost: [0, 70, 250, 650, 1500],
  /** Highest upgrade level per stat while at tier index i. */
  statCap: [3, 4, 5, 7, 8],
  /** `statCost(L) = ceil(base * growth^L)` money for going from level L to L+1. */
  statCost: { base: 12, growth: 1.4 },
  /** Effect of one level of each stat (see sim/progress.ts). */
  perLevel: { speed: 0.07, reload: 0.07, turn: 0.09, shield: 0.12, damage: 0.1 },

  /** What sinking costs the loser. */
  death: {
    /** Sinkings a player survives in one class: the money is lost every time, the class when the
     * last life is gone (then the lives start over). */
    lives: 3,
    /** Classes lost when the lives run out (never below T1). */
    tierLoss: 1,
    /** Share of the money the loser carries that is lost; it floats away as banknotes anyone can pick up. */
    cashLossPct: 0.8,
    /** The lost money is dropped as this many piles of banknotes (fewer if tiny). */
    lootPiles: 5,
    lootMinPile: 5,
    lootLifeSec: 40,
    /** How far from the wreck the piles scatter. */
    lootSpread: 7,
  },

  /** Sinking an enemy ship. */
  kill: {
    /** Base reward by the victim's tier (0 = T1) plus this share of the victim's score. */
    tierValue: [15, 40, 110, 260, 520],
    victimScorePct: 0.2,
    /** The killer also gets this share of the reward as money (the score part is always 1). */
    cashShare: 1,
    cap: 1500,
    /** Reward factor by (killer tier - victim tier): 0, 1, 2, 3 or more tiers below. */
    tierDiff: [1, 0.7, 0.3, 0.1],
    /** The 3rd and later kill of the same victim by the same killer within this window pay less. */
    repeatWindowSec: 300,
    repeatFree: 2,
    repeatFactor: 0.25,
    /** Everyone who damaged the victim in this window shares the reward by damage. */
    assistWindowSec: 10,
    /** A small flat reward so even a kill of a brand-new ship gives something. */
    minReward: 6,
  },

  /** Money (no score) per point of damage dealt to the enemy carrier. */
  carrier: { perDamage: 0.25 },

  /** Things floating in the sea. Values are multiplied by the zone factor of where they are. */
  pickups: {
    crate: { cash: 10, target: 60, respawnSec: 25 },
    /**
     * Explosive barrels: a ship that touches one or a shot that hits one sets it off. Every ship
     * within `radius` (measured from its hull) takes `damage`, less toward the edge (`edgeFactor`
     * at the rim). Barrels close by go off with it.
     */
    barrel: {
      target: 25,
      respawnSec: 25,
      /** Size of the barrel as a target (shots and hulls). */
      hitRadius: 1.4,
      blast: { radius: 15, damage: 90, edgeFactor: 0.3 },
    },
    chest: { cash: 100, target: 5, respawnSec: 90 },
    /** Piles and loot crates dropped by sunk ships and pirates: capacity of the pool. */
    banknoteCapacity: 64,
    /** Multipliers by region: inner (dangerous), middle, outer (safe). */
    zoneMul: { inner: 2.5, middle: 1.5, outer: 1 },
    /** A ship collects what is within its hit radius plus this. */
    collectMargin: 1.5,
    /** New pickups appear at least this far from every living ship. */
    minSpawnDistance: 50,
    /** Each carrier has a few crates close by so a new player gets a first reward within seconds. */
    starter: { crates: 6, minDist: 26, maxDist: 55 },
    /** Chests sit this far off the shore of treasure/fort islands. */
    chestShoreMin: 6,
    chestShoreMax: 14,
  },
} as const;

/** Number of pickup slots: crates + the carriers' starter crates + barrels + chests + loot piles. */
export const PICKUP_CAPACITY =
  ECONOMY.pickups.crate.target +
  ECONOMY.pickups.starter.crates * TEAM_COUNT +
  ECONOMY.pickups.barrel.target +
  ECONOMY.pickups.chest.target +
  ECONOMY.pickups.banknoteCapacity;
