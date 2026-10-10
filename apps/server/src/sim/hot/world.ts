import {
  CARRIER,
  COMBAT,
  DEG2RAD,
  ECONOMY,
  END_REASON,
  EventWriter,
  KIND,
  MATCH,
  MATCH_STATE,
  MAX_PROJECTILES,
  Mulberry32,
  NO_TEAM,
  NO_WEAPON,
  PICKUP_ID_BASE,
  ProjectileSet,
  SHIPS,
  SHIP_IDS,
  STAT,
  STAT_COUNT,
  STEP_SEC,
  TEAM_BLUE,
  TEAM_COUNT,
  TIER_SHIPS,
  applyWorldBounds,
  canTierUp,
  collideIslands,
  createCombatant,
  generateMap,
  killReward,
  regenHull,
  regenShield,
  reloadMul,
  resetShipState,
  resolveCollisions,
  segmentVsWorld,
  shieldMul,
  speedMul,
  statCap,
  statCost,
  stepShip,
  tierOf,
  turnMul,
  updateCarrier,
  updateMounts,
} from '@tidebreaker/shared';
import { Pickups } from './pickups.ts';
import type {
  CollisionSink,
  Combatant,
  HitSink,
  IslandSink,
  Obstacles,
  ProjectileSink,
  WorldMap,
} from '@tidebreaker/shared';

/** Slots 0 and 1 are the carriers, then one slot per player. Entity id = slot + 1. */
export const CARRIER_SLOTS = TEAM_COUNT;
const DIED_CAPACITY = 64;
const KIND_BARREL = KIND.BARREL;
/** Combat age of a player who has not fought lately (seconds). */
const PEACEFUL = 1e6;

/**
 * The authoritative game world of one room (GAME_DESIGN.md §4.5, §11.2). Plain data in typed
 * arrays and one `step(dt)` that follows the documented tick order. This file lives in `hot/`, so
 * ESLint forbids allocation here: no literals, closures or array methods that create arrays.
 *
 * The room (network side) feeds inputs into `in*` arrays before each tick and reads `events`,
 * `diedVictim/diedKiller`, `respawned` and `matchChanged` after it.
 */
export class World implements HitSink, ProjectileSink, CollisionSink, IslandSink, Obstacles {
  readonly land: WorldMap;
  readonly maxPlayers: number;
  readonly slotCount: number;
  /** Every slot's combatant (used or not). */
  readonly slots: Combatant[] = new Array<Combatant>();
  /** The combatants currently in the world (carriers + joined players), in a stable order. */
  readonly combatants: Combatant[] = new Array<Combatant>();
  readonly used: Uint8Array;
  readonly shipIdx: Uint8Array;
  readonly lastSeq: Uint16Array;
  readonly inSteer: Float32Array;
  readonly inThrottle: Float32Array;
  readonly inAim: Float32Array;
  readonly inAimDist: Float32Array;
  readonly inFire: Uint8Array;
  /** Seconds until a sunk player returns (0 = alive or not waiting). */
  readonly respawnLeft: Float32Array;
  readonly protectLeft: Float32Array;
  /** Set on every (re)spawn; the room sends JOINED and clears it. */
  readonly respawned: Uint8Array;
  /** Counts spawns of a slot, so clients re-create the ship instead of interpolating the jump. */
  readonly spawnGen: Uint16Array;
  readonly kills: Uint16Array;
  readonly deaths: Uint16Array;
  /** Seconds since the player last hit someone or was hit (combat-log protection). */
  readonly combatAge: Float32Array;
  /** A player who dropped out while fighting: seconds their ship still drifts in the water. */
  readonly ghostLeft: Float32Array;
  /** Score (gates class jumps), spendable money, tier index (0 = T1) and upgrade levels per slot. */
  readonly score: Uint32Array;
  readonly cash: Uint32Array;
  readonly tier: Uint8Array;
  readonly levels: Uint8Array;
  /** 1 = this player's STATS message must be sent. */
  readonly statsDirty: Uint8Array;
  /** 1 = a ship changed class in place (tier-up): clients re-create it. */
  readonly pickups: Pickups;
  /** Damage each player recently did to each victim, and how long ago (assist rewards). */
  private readonly assistDmg: Float32Array;
  private readonly assistAge: Float32Array;
  /** How often a killer sank a victim lately, and how long ago (repeat-kill reward cut). */
  private readonly pairKills: Uint8Array;
  private readonly pairAge: Float32Array;
  /** Fractions of carrier-damage reward not yet paid out. */
  private readonly carrierCarry: Float32Array;
  readonly teamKills: Uint16Array = new Uint16Array(TEAM_COUNT);
  readonly projectiles = new ProjectileSet(MAX_PROJECTILES);
  readonly events = new EventWriter();
  /** Who died this tick (and who killed them), for YOU_DIED messages. */
  readonly diedVictim = new Uint16Array(DIED_CAPACITY);
  readonly diedKiller = new Uint16Array(DIED_CAPACITY);
  diedCount = 0;
  /** Who sank whom this tick (kill feed): killer id, victim id, weapon index or NO_WEAPON. */
  readonly feedKiller = new Uint16Array(DIED_CAPACITY);
  readonly feedVictim = new Uint16Array(DIED_CAPACITY);
  readonly feedWeapon = new Uint8Array(DIED_CAPACITY);
  feedCount = 0;
  /** The scoreboard changed (kills, deaths, players coming or going). */
  scoresDirty = true;
  matchState: number = MATCH_STATE.PLAYING;
  winner = NO_TEAM;
  restartLeft = 0;
  matchChanged = false;
  tick = 0;

