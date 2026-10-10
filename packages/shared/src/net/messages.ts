import { STAT_COUNT } from '../config/economy.ts';
import { PROTOCOL_VERSION } from '../config/net.ts';
import { Reader, Writer } from './buffer.ts';
import {
  dqAngle16,
  dqAngle8,
  dqFrac,
  dqPos,
  dqSpeed,
  qAngle16,
  qAngle8,
  qFrac,
  qPos,
  qSpeed,
} from './quant.ts';

/** Message types (GAME_DESIGN.md §10.2). */
export const C2S = {
  HELLO: 0x01,
  PLAY: 0x02,
  INPUT: 0x03,
  UPGRADE: 0x04,
  TIER_UP: 0x05,
  PING: 0x06,
} as const;
export const S2C = {
  WELCOME: 0x81,
  SNAPSHOT: 0x82,
  EVENTS: 0x83,
  YOU_DIED: 0x85,
  PONG: 0x86,
  REJECT: 0x87,
  JOINED: 0x8a,
  STATS: 0x88,
  MATCH: 0x8b,
  KILL: 0x8c,
  SCORES: 0x8d,
} as const;

/** `weapon` of a KILL that no weapon caused (a collision). */
export const NO_WEAPON = 0xff;

export const NAME_MAX_BYTES = 48;
/** Names as the room shows them (characters, after sanitizing). */
export const NAME_MAX_CHARS = 16;

export const REJECT_REASON = {
  VERSION: 1,
  ROOM_FULL: 2,
  BAD_NAME: 3,
  RATE: 4,
  BANNED: 5,
  CONFIG: 6,
} as const;

export const END_REASON = { HIT_SHIP: 0, HIT_ISLAND: 1, EXPIRED: 2 } as const;
export const EVENT = {
  PROJECTILE_SPAWN: 1,
  PROJECTILE_END: 2,
  SHIP_HIT: 3,
  SHIP_SUNK: 4,
  BUMP: 5,
  PICKUP: 6,
  POWER: 7,
} as const;
/** Entity kinds in snapshots (§10.3). */
export const KIND = { SHIP: 0, CRATE: 4, BARREL: 5, CHEST: 6, BANKNOTE: 7, CARRIER: 10 } as const;
/** Pickups get entity ids from here up; ships use 1 + slot. */
export const PICKUP_ID_BASE = 1000;
/** `otherId` of a BUMP event that hit an island or reef. */
export const BUMP_WORLD = 0xffff;

export const MATCH_STATE = { PLAYING: 0, ENDED: 1 } as const;

// ---------------------------------------------------------------------------------------------
// Client -> server

/** A decoded client message. One object is reused for every message of a connection. */
export interface ClientMsg {
  type: number;
  version: number;
  name: string;
  shipId: number;
  /** Which stat an UPGRADE asks for. */
  stat: number;
  seq: number;
  fire: boolean;
  moveX: number;
  moveY: number;
  aim: number;
  aimDist: number;
  clientTime: number;
}

export function newClientMsg(): ClientMsg {
  return {
    type: 0,
    version: 0,
    name: '',
    shipId: 0,
    stat: 0,
    seq: 0,
    fire: false,
    moveX: 0,
    moveY: 0,
    aim: 0,
    aimDist: 0,
    clientTime: 0,
  };
}

export function encodeHello(w: Writer): void {
  w.u8(C2S.HELLO);
  w.u8(PROTOCOL_VERSION);
}

export function encodePlay(w: Writer, name: string, shipId: number): void {
  w.u8(C2S.PLAY);
  w.string(name, NAME_MAX_BYTES);
  w.u8(shipId);
}

/** Spend money on one stat (the server checks money, cap and range). */
export function encodeUpgrade(w: Writer, stat: number): void {
  w.u8(C2S.UPGRADE);
  w.u8(stat);
}

/** Move up one class (the server checks the score). */
export function encodeTierUp(w: Writer, choice = 0): void {
  w.u8(C2S.TIER_UP);
  w.u8(choice);
}

