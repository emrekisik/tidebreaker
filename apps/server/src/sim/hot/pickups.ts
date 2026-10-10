import {
  ECONOMY,
  ISLAND_TYPES,
  KIND,
  MATCH,
  MAP,
  Mulberry32,
  PICKUP_CAPACITY,
  WORLD_CENTER,
  WORLD_SIZE,
  circleVsWorld,
  zoneMultiplier,
} from '@tidebreaker/shared';
import type { Combatant, WorldMap } from '@tidebreaker/shared';

/** Which slot range holds which kind (fixed layout, so ids and slots never move). */
const P = ECONOMY.pickups;
const STARTERS = P.starter.crates * MATCH.carriers.length;
export const CRATE_START = 0;
export const BARREL_START = CRATE_START + P.crate.target + STARTERS;
export const CHEST_START = BARREL_START + P.barrel.target;
export const NOTE_START = CHEST_START + P.chest.target;
export { PICKUP_CAPACITY };

/** A pickup needs this much open water around it, so a ship can reach it. */
const CLEARANCE = 6;
/** Pickups stay this far off a carrier hull. */
const HULL_MARGIN = 6;
const SPAWN_TRIES = 14;
const EDGE = MAP.boundary.width + 25;

/**
 * Everything floating in the sea that a ship can pick up: crates, barrels, treasure chests and the
 * banknote piles of sunk ships (GAME_DESIGN.md §7.1). Plain data in typed arrays, one fixed slot
 * per pickup, so nothing is allocated while the game runs. Lives in `hot/`: no allocation here.
 *
 * Crates, barrels and chests respawn in their slot after a delay; banknote piles expire.
 */
export class Pickups {
  readonly active = new Uint8Array(PICKUP_CAPACITY);
  /** `KIND.CRATE`, `KIND.BARREL`, `KIND.CHEST` or `KIND.BANKNOTE` of each slot. */
  readonly kind = new Uint8Array(PICKUP_CAPACITY);
  readonly x = new Float32Array(PICKUP_CAPACITY);
  readonly y = new Float32Array(PICKUP_CAPACITY);
  /** Money (score and cash) a ship gets for it, zone multiplier included. */
  readonly value = new Uint16Array(PICKUP_CAPACITY);
  /** Counts spawns of a slot, so clients know when a slot holds a new pickup. */
  readonly gen = new Uint16Array(PICKUP_CAPACITY);
  /** Seconds until respawn (inactive slots) or until a banknote pile disappears. */
  private readonly timer = new Float32Array(PICKUP_CAPACITY);
  /** 0 = anywhere, 1 + team = a starter crate near that team's carrier. */
  private readonly home = new Uint8Array(PICKUP_CAPACITY);
  private readonly hit = new Float32Array(3);
  private readonly rng: Mulberry32;
  private readonly land: WorldMap;

  constructor(land: WorldMap, seed: number) {
    this.land = land;
    this.rng = new Mulberry32(seed ^ 0x51ed270b);
    for (let i = 0; i < PICKUP_CAPACITY; i++) {
      if (i < BARREL_START) this.kind[i] = KIND.CRATE;
      else if (i < CHEST_START) this.kind[i] = KIND.BARREL;
      else if (i < NOTE_START) this.kind[i] = KIND.CHEST;
      else this.kind[i] = KIND.BANKNOTE;
    }
    // The last crates of the crate range are the starters, grouped by team.
    const normal = P.crate.target;
    for (let i = normal; i < BARREL_START; i++) {
      this.home[i] = 1 + Math.floor((i - normal) / P.starter.crates);
    }
  }

  /** New round: every pickup is placed again and the loot piles are gone. */
  reset(ships: readonly Combatant[]): void {
    for (let i = 0; i < NOTE_START; i++) {
      this.active[i] = 0;
      this.timer[i] = 0;
      this.place(i, ships);
    }
    for (let i = NOTE_START; i < PICKUP_CAPACITY; i++) this.active[i] = 0;
  }

  /** Counts down respawns and loot lifetimes, and fills empty slots. */
  step(dt: number, ships: readonly Combatant[]): void {
    for (let i = 0; i < PICKUP_CAPACITY; i++) {
      if (i >= NOTE_START) {
        if (this.active[i] === 1) {
          this.timer[i] = this.timer[i]! - dt;
          if (this.timer[i]! <= 0) this.active[i] = 0;
        }
        continue;
      }
      if (this.active[i] === 1) continue;
      this.timer[i] = this.timer[i]! - dt;
      if (this.timer[i]! <= 0) this.place(i, ships);
    }
  }

  /** Takes a pickup (a ship got it). */
  take(i: number): void {
    this.active[i] = 0;
    if (i < NOTE_START) this.timer[i] = this.respawnDelay(i);
  }

  /** Drops a pile of banknotes worth `value` at (x, y). Returns false when the pool is full. */
  dropBanknote(x: number, y: number, value: number): boolean {
    for (let i = NOTE_START; i < PICKUP_CAPACITY; i++) {
      if (this.active[i] === 1) continue;
      this.active[i] = 1;
      this.x[i] = x;
      this.y[i] = y;
      this.value[i] = Math.min(65535, Math.round(value));
      this.timer[i] = ECONOMY.death.lootLifeSec;
      this.gen[i] = this.gen[i]! + 1;
      return true;
    }
    return false;
  }