  private readonly rng: Mulberry32;
  private readonly savedHull: Float32Array;
  private readonly savedShield: Float32Array;
  private readonly spawn2 = new Float32Array(3);

  constructor(seed: number) {
    this.land = generateMap(seed);
    this.rng = new Mulberry32(seed ^ 0x9e3779b9);
    this.maxPlayers = MATCH.maxPlayers;
    this.slotCount = CARRIER_SLOTS + this.maxPlayers;
    const n = this.slotCount;
    this.used = new Uint8Array(n);
    this.shipIdx = new Uint8Array(n);
    this.lastSeq = new Uint16Array(n);
    this.inSteer = new Float32Array(n);
    this.inThrottle = new Float32Array(n);
    this.inAim = new Float32Array(n);
    this.inAimDist = new Float32Array(n);
    this.inFire = new Uint8Array(n);
    this.respawnLeft = new Float32Array(n);
    this.protectLeft = new Float32Array(n);
    this.respawned = new Uint8Array(n);
    this.spawnGen = new Uint16Array(n);
    this.kills = new Uint16Array(n);
    this.deaths = new Uint16Array(n);
    this.combatAge = new Float32Array(n).fill(PEACEFUL);
    this.ghostLeft = new Float32Array(n);
    this.score = new Uint32Array(n);
    this.cash = new Uint32Array(n);
    this.tier = new Uint8Array(n);
    this.levels = new Uint8Array(n * STAT_COUNT);
    this.statsDirty = new Uint8Array(n);
    this.assistDmg = new Float32Array(n * n);
    this.assistAge = new Float32Array(n * n).fill(PEACEFUL);
    this.pairKills = new Uint8Array(n * n);
    this.pairAge = new Float32Array(n * n).fill(PEACEFUL);
    this.carrierCarry = new Float32Array(n);
    this.savedHull = new Float32Array(n);
    this.savedShield = new Float32Array(n);

    // Every state gets room for the largest mount list, so a slot can change class freely.
    let maxMounts = CARRIER.mounts.length;
    for (let i = 0; i < SHIP_IDS.length; i++) {
      maxMounts = Math.max(maxMounts, SHIPS[SHIP_IDS[i]!].mounts.length);
    }
    for (let i = 0; i < n; i++) {
      const c = createCombatant(i + 1, SHIPS[SHIP_IDS[0]!], NO_TEAM);
      c.state.mountCooldown = new Float32Array(maxMounts);
      this.slots.push(c);
    }
    this.pickups = new Pickups(this.land, seed);
    this.startRound();
  }

  // ---- progress (GAME_DESIGN.md §6)

  level(slot: number, stat: number): number {
    return this.levels[slot * STAT_COUNT + stat]!;
  }

  /** Full shield of a ship: its class value, raised by the shield upgrade. */
  maxShieldOf(slot: number): number {
    const def = this.slots[slot]!.def;
    return slot < CARRIER_SLOTS
      ? def.shield
      : def.shield * shieldMul(this.level(slot, STAT.SHIELD));
  }