export function encodePing(w: Writer, clientTime: number): void {
  w.u8(C2S.PING);
  w.u32(clientTime);
}

/** Control values on the wire: `moveX` = rudder, `moveY` = throttle (both -127..127), `aim` = u16 angle. */
export function encodeInput(
  w: Writer,
  seq: number,
  fire: boolean,
  moveX: number,
  moveY: number,
  aim: number,
  aimDist: number,
): void {
  w.u8(C2S.INPUT);
  w.u16(seq);
  w.u8(fire ? 1 : 0);
  w.i8(moveX);
  w.i8(moveY);
  w.u16(aim);
  w.u8(aimDist);
}

/** Decodes a client message into `out`. Returns the type, or 0 when the data is not valid. */
export function decodeClient(data: Uint8Array, out: ClientMsg): number {
  const r = new Reader(data);
  const type = r.u8();
  out.type = 0;
  switch (type) {
    case C2S.HELLO:
      out.version = r.u8();
      break;
    case C2S.PLAY:
      out.name = r.string(NAME_MAX_BYTES);
      out.shipId = r.u8();
      break;
    case C2S.INPUT: {
      out.seq = r.u16();
      out.fire = (r.u8() & 1) !== 0;
      out.moveX = r.i8();
      out.moveY = r.i8();
      out.aim = r.u16();
      out.aimDist = r.u8();
      break;
    }
    case C2S.UPGRADE:
      out.stat = r.u8();
      break;
    case C2S.TIER_UP:
      out.shipId = r.u8();
      break;
    case C2S.PING:
      out.clientTime = r.u32();
      break;
    default:
      return 0;
  }
  // Trailing bytes are not allowed either: the formats are fixed.
  if (!r.ok || r.remaining !== 0) return 0;
  out.type = type;
  return type;
}

// ---------------------------------------------------------------------------------------------
// Server -> client

export interface WelcomeMsg {
  version: number;
  mapSeed: number;
  tickRate: number;
  snapshotEvery: number;
  serverTimeMs: number;
  configHash: number;
}

export function encodeWelcome(w: Writer, m: WelcomeMsg): void {
  w.u8(S2C.WELCOME);
  w.u8(m.version);
  w.u32(m.mapSeed);
  w.u8(m.tickRate);
  w.u8(m.snapshotEvery);
  w.u32(m.serverTimeMs);
  w.u32(m.configHash);
}

export function encodeJoined(w: Writer, entityId: number, team: number, shipId: number): void {
  w.u8(S2C.JOINED);
  w.u16(entityId);
  w.u8(team);
  w.u8(shipId);
}

export function encodeMatch(
  w: Writer,
  state: number,
  winner: number,
  restartSec: number,
  killsBlue: number,
  killsRed: number,
): void {
  w.u8(S2C.MATCH);
  w.u8(state);
  w.u8(winner);
  w.u8(restartSec);
  w.u16(killsBlue);
  w.u16(killsRed);
}

export function encodeYouDied(
  w: Writer,
  killerId: number,
  killerName: string,
  respawnSec: number,
): void {
  w.u8(S2C.YOU_DIED);
  w.u16(killerId);
  w.string(killerName, NAME_MAX_BYTES);
  w.u8(respawnSec);
}

/** Who sank whom (for the kill feed). Carriers are entities 1 and 2. */
export function encodeKill(
  w: Writer,
  killerId: number,
  victimId: number,
  killerTeam: number,
  victimTeam: number,
  weapon: number,
  killerName: string,
  victimName: string,
): void {
  w.u8(S2C.KILL);
  w.u16(killerId);
  w.u16(victimId);
  w.u8(killerTeam);
  w.u8(victimTeam);
  w.u8(weapon);
  w.string(killerName, NAME_MAX_BYTES);
  w.string(victimName, NAME_MAX_BYTES);
}

/** One row of the scoreboard. */
export interface ScoreEntry {
  id: number;
  team: number;
  kills: number;
  deaths: number;
  score: number;
  /** Tier index, 0 = T1. */
  tier: number;
  name: string;
}