  /** Size class 0..3 of a pile (for the look of banknotes) or the zone (0..2) of other pickups. */
  look(i: number): number {
    if (i >= NOTE_START) {
      const v = this.value[i]!;
      return v < 20 ? 0 : v < 60 ? 1 : v < 150 ? 2 : 3;
    }
    const d = Math.hypot(this.x[i]! - WORLD_CENTER, this.y[i]! - WORLD_CENTER);
    return d < MAP.regions.inner ? 2 : d < MAP.regions.outer ? 1 : 0;
  }

  private respawnDelay(i: number): number {
    return i < BARREL_START
      ? P.crate.respawnSec
      : i < CHEST_START
        ? P.barrel.respawnSec
        : P.chest.respawnSec;
  }

  /** Puts slot `i` somewhere valid; if no spot is found it tries again next tick. */
  private place(i: number, ships: readonly Combatant[]): void {
    const k = this.kind[i]!;
    for (let t = 0; t < SPAWN_TRIES; t++) {
      if (k === KIND.CHEST) {
        if (!this.pickChestSpot(i)) continue;
      } else if (this.home[i]! > 0) {
        if (!this.pickStarterSpot(i)) continue;
      } else {
        this.x[i] = EDGE + this.rng.next() * (WORLD_SIZE - 2 * EDGE);
        this.y[i] = EDGE + this.rng.next() * (WORLD_SIZE - 2 * EDGE);
      }
      if (!this.spotIsFree(this.x[i]!, this.y[i]!, this.home[i]! > 0, ships)) continue;
      const dist = Math.hypot(this.x[i]! - WORLD_CENTER, this.y[i]! - WORLD_CENTER);
      const base =
        k === KIND.CRATE ? P.crate.cash : k === KIND.BARREL ? P.barrel.cash : P.chest.cash;
      const mul = zoneMultiplier(dist, MAP.regions.inner, MAP.regions.outer);
      this.value[i] = Math.round(base * mul);
      this.active[i] = 1;
      this.gen[i] = this.gen[i]! + 1;
      return;
    }
    this.timer[i] = 0.5;
  }

  private pickStarterSpot(i: number): boolean {
    const team = this.home[i]! - 1;
    const base = MATCH.carriers[team]!;
    const towardEnemy = base.heading;
    const a = towardEnemy + (this.rng.next() * 2 - 1) * 1.2;
    const d = P.starter.minDist + this.rng.next() * (P.starter.maxDist - P.starter.minDist);
    this.x[i] = base.x + Math.cos(a) * d;
    this.y[i] = base.y + Math.sin(a) * d;
    return true;
  }

  /** A spot a few units off the shore of a treasure or fort island. */
  private pickChestSpot(i: number): boolean {
    const land = this.land;
    let n = 0;
    for (let j = 0; j < land.islandCount; j++) {
      const type = ISLAND_TYPES[land.islandType[j]!];
      if (type === 'treasure' || type === 'fort') n++;
    }
    if (n === 0) return false;
    let pick = Math.floor(this.rng.next() * n);
    for (let j = 0; j < land.islandCount; j++) {
      const type = ISLAND_TYPES[land.islandType[j]!];
      if (type !== 'treasure' && type !== 'fort') continue;
      if (pick-- > 0) continue;
      const a = this.rng.next() * Math.PI * 2;
      const d =
        land.islandR[j]! + P.chestShoreMin + this.rng.next() * (P.chestShoreMax - P.chestShoreMin);
      this.x[i] = land.islandX[j]! + Math.cos(a) * d;
      this.y[i] = land.islandY[j]! + Math.sin(a) * d;
      return true;
    }
    return false;
  }

  private spotIsFree(x: number, y: number, starter: boolean, ships: readonly Combatant[]): boolean {
    if (x < EDGE || y < EDGE || x > WORLD_SIZE - EDGE || y > WORLD_SIZE - EDGE) return false;
    if (circleVsWorld(this.land, x, y, CLEARANCE, this.hit)) return false;
    const minD2 = P.minSpawnDistance * P.minSpawnDistance;
    for (let j = 0; j < ships.length; j++) {
      const s = ships[j]!;
      if (!s.state.alive) continue;
      const dx = s.state.x - x;
      const dy = s.state.y - y;
      if (s.def.vMax === 0) {
        // A carrier cannot be sailed through: nothing may lie under or against its hull.
        const cos = Math.cos(s.state.heading);
        const sin = Math.sin(s.state.heading);
        const circles = s.def.hitCircles;
        for (let k = 0; k < circles.length; k++) {
          const c = circles[k]!;
          const cx = s.state.x + cos * c.offset - x;
          const cy = s.state.y + sin * c.offset - y;
          const reach = c.radius + HULL_MARGIN;
          if (cx * cx + cy * cy < reach * reach) return false;
        }
        // Starter crates sit close to the carrier on purpose: only the hull rule applies to them.
        if (starter) continue;
      }
      if (dx * dx + dy * dy < minD2) return false;
    }
    if (!starter) {
      // Keep the carriers' own neighborhood for the starter crates.
      for (let t = 0; t < MATCH.carriers.length; t++) {
        const b = MATCH.carriers[t]!;
        if (Math.hypot(b.x - x, b.y - y) < MAP.baseClear * 0.6) return false;
      }
    }
    return true;
  }
}