  /** Score and money for a player (both grow by the same amount). */
  private gain(slot: number, amount: number): void {
    if (slot < CARRIER_SLOTS || this.used[slot] === 0 || !(amount > 0)) return;
    this.score[slot] = this.score[slot]! + amount;
    this.cash[slot] = this.cash[slot]! + amount;
    this.statsDirty[slot] = 1;
    this.scoresDirty = true;
  }

  /** Spends money on one stat. Returns false when the request is not allowed. */
  upgrade(slot: number, stat: number): boolean {
    if (slot < CARRIER_SLOTS || this.used[slot] === 0 || !(stat >= 0 && stat < STAT_COUNT))
      return false;
    if (!this.slots[slot]!.state.alive || this.ghostLeft[slot]! > 0) return false;
    const level = this.level(slot, stat);
    if (level >= statCap(this.tier[slot]!)) return false;
    const cost = statCost(level);
    if (this.cash[slot]! < cost) return false;
    const before = this.maxShieldOf(slot);
    this.cash[slot] = this.cash[slot]! - cost;
    this.levels[slot * STAT_COUNT + stat] = level + 1;
    if (stat === STAT.SHIELD) {
      // The new shield capacity arrives filled.
      const s = this.slots[slot]!.state;
      s.shield += this.maxShieldOf(slot) - before;
    }
    this.statsDirty[slot] = 1;
    return true;
  }

  /** Moves a player up one class (their score must allow it). Keeps position, speed and health share. */
  tierUp(slot: number): boolean {
    if (slot < CARRIER_SLOTS || this.used[slot] === 0) return false;
    const c = this.slots[slot]!;
    if (!c.state.alive || this.ghostLeft[slot]! > 0) return false;
    if (!canTierUp(this.tier[slot]!, this.score[slot]!)) return false;
    const hullShare = c.state.hull / c.def.hull;
    this.tier[slot] = this.tier[slot]! + 1;
    // Upgrades belong to the ship class: a new class starts without them (the money stays).
    this.levels.fill(0, slot * STAT_COUNT, (slot + 1) * STAT_COUNT);
    this.shipIdx[slot] = SHIP_IDS.indexOf(TIER_SHIPS[this.tier[slot]!]!);
    c.def = SHIPS[SHIP_IDS[this.shipIdx[slot]!]!];
    c.state.mountCooldown.fill(0);
    c.state.salvoCooldown = 0;
    c.state.hull = c.def.hull * hullShare;
    c.state.shield = this.maxShieldOf(slot);
    this.spawnGen[slot] = this.spawnGen[slot]! + 1;
    this.statsDirty[slot] = 1;
    this.scoresDirty = true;
    return true;
  }

  // ---- joining and leaving (called by the room, between ticks)

  /** Puts a new player into the world on `team`. Returns the slot, or -1 when the room is full. */
  addPlayer(team: number, shipIdx: number): number {
    for (let i = CARRIER_SLOTS; i < this.slotCount; i++) {
      if (this.used[i] === 1) continue;
      this.used[i] = 1;
      this.slots[i]!.team = team;
      this.shipIdx[i] = shipIdx;
      this.kills[i] = 0;
      this.deaths[i] = 0;
      this.ghostLeft[i] = 0;
      this.resetProgress(i, shipIdx);
      this.lastSeq[i] = 0;
      this.inSteer[i] = 0;
      this.inThrottle[i] = 0;
      this.inFire[i] = 0;
      this.combatants.push(this.slots[i]!);
      this.respawn(i);
      this.scoresDirty = true;
      return i;
    }
    return -1;
  }

  /**
   * A player's connection is gone. Someone who was fighting a moment ago (combat-log protection,
   * GAME_DESIGN.md §3) leaves their ship in the water, drifting without control, so dropping out
   * is no escape; everyone else disappears at once.
   */
  removePlayer(slot: number): void {
    if (this.used[slot] === 0) return;
    const c = this.slots[slot]!;
    if (c.state.alive && this.combatAge[slot]! < COMBAT.combatLogSec) {
      this.ghostLeft[slot] = COMBAT.combatLogDriftSec;
      this.inSteer[slot] = 0;
      this.inThrottle[slot] = 0;
      this.inFire[slot] = 0;
      return;
    }
    this.release(slot);
  }