/** Starts a SCORES message; returns where the row count lives (pass it to `finishScores`). */
export function beginScores(w: Writer): number {
  w.u8(S2C.SCORES);
  const at = w.pos;
  w.u8(0);
  return at;
}

export function writeScore(
  w: Writer,
  id: number,
  team: number,
  kills: number,
  deaths: number,
  score: number,
  tier: number,
  name: string,
): void {
  w.u16(id);
  w.u8(team);
  w.u16(kills);
  w.u16(deaths);
  w.u32(score);
  w.u8(tier);
  w.string(name, NAME_MAX_BYTES);
}

export function finishScores(w: Writer, countAt: number, count: number): void {
  w.patchU8(countAt, count);
}

/** The player's own progress (sent when it changes). */
export interface StatsMsg {
  score: number;
  cash: number;
  /** Tier index, 0 = T1. */
  tier: number;
  /** Index into SHIP_IDS of the current ship. */
  shipId: number;
  /** Upgrade levels, STAT_COUNT of them (reused by the decoder: copy what you keep). */
  levels: Uint8Array;
  maxHull: number;
  maxShield: number;
  canTierUp: boolean;
  /** Sinkings left before the class is lost. */
  lives: number;
}

export function encodeStats(w: Writer, m: StatsMsg): void {
  w.u8(S2C.STATS);
  w.u32(m.score);
  w.u32(m.cash);
  w.u8(m.tier);
  w.u8(m.shipId);
  for (let i = 0; i < STAT_COUNT; i++) w.u8(m.levels[i]!);
  w.u16(m.maxHull);
  w.u16(m.maxShield);
  w.u8(m.canTierUp ? 1 : 0);
  w.u8(m.lives);
}

export function encodePong(w: Writer, clientTime: number, serverTime: number): void {
  w.u8(S2C.PONG);
  w.u32(clientTime);
  w.u32(serverTime);
}

export function encodeReject(w: Writer, reason: number): void {
  w.u8(S2C.REJECT);
  w.u8(reason);
}

/** The player's own ship at full precision (§10.3). */
export interface SelfState {
  x: number;
  y: number;
  heading: number;
  speed: number;
  kx: number;
  ky: number;
  spin: number;
  hull: number;
  shield: number;
}

export function newSelfState(): SelfState {
  return { x: 0, y: 0, heading: 0, speed: 0, kx: 0, ky: 0, spin: 0, hull: 0, shield: 0 };
}

export interface EnterEntry {
  id: number;
  kind: number;
  shipId: number;
  team: number;
  x: number;
  y: number;
  heading: number;
  hp: number;
  shield: number;
  /** Damage upgrade level (the guns of the ship are drawn bigger with it). */
  power: number;
  name: string;
}

export interface UpdateEntry {
  id: number;
  x: number;
  y: number;
  heading: number;
  speed: number;
  hp: number;
  shield: number;
}

/**
 * Builds the SNAPSHOT message of one client (§10.3). Fill it with `enter/update/leave`, then
 * `finish` writes the whole message. The lists are separate buffers because the counts come first.
 */
export class SnapshotBuilder {
  private readonly enters = new Writer(8192);
  private readonly updates = new Writer(4096);
  private readonly leaves = new Writer(1024);
  private nEnter = 0;
  private nUpdate = 0;
  private nLeave = 0;

  begin(): void {
    this.enters.reset();
    this.updates.reset();
    this.leaves.reset();
    this.nEnter = 0;
    this.nUpdate = 0;
    this.nLeave = 0;
  }

  enter(e: EnterEntry): void {
    if (this.nEnter >= 255) return;
    const w = this.enters;
    w.u16(e.id);
    w.u8(e.kind);
    w.u8(e.shipId);
    w.u8(e.team);
    w.u16(qPos(e.x));
    w.u16(qPos(e.y));
    w.u8(qAngle8(e.heading));
    w.u8(qFrac(e.hp));
    w.u8(qFrac(e.shield));
    w.u8(e.power);
    w.string(e.name, NAME_MAX_BYTES);
    this.nEnter++;
  }

