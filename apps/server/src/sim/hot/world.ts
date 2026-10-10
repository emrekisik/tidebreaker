import {
  CARRIER,
  COMBAT,
  DEG2RAD,
  END_REASON,
  EventWriter,
  MATCH,
  MATCH_STATE,
  MAX_PROJECTILES,
  Mulberry32,
  NO_TEAM,
  NO_WEAPON,
  ProjectileSet,
  SHIPS,
  SHIP_IDS,
  STEP_SEC,
  TEAM_BLUE,
  TEAM_COUNT,
  applyWorldBounds,
  collideIslands,
  createCombatant,
  generateMap,
  regenHull,
  regenShield,
  resetShipState,
  resolveCollisions,
  segmentVsWorld,
  stepShip,
  updateCarrier,
  updateMounts,
} from '@tidebreaker/shared';
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
  /** Levels of the "health regen" upgrade (Phase 4); 0 until upgrades exist. */
  readonly regenLevel: Uint8Array;
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
    this.regenLevel = new Uint8Array(n);
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
    this.startRound();
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
      this.regenLevel[i] = 0;
      this.ghostLeft[i] = 0;
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

  /** Changes a player's ship class; they return at their carrier right away. */
  changeShip(slot: number, shipIdx: number): void {
    this.shipIdx[slot] = shipIdx;
    this.respawn(slot);
  }

  /** (Re)spawns a player at their carrier, facing the enemy, with a few seconds of protection. */
  respawn(slot: number): void {
    const c = this.slots[slot]!;
    const def = SHIPS[SHIP_IDS[this.shipIdx[slot]!]!];
    c.def = def;
    this.pickSpawn(c.team, slot, this.spawn2);
    resetShipState(c.state, def, this.spawn2[0]!, this.spawn2[1]!, this.spawn2[2]!);
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
      else this.respawn(i);
    }
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
    stepShip(c.state, steer, throttle, c.def.vMax, c.def.turnRateDeg * DEG2RAD, STEP_SEC);
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

    // 6. projectiles and hits
    this.saveProtected();
    this.projectiles.step(dt, this.combatants, this, this);
    this.restoreProtected();

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
        regenShield(c.state, c.def.shield, COMBAT.shieldDelaySec, COMBAT.shieldRechargeSec, dt);
        regenHull(
          c.state,
          c.def.hull,
          COMBAT.hullRegenDelaySec,
          COMBAT.hullRegenPctPerSec + this.regenLevel[i]! * COMBAT.hullRegenUpgradePctPerSec,
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
    const killer = killerId > 0 ? this.slots[killerId - 1] : undefined;
    if (killer && killer.team !== NO_TEAM && killer.team !== v.team) {
      if (killerId - 1 >= CARRIER_SLOTS) this.kills[killerId - 1] = this.kills[killerId - 1]! + 1;
      this.teamKills[killer.team] = this.teamKills[killer.team]! + 1;
      this.matchChanged = true;
    }
  }
}