  /** Frees a player slot for good. */
  private release(slot: number): void {
    this.used[slot] = 0;
    this.ghostLeft[slot] = 0;
    this.scoresDirty = true;
    this.respawned[slot] = 0;
    this.slots[slot]!.state.alive = false;
    const at = this.combatants.indexOf(this.slots[slot]!);
    if (at >= 0) this.combatants.splice(at, 1);
  }

  /** Number of players per team. */
  playersOnTeam(team: number): number {
    let n = 0;
    for (let i = CARRIER_SLOTS; i < this.slotCount; i++) {
      if (this.used[i] === 1 && this.slots[i]!.team === team) n++;
    }
    return n;
  }

  playerCount(): number {
    let n = 0;
    for (let i = CARRIER_SLOTS; i < this.slotCount; i++) n += this.used[i]!;
    return n;
  }

  /** Starts a player's progress over at the tier of class `shipIdx` (T1 unless testing). */
  private resetProgress(slot: number, shipIdx: number): void {
    this.shipIdx[slot] = shipIdx;
    this.tier[slot] = tierOf(SHIPS[SHIP_IDS[shipIdx]!]!);
    this.score[slot] = ECONOMY.tierScore[this.tier[slot]!]!;
    this.cash[slot] = 0;
    this.levels.fill(0, slot * STAT_COUNT, (slot + 1) * STAT_COUNT);
    this.carrierCarry[slot] = 0;
    this.statsDirty[slot] = 1;
  }

  /** Test builds only: a player picks a class; progress starts over at that tier. */
  changeShip(slot: number, shipIdx: number): void {
    this.resetProgress(slot, shipIdx);
    this.scoresDirty = true;
    this.respawn(slot);
  }

  /** (Re)spawns a player at their carrier, facing the enemy, with a few seconds of protection. */
  respawn(slot: number): void {
    const c = this.slots[slot]!;
    const def = SHIPS[SHIP_IDS[this.shipIdx[slot]!]!];
    c.def = def;
    this.pickSpawn(c.team, slot, this.spawn2);
    resetShipState(c.state, def, this.spawn2[0]!, this.spawn2[1]!, this.spawn2[2]!);
    c.state.shield = this.maxShieldOf(slot);
    this.statsDirty[slot] = 1;
    for (let k = 0; k < this.slotCount; k++) this.assistAge[slot * this.slotCount + k] = PEACEFUL;
    this.respawnLeft[slot] = 0;
    this.protectLeft[slot] = MATCH.spawnProtectSec;
    this.combatAge[slot] = PEACEFUL;
    this.inSteer[slot] = 0;
    this.inThrottle[slot] = 0;
    this.inFire[slot] = 0;
    this.respawned[slot] = 1;
    this.spawnGen[slot] = this.spawnGen[slot]! + 1;
  }

  /**
   * Chooses where `team` spawns: candidates on a ring around its carrier, on the side facing the
   * enemy; the one farthest from every other ship wins. Writes x, y and heading into `out`.
   */
  private pickSpawn(team: number, except: number, out: Float32Array): void {
    const base = MATCH.carriers[team]!;
    const enemy = MATCH.carriers[team === TEAM_BLUE ? 1 : 0]!;
    const toEnemy = Math.atan2(enemy.y - base.y, enemy.x - base.x);
    const spread = MATCH.spawnSpreadDeg * DEG2RAD;
    let bestScore = -1;
    for (let k = 0; k < MATCH.spawnCandidates; k++) {
      const f = MATCH.spawnCandidates > 1 ? (k / (MATCH.spawnCandidates - 1)) * 2 - 1 : 0;
      const a = toEnemy + f * spread;
      const x = base.x + Math.cos(a) * MATCH.spawnRadius;
      const y = base.y + Math.sin(a) * MATCH.spawnRadius;
      let nearest = 1e9;
      for (let j = 0; j < this.combatants.length; j++) {
        const o = this.combatants[j]!;
        if (o.id - 1 === except || !o.state.alive) continue;
        nearest = Math.min(nearest, Math.hypot(o.state.x - x, o.state.y - y));
      }
      // A little noise so equal scores do not always pick the same point.
      const score = nearest + this.rng.next() * 0.5;
      if (score > bestScore) {
        bestScore = score;
        out[0] = x;
        out[1] = y;
        out[2] = toEnemy;
      }
    }
  }