  update(
    id: number,
    x: number,
    y: number,
    heading: number,
    speed: number,
    hp: number,
    shield: number,
  ): void {
    if (this.nUpdate >= 255) return;
    const w = this.updates;
    w.u16(id);
    w.u16(qPos(x));
    w.u16(qPos(y));
    w.u8(qAngle8(heading));
    w.i8(qSpeed(speed));
    w.u8(qFrac(hp));
    w.u8(qFrac(shield));
    this.nUpdate++;
  }

  leave(id: number): void {
    if (this.nLeave >= 255) return;
    this.leaves.u16(id);
    this.nLeave++;
  }

  finish(out: Writer, tick: number, lastInputSeq: number, self: SelfState): void {
    out.u8(S2C.SNAPSHOT);
    out.u32(tick);
    out.u16(lastInputSeq);
    out.f32(self.x);
    out.f32(self.y);
    out.f32(self.heading);
    out.f32(self.speed);
    out.f32(self.kx);
    out.f32(self.ky);
    out.f32(self.spin);
    out.u16(Math.max(0, Math.min(65535, Math.round(self.hull))));
    out.u16(Math.max(0, Math.min(65535, Math.round(self.shield))));
    out.u8(this.nEnter);
    out.u8(this.nUpdate);
    out.u8(this.nLeave);
    // Leaves first: an id may leave and come back (new spawn) within one snapshot.
    out.append(this.leaves);
    out.append(this.enters);
    out.append(this.updates);
  }
}

/** Builds an EVENTS message (§10.4). `begin`, add events, `finish` (false when nothing was added). */
export class EventWriter {
  readonly w = new Writer(4096);
  private count = 0;
  private countAt = 0;

  begin(tick: number): void {
    this.w.reset();
    this.count = 0;
    this.w.u8(S2C.EVENTS);
    this.w.u32(tick);
    this.countAt = this.w.pos;
    this.w.u8(0);
  }

  get size(): number {
    return this.count;
  }

  private room(bytes: number): boolean {
    return this.count < 255 && this.w.pos + bytes <= this.w.buf.length;
  }

  projectileSpawn(
    projId: number,
    owner: number,
    weapon: number,
    x: number,
    y: number,
    angle: number,
    power = 0,
  ): void {
    if (!this.room(13)) return;
    const w = this.w;
    w.u8(EVENT.PROJECTILE_SPAWN);
    w.u16(projId);
    w.u16(owner);
    w.u8(weapon);
    w.u16(qPos(x));
    w.u16(qPos(y));
    w.u16(qAngle16(angle));
    w.u8(power);
    this.count++;
  }

  projectileEnd(projId: number, reason: number, x: number, y: number): void {
    if (!this.room(8)) return;
    const w = this.w;
    w.u8(EVENT.PROJECTILE_END);
    w.u16(projId);
    w.u8(reason);
    w.u16(qPos(x));
    w.u16(qPos(y));
    this.count++;
  }

  shipHit(
    target: number,
    attacker: number,
    damage: number,
    shield: boolean,
    weapon: number,
    x: number,
    y: number,
  ): void {
    if (!this.room(12)) return;
    const w = this.w;
    w.u8(EVENT.SHIP_HIT);
    w.u16(target);
    w.u16(attacker);
    w.u8(Math.max(0, Math.min(255, Math.round(damage))));
    w.u8(shield ? 1 : 0);
    w.u8(weapon);
    w.u16(qPos(x));
    w.u16(qPos(y));
    this.count++;
  }

  shipSunk(id: number, killer: number, x: number, y: number): void {
    if (!this.room(9)) return;
    const w = this.w;
    w.u8(EVENT.SHIP_SUNK);
    w.u16(id);
    w.u16(killer);
    w.u16(qPos(x));
    w.u16(qPos(y));
    this.count++;
  }

  bump(ship: number, other: number, x: number, y: number, impact: number): void {
    if (!this.room(10)) return;
    const w = this.w;
    w.u8(EVENT.BUMP);
    w.u16(ship);
    w.u16(other);
    w.u16(qPos(x));
    w.u16(qPos(y));
    w.u8(Math.max(0, Math.min(255, Math.round(impact * 8))));
    this.count++;
  }

  /** A ship's damage upgrade level changed. */
  power(id: number, level: number): void {
    if (!this.room(4)) return;
    const w = this.w;
    w.u8(EVENT.POWER);
    w.u16(id);
    w.u8(level);
    this.count++;
  }

  /** A ship picked something up (or a pickup was taken). */
  pickup(id: number, collector: number, kind: number, value: number, x: number, y: number): void {
    if (!this.room(13)) return;
    const w = this.w;
    w.u8(EVENT.PICKUP);
    w.u16(id);
    w.u16(collector);
    w.u8(kind);
    w.u16(Math.max(0, Math.min(65535, Math.round(value))));
    w.u16(qPos(x));
    w.u16(qPos(y));
    this.count++;
  }

  /** Writes the event count; returns false when there is nothing to send. */
  finish(): boolean {
    this.w.patchU8(this.countAt, this.count);
    return this.count > 0;
  }
}

/** What the client does with a decoded server message. All callbacks are optional in spirit: implement what you use. */
export interface ServerHandler {
  welcome(m: WelcomeMsg): void;
  joined(entityId: number, team: number, shipId: number): void;
  match(
    state: number,
    winner: number,
    restartSec: number,
    killsBlue: number,
    killsRed: number,
  ): void;
  youDied(killerId: number, killerName: string, respawnSec: number): void;
  kill(
    killerId: number,
    victimId: number,
    killerTeam: number,
    victimTeam: number,
    weapon: number,
    killerName: string,
    victimName: string,
  ): void;
  stats(m: StatsMsg): void;
  /** The whole scoreboard (a new array each time; it is rare). */
  scores(rows: ScoreEntry[]): void;
  pong(clientTime: number, serverTime: number): void;
  reject(reason: number): void;
  /** Start of a snapshot; `self` is reused by the decoder, copy what you keep. */
  snapshot(tick: number, lastInputSeq: number, self: SelfState): void;
  enter(e: EnterEntry): void;
  update(u: UpdateEntry): void;
  leave(id: number): void;
  projectileSpawn(
    tick: number,
    projId: number,
    owner: number,
    weapon: number,
    x: number,
    y: number,
    angle: number,
    power: number,
  ): void;
  projectileEnd(tick: number, projId: number, reason: number, x: number, y: number): void;
  shipHit(
    tick: number,
    target: number,
    attacker: number,
    damage: number,
    shield: boolean,
    weapon: number,
    x: number,
    y: number,
  ): void;
  shipSunk(tick: number, id: number, killer: number, x: number, y: number): void;
  bump(tick: number, ship: number, other: number, x: number, y: number, impact: number): void;
  pickup(
    tick: number,
    id: number,
    collector: number,
    kind: number,
    value: number,
    x: number,
    y: number,
  ): void;
  power(tick: number, id: number, level: number): void;
}

const self = newSelfState();
const enterEntry: EnterEntry = {
  id: 0,
  kind: 0,
  shipId: 0,
  team: 0,
  x: 0,
  y: 0,
  heading: 0,
  hp: 0,
  shield: 0,
  power: 0,
  name: '',
};
const statsMsg: StatsMsg = {
  score: 0,
  cash: 0,
  tier: 0,
  shipId: 0,
  levels: new Uint8Array(STAT_COUNT),
  maxHull: 0,
  maxShield: 0,
  canTierUp: false,
  lives: 0,
};
const updateEntry: UpdateEntry = { id: 0, x: 0, y: 0, heading: 0, speed: 0, hp: 0, shield: 0 };

/**
 * Decodes a server message and calls the matching handler method. Returns false when the data is
 * malformed (truncated, unknown type, trailing bytes). Never throws.
 */