  /** Sets up a fresh round: carriers at full strength, everyone back at their carrier. */
  startRound(): void {
    this.matchState = MATCH_STATE.PLAYING;
    this.winner = NO_TEAM;
    this.restartLeft = 0;
    this.matchChanged = true;
    this.teamKills.fill(0);
    this.kills.fill(0);
    this.deaths.fill(0);
    this.scoresDirty = true;
    this.projectiles.clear();
    for (let t = 0; t < TEAM_COUNT; t++) {
      const b = MATCH.carriers[t]!;
      const c = this.slots[t]!;
      c.def = CARRIER;
      c.team = b.team;
      resetShipState(c.state, CARRIER, b.x, b.y, b.heading);
      this.used[t] = 1;
      if (this.combatants.indexOf(c) < 0) this.combatants.unshift(c);
    }
    for (let i = CARRIER_SLOTS; i < this.slotCount; i++) {
      if (this.used[i] === 0) continue;
      if (this.ghostLeft[i]! > 0) this.release(i);
      else {
        // A new round: everyone starts again as a T1 ship with nothing.
        this.resetProgress(i, 0);
        this.respawn(i);
      }
    }
    this.pairKills.fill(0);
    this.pickups.reset(this.combatants);
  }

  // ---- one tick (GAME_DESIGN.md §11.2)

  /**
   * Moves one player's ship by exactly one step with one input (tick order 1). The room calls this
   * once per input it takes from the player's queue, so the ship's simulation advances input by
   * input: the client can replay exactly the inputs the server has not seen yet. Dead ships and
   * carriers do not move.
   */
  moveShip(slot: number, steer: number, throttle: number): void {
    if (slot < CARRIER_SLOTS || this.used[slot] === 0) return;
    const c = this.slots[slot]!;
    if (!c.state.alive) return;
    const speed = speedMul(this.level(slot, STAT.SPEED));
    const turn = turnMul(this.level(slot, STAT.TURN));
    stepShip(
      c.state,
      steer,
      throttle,
      c.def.vMax * speed,
      c.def.turnRateDeg * DEG2RAD * turn,
      STEP_SEC,
    );
  }

  step(): void {
    const dt = STEP_SEC;
    this.tick++;
    this.events.begin(this.tick);
    this.diedCount = 0;
    this.feedCount = 0;
    const ended = this.matchState === MATCH_STATE.ENDED;

    // Players whose connection dropped in the middle of a fight keep drifting, uncontrolled.
    for (let i = CARRIER_SLOTS; i < this.slotCount; i++) {
      if (this.ghostLeft[i]! > 0) this.moveShip(i, 0, 0);
    }

    // 4. collisions: ships, islands and reefs, world edge. Protected ships take no damage.
    this.saveProtected();
    resolveCollisions(this.combatants, this);
    this.restoreProtected();
    for (let i = CARRIER_SLOTS; i < this.slotCount; i++) {
      if (this.used[i] === 0) continue;
      const c = this.slots[i]!;
      if (!c.state.alive) continue;
      collideIslands(this.land, c.state, c.def, c.id, this);
      applyWorldBounds(c.state, dt);
    }

    // 5. mounts (a finished round holds its fire)
    for (let i = CARRIER_SLOTS; i < this.slotCount; i++) {
      if (this.used[i] === 0) continue;
      const c = this.slots[i]!;
      const fire = !ended && this.inFire[i] === 1;
      const shots = updateMounts(
        c.state,
        c.def,
        c.id,
        this.inAim[i]!,
        fire,
        dt,
        this.rng,
        this,
        this.inAimDist[i]!,
        reloadMul(this.level(i, STAT.RELOAD)),
      );
      // The first shot ends the spawn protection: no sniping from safety.
      if (shots > 0) this.protectLeft[i] = 0;
    }
    for (let t = 0; t < CARRIER_SLOTS; t++) {
      const c = this.slots[t]!;
      if (ended) {
        // Tick the cooldowns only, no shots.
        updateCarrier(c, this.noTargets, dt, this.rng, this);
      } else {
        updateCarrier(c, this.combatants, dt, this.rng, this);
      }
    }

    // 5b. pickups: ships that touch something take it
    this.collectPickups();
    this.pickups.step(dt, this.combatants);

    // 6. projectiles and hits
    this.saveProtected();
    this.projectiles.step(dt, this.combatants, this, this);
    this.restoreProtected();

    for (let i = 0; i < this.assistAge.length; i++) {
      this.assistAge[i] = Math.min(PEACEFUL, this.assistAge[i]! + dt);
      this.pairAge[i] = Math.min(PEACEFUL, this.pairAge[i]! + dt);
    }

    // 7. shields recharge once a ship has been left alone for a while
    for (let i = 0; i < this.slotCount; i++) {
      if (this.used[i] === 0) continue;
      const c = this.slots[i]!;
      if (i < CARRIER_SLOTS) {
        regenShield(
          c.state,
          c.def.shield,
          COMBAT.carrierShieldDelaySec,
          COMBAT.carrierShieldRechargeSec,
          dt,
        );
      } else {
        regenShield(
          c.state,
          this.maxShieldOf(i),
          COMBAT.shieldDelaySec,
          COMBAT.shieldRechargeSec,
          dt,
        );
        regenHull(
          c.state,
          c.def.hull,
          COMBAT.hullRegenDelaySec,
          COMBAT.hullRegenPctPerSec + this.level(i, STAT.REGEN) * COMBAT.hullRegenUpgradePctPerSec,
          dt,
        );
        this.combatAge[i] = Math.min(PEACEFUL, this.combatAge[i]! + dt);
      }
    }

    // 8. timers: respawn countdown, spawn protection, round restart, drifting ships
    for (let i = CARRIER_SLOTS; i < this.slotCount; i++) {
      if (this.used[i] === 0) continue;
      if (this.ghostLeft[i]! > 0) {
        this.ghostLeft[i] = this.ghostLeft[i]! - dt;
        if (this.ghostLeft[i]! <= 0 || !this.slots[i]!.state.alive) this.release(i);
        continue;
      }
      if (this.protectLeft[i]! > 0) this.protectLeft[i] = Math.max(0, this.protectLeft[i]! - dt);
      if (!this.slots[i]!.state.alive && this.respawnLeft[i]! > 0) {
        this.respawnLeft[i] = this.respawnLeft[i]! - dt;
        if (this.respawnLeft[i]! <= 0 && !ended) this.respawn(i);
      }
    }
    if (ended) {
      this.restartLeft -= dt;
      if (this.restartLeft <= 0) this.startRound();
    }
  }

  /** Empty target list: lets a carrier tick its cooldowns without ever finding an enemy. */
  private readonly noTargets: Combatant[] = new Array<Combatant>();

  private saveProtected(): void {
    for (let i = CARRIER_SLOTS; i < this.slotCount; i++) {
      this.savedHull[i] = this.slots[i]!.state.hull;
      this.savedShield[i] = this.slots[i]!.state.shield;
    }
  }

  private restoreProtected(): void {
    for (let i = CARRIER_SLOTS; i < this.slotCount; i++) {
      if (this.used[i] === 0 || this.protectLeft[i]! <= 0) continue;
      const s = this.slots[i]!.state;
      s.hull = this.savedHull[i]!;
      s.shield = this.savedShield[i]!;
      s.alive = true;
    }
  }

  // ---- results of the simulation (sinks)

  /** Mounts spawn shots here: the projectile joins the set and the clients are told. */
  spawn(
    x: number,
    y: number,
    angle: number,
    speed: number,
    range: number,
    radius: number,
    damage: number,
    ownerId: number,
    weaponIdx: number,
  ): void {
    const team = this.slots[ownerId - 1]!.team;
    const id = this.projectiles.spawn(
      x,
      y,
      angle,
      speed,
      range,
      radius,
      damage,
      ownerId,
      weaponIdx,
      team,
    );
    this.events.projectileSpawn(id, ownerId, weaponIdx, x, y, angle);
  }

  onHit(
    ownerId: number,
    targetId: number,
    x: number,
    y: number,
    damage: number,
    shieldHit: boolean,
    killed: boolean,
    weaponIdx: number,
    slot: number,
  ): void {
    this.events.projectileEnd(slot, END_REASON.HIT_SHIP, x, y);
    const target = targetId - 1;
    if (this.protectLeft[target]! > 0) {
      // Absorbed by the spawn protection: sparks on the shield, no damage.
      this.events.shipHit(targetId, ownerId, 0, true, weaponIdx, x, y);
      return;
    }
    this.events.shipHit(targetId, ownerId, damage, shieldHit, weaponIdx, x, y);
    this.noteDamage(ownerId - 1, target, damage);
    if (target >= CARRIER_SLOTS) this.combatAge[target] = 0;
    if (ownerId - 1 >= CARRIER_SLOTS) this.combatAge[ownerId - 1] = 0;
    if (killed) this.sunk(target, ownerId, x, y, weaponIdx);
  }