export function decodeServer(data: Uint8Array, h: ServerHandler): boolean {
  const r = new Reader(data);
  const type = r.u8();
  switch (type) {
    case S2C.WELCOME: {
      const m: WelcomeMsg = {
        version: r.u8(),
        mapSeed: r.u32(),
        tickRate: r.u8(),
        snapshotEvery: r.u8(),
        serverTimeMs: r.u32(),
        configHash: r.u32(),
      };
      if (!r.ok || r.remaining !== 0) return false;
      h.welcome(m);
      return true;
    }
    case S2C.JOINED: {
      const id = r.u16();
      const team = r.u8();
      const ship = r.u8();
      if (!r.ok || r.remaining !== 0) return false;
      h.joined(id, team, ship);
      return true;
    }
    case S2C.MATCH: {
      const state = r.u8();
      const winner = r.u8();
      const restart = r.u8();
      const kb = r.u16();
      const kr = r.u16();
      if (!r.ok || r.remaining !== 0) return false;
      h.match(state, winner, restart, kb, kr);
      return true;
    }
    case S2C.YOU_DIED: {
      const killer = r.u16();
      const name = r.string(NAME_MAX_BYTES);
      const respawn = r.u8();
      if (!r.ok || r.remaining !== 0) return false;
      h.youDied(killer, name, respawn);
      return true;
    }
    case S2C.KILL: {
      const killer = r.u16();
      const victim = r.u16();
      const killerTeam = r.u8();
      const victimTeam = r.u8();
      const weapon = r.u8();
      const killerName = r.string(NAME_MAX_BYTES);
      const victimName = r.string(NAME_MAX_BYTES);
      if (!r.ok || r.remaining !== 0) return false;
      h.kill(killer, victim, killerTeam, victimTeam, weapon, killerName, victimName);
      return true;
    }
    case S2C.SCORES: {
      const count = r.u8();
      // Each row is at least 13 bytes, so a lying count is caught before anything is allocated.
      if (!r.ok || r.remaining < count * 13) return false;
      const rows: ScoreEntry[] = [];
      for (let i = 0; i < count && r.ok; i++) {
        rows.push({
          id: r.u16(),
          team: r.u8(),
          kills: r.u16(),
          deaths: r.u16(),
          score: r.u32(),
          tier: r.u8(),
          name: r.string(NAME_MAX_BYTES),
        });
      }
      if (!r.ok || r.remaining !== 0) return false;
      h.scores(rows);
      return true;
    }
    case S2C.STATS: {
      statsMsg.score = r.u32();
      statsMsg.cash = r.u32();
      statsMsg.tier = r.u8();
      statsMsg.shipId = r.u8();
      for (let i = 0; i < STAT_COUNT; i++) statsMsg.levels[i] = r.u8();
      statsMsg.maxHull = r.u16();
      statsMsg.maxShield = r.u16();
      statsMsg.canTierUp = (r.u8() & 1) !== 0;
      statsMsg.lives = r.u8();
      if (!r.ok || r.remaining !== 0) return false;
      h.stats(statsMsg);
      return true;
    }
    case S2C.PONG: {
      const c = r.u32();
      const s = r.u32();
      if (!r.ok || r.remaining !== 0) return false;
      h.pong(c, s);
      return true;
    }
    case S2C.REJECT: {
      const reason = r.u8();
      if (!r.ok || r.remaining !== 0) return false;
      h.reject(reason);
      return true;
    }
    case S2C.SNAPSHOT:
      return decodeSnapshot(r, h);
    case S2C.EVENTS:
      return decodeEvents(r, h);
    default:
      return false;
  }
}