  onExpire(x: number, y: number, _weaponIdx: number, slot: number): void {
    this.events.projectileEnd(slot, END_REASON.EXPIRED, x, y);
  }

  onBlocked(x: number, y: number, _weaponIdx: number, slot: number): void {
    this.events.projectileEnd(slot, END_REASON.HIT_ISLAND, x, y);
  }

  onCollision(
    aId: number,
    bId: number,
    x: number,
    y: number,
    impact: number,
    _damageA: number,
    _damageB: number,
    killedA: boolean,
    killedB: boolean,
  ): void {
    this.events.bump(aId, bId, x, y, impact);
    if (killedA && this.protectLeft[aId - 1]! <= 0) this.sunk(aId - 1, bId, x, y, NO_WEAPON);
    if (killedB && this.protectLeft[bId - 1]! <= 0) this.sunk(bId - 1, aId, x, y, NO_WEAPON);
  }

  onIslandHit(shipId: number, x: number, y: number, impact: number): void {
    this.events.bump(shipId, 0xffff, x, y, impact);
  }

  segmentHit(x0: number, y0: number, x1: number, y1: number): number {
    return segmentVsWorld(this.land, x0, y0, x1, y1);
  }

  /** A ship went down: tell everyone, count the kill, and end the round if it was a carrier. */
  private sunk(victim: number, killerId: number, x: number, y: number, weapon: number): void {
    const v = this.slots[victim]!;
    this.events.shipSunk(v.id, killerId, x, y);
    if (victim < CARRIER_SLOTS) {
      if (this.matchState === MATCH_STATE.PLAYING) {
        this.matchState = MATCH_STATE.ENDED;
        this.winner = v.team === TEAM_BLUE ? 1 : 0;
        this.restartLeft = MATCH.intermissionSec;
        this.matchChanged = true;
      }
      return;
    }
    this.respawnLeft[victim] = MATCH.respawnSec;
    this.inFire[victim] = 0;
    this.deaths[victim] = this.deaths[victim]! + 1;
    this.scoresDirty = true;
    if (this.feedCount < DIED_CAPACITY) {
      this.feedKiller[this.feedCount] = killerId;
      this.feedVictim[this.feedCount] = v.id;
      this.feedWeapon[this.feedCount] = weapon;
      this.feedCount++;
    }
    if (this.diedCount < DIED_CAPACITY) {
      this.diedVictim[this.diedCount] = v.id;
      this.diedKiller[this.diedCount] = killerId;
      this.diedCount++;
    }
    this.settleDeath(victim, killerId, x, y);
    const killer = killerId > 0 ? this.slots[killerId - 1] : undefined;
    if (killer && killer.team !== NO_TEAM && killer.team !== v.team) {
      if (killerId - 1 >= CARRIER_SLOTS) this.kills[killerId - 1] = this.kills[killerId - 1]! + 1;
      this.teamKills[killer.team] = this.teamKills[killer.team]! + 1;
      this.matchChanged = true;
    }
  }

  // ---- money: damage credit, kill rewards, loot, pickups

  /** Remembers who damaged whom (assists) and pays for damage done to the enemy carrier. */
  private noteDamage(attacker: number, target: number, damage: number): void {
    if (attacker < CARRIER_SLOTS || attacker >= this.slotCount) return;
    if (target < CARRIER_SLOTS) {
      // Hurting the enemy carrier is the point of the game: it pays a little per damage point.
      const owed = this.carrierCarry[attacker]! + damage * ECONOMY.carrier.perDamage;
      const whole = Math.floor(owed);
      this.carrierCarry[attacker] = owed - whole;
      this.gain(attacker, whole);
      return;
    }
    const at = target * this.slotCount + attacker;
    if (this.assistAge[at]! > ECONOMY.kill.assistWindowSec) this.assistDmg[at] = 0;
    this.assistDmg[at] = this.assistDmg[at]! + damage;
    this.assistAge[at] = 0;
  }