function decodeSnapshot(r: Reader, h: ServerHandler): boolean {
  const tick = r.u32();
  const seq = r.u16();
  self.x = r.f32();
  self.y = r.f32();
  self.heading = r.f32();
  self.speed = r.f32();
  self.kx = r.f32();
  self.ky = r.f32();
  self.spin = r.f32();
  self.hull = r.u16();
  self.shield = r.u16();
  const nEnter = r.u8();
  const nUpdate = r.u8();
  const nLeave = r.u8();
  if (!r.ok) return false;
  // The sections have known minimum sizes, so a lying count is caught before any callback.
  if (r.remaining < nEnter * 14 + nUpdate * 10 + nLeave * 2) return false;
  h.snapshot(tick, seq, self);
  for (let i = 0; i < nLeave && r.ok; i++) {
    const id = r.u16();
    if (r.ok) h.leave(id);
  }
  for (let i = 0; i < nEnter && r.ok; i++) {
    enterEntry.id = r.u16();
    enterEntry.kind = r.u8();
    enterEntry.shipId = r.u8();
    enterEntry.team = r.u8();
    enterEntry.x = dqPos(r.u16());
    enterEntry.y = dqPos(r.u16());
    enterEntry.heading = dqAngle8(r.u8());
    enterEntry.hp = dqFrac(r.u8());
    enterEntry.shield = dqFrac(r.u8());
    enterEntry.power = r.u8();
    enterEntry.name = r.string(NAME_MAX_BYTES);
    if (r.ok) h.enter(enterEntry);
  }
  for (let i = 0; i < nUpdate && r.ok; i++) {
    updateEntry.id = r.u16();
    updateEntry.x = dqPos(r.u16());
    updateEntry.y = dqPos(r.u16());
    updateEntry.heading = dqAngle8(r.u8());
    updateEntry.speed = dqSpeed(r.i8());
    updateEntry.hp = dqFrac(r.u8());
    updateEntry.shield = dqFrac(r.u8());
    if (r.ok) h.update(updateEntry);
  }
  return r.ok && r.remaining === 0;
}

function decodeEvents(r: Reader, h: ServerHandler): boolean {
  const tick = r.u32();
  const count = r.u8();
  for (let i = 0; i < count && r.ok; i++) {
    const type = r.u8();
    switch (type) {
      case EVENT.PROJECTILE_SPAWN: {
        const id = r.u16();
        const owner = r.u16();
        const weapon = r.u8();
        const x = dqPos(r.u16());
        const y = dqPos(r.u16());
        const angle = dqAngle16(r.u16());
        const power = r.u8();
        if (r.ok) h.projectileSpawn(tick, id, owner, weapon, x, y, angle, power);
        break;
      }
      case EVENT.PROJECTILE_END: {
        const id = r.u16();
        const reason = r.u8();
        const x = dqPos(r.u16());
        const y = dqPos(r.u16());
        if (r.ok) h.projectileEnd(tick, id, reason, x, y);
        break;
      }
      case EVENT.SHIP_HIT: {
        const target = r.u16();
        const attacker = r.u16();
        const damage = r.u8();
        const flags = r.u8();
        const weapon = r.u8();
        const x = dqPos(r.u16());
        const y = dqPos(r.u16());
        if (r.ok) h.shipHit(tick, target, attacker, damage, (flags & 1) !== 0, weapon, x, y);
        break;
      }
      case EVENT.SHIP_SUNK: {
        const id = r.u16();
        const killer = r.u16();
        const x = dqPos(r.u16());
        const y = dqPos(r.u16());
        if (r.ok) h.shipSunk(tick, id, killer, x, y);
        break;
      }
      case EVENT.BUMP: {
        const ship = r.u16();
        const other = r.u16();
        const x = dqPos(r.u16());
        const y = dqPos(r.u16());
        const impact = r.u8() / 8;
        if (r.ok) h.bump(tick, ship, other, x, y, impact);
        break;
      }
      case EVENT.POWER: {
        const id = r.u16();
        const level = r.u8();
        if (r.ok) h.power(tick, id, level);
        break;
      }
      case EVENT.PICKUP: {
        const id = r.u16();
        const collector = r.u16();
        const kind = r.u8();
        const value = r.u16();
        const x = dqPos(r.u16());
        const y = dqPos(r.u16());
        if (r.ok) h.pickup(tick, id, collector, kind, value, x, y);
        break;
      }
      default:
        r.ok = false;
    }
  }
  return r.ok && r.remaining === 0;
}