  /** A player ship went down: pay the attackers, scatter the money, and drop a class. */
  private settleDeath(victim: number, killerId: number, x: number, y: number): void {
    const n = this.slotCount;
    const v = this.slots[victim]!;
    const killerSlot = killerId - 1;
    const killerIsPlayer = killerSlot >= CARRIER_SLOTS && killerSlot < n;
    if (killerIsPlayer && this.slots[killerSlot]!.team === v.team) return this.demote(victim, x, y);
    const killerTier = killerIsPlayer ? this.tier[killerSlot]! : this.tier[victim]!;
    let repeats = 0;
    if (killerIsPlayer) {
      const pair = victim * n + killerSlot;
      repeats = this.pairAge[pair]! < ECONOMY.kill.repeatWindowSec ? this.pairKills[pair]! : 0;
      this.pairKills[pair] = Math.min(255, repeats + 1);
      this.pairAge[pair] = 0;
    }
    const reward = killReward(this.score[victim]!, this.tier[victim]!, killerTier, repeats);
    // Everyone who hurt the victim lately shares the reward by damage; a collision gives it all
    // to the killer.
    let total = 0;
    for (let a = CARRIER_SLOTS; a < n; a++) {
      if (this.assistAge[victim * n + a]! <= ECONOMY.kill.assistWindowSec) {
        total += this.assistDmg[victim * n + a]!;
      }
    }
    if (total > 0) {
      for (let a = CARRIER_SLOTS; a < n; a++) {
        if (this.assistAge[victim * n + a]! > ECONOMY.kill.assistWindowSec) continue;
        this.gain(a, Math.round((reward * this.assistDmg[victim * n + a]!) / total));
      }
    } else if (killerIsPlayer) {
      this.gain(killerSlot, reward);
    }
    this.demote(victim, x, y);
  }

  /** The loser's money floats away as banknote piles; the loser drops a class (never below T1). */
  private demote(victim: number, x: number, y: number): void {
    const D = ECONOMY.death;
    const cash = this.cash[victim]!;
    const piles = Math.min(D.lootPiles, Math.floor(cash / D.lootMinPile));
    let left = cash;
    for (let p = 0; p < piles; p++) {
      const value = p === piles - 1 ? left : Math.floor(cash / piles);
      left -= value;
      const a = this.rng.next() * Math.PI * 2;
      const d = this.rng.next() * D.lootSpread;
      this.pickups.dropBanknote(x + Math.cos(a) * d, y + Math.sin(a) * d, value);
    }
    this.cash[victim] = 0;
    const before = this.tier[victim]!;
    const tier = Math.max(0, before - D.tierLoss);
    this.tier[victim] = tier;
    this.score[victim] = ECONOMY.tierScore[tier]!;
    this.shipIdx[victim] = SHIP_IDS.indexOf(TIER_SHIPS[tier]!);
    // The lower class has its own upgrades: they start from nothing. (A T1 ship stays T1 and
    // keeps what it bought.)
    if (tier !== before) this.levels.fill(0, victim * STAT_COUNT, (victim + 1) * STAT_COUNT);
    this.statsDirty[victim] = 1;
    this.scoresDirty = true;
  }

  /** Every living player ship takes the pickups it touches. */
  private collectPickups(): void {
    const p = this.pickups;
    const margin = ECONOMY.pickups.collectMargin;
    for (let s = CARRIER_SLOTS; s < this.slotCount; s++) {
      if (this.used[s] === 0 || this.ghostLeft[s]! > 0) continue;
      const c = this.slots[s]!;
      const st = c.state;
      if (!st.alive) continue;
      const cos = Math.cos(st.heading);
      const sin = Math.sin(st.heading);
      const circles = c.def.hitCircles;
      for (let i = 0; i < p.active.length; i++) {
        if (p.active[i] === 0) continue;
        let touched = false;
        for (let k = 0; k < circles.length && !touched; k++) {
          const circle = circles[k]!;
          const dx = p.x[i]! - (st.x + cos * circle.offset);
          const dy = p.y[i]! - (st.y + sin * circle.offset);
          const reach = circle.radius + margin;
          touched = dx * dx + dy * dy < reach * reach;
        }
        if (!touched) continue;
        const value = p.value[i]!;
        this.events.pickup(PICKUP_ID_BASE + i, s + 1, p.kind[i]!, value, p.x[i]!, p.y[i]!);
        this.gain(s, value);
        if (p.kind[i] === KIND_BARREL && this.rng.next() < ECONOMY.pickups.barrel.repairChance) {
          st.hull = Math.min(c.def.hull, st.hull + c.def.hull * ECONOMY.pickups.barrel.repairPct);
        }
        p.take(i);
      }
    }
  }
}
