import {
  Writer,
  decodeServer,
  encodeHello,
  encodeInput,
  encodePing,
  encodePlay,
  qAngle16,
  qAxis,
} from '@tidebreaker/shared';
import type {
  EnterEntry,
  ScoreEntry,
  SelfState,
  ServerHandler,
  StatsMsg,
  UpdateEntry,
} from '@tidebreaker/shared';
import type { MemoryClient } from './net/memTransport.ts';

/** Everything a test client has heard from the server, in a form that is easy to assert on. */
export interface Heard {
  welcome: { mapSeed: number; configHash: number; tickRate: number }[];
  joined: { entityId: number; team: number; shipId: number }[];
  match: {
    state: number;
    winner: number;
    restartSec: number;
    killsBlue: number;
    killsRed: number;
  }[];
  youDied: { killerId: number; killerName: string; respawnSec: number }[];
  kills: {
    killerId: number;
    victimId: number;
    killerTeam: number;
    victimTeam: number;
    weapon: number;
    killerName: string;
    victimName: string;
  }[];
  scores: ScoreEntry[][];
  stats: StatsMsg[];
  pickups: { tick: number; id: number; collector: number; kind: number; value: number }[];
  rejects: number[];
  pongs: { clientTime: number; serverTime: number }[];
  snapshots: { tick: number; seq: number; self: SelfState }[];
  enters: EnterEntry[];
  updates: UpdateEntry[];
  leaves: number[];
  spawns: {
    tick: number;
    id: number;
    owner: number;
    weapon: number;
    x: number;
    y: number;
    power: number;
  }[];
  ends: { tick: number; id: number; reason: number }[];
  hits: { target: number; attacker: number; damage: number; shield: boolean }[];
  sunk: { id: number; killer: number }[];
  bumps: { ship: number; other: number; impact: number }[];
  bad: number;
}

/** A scripted client on an in-memory connection. */
export class TestClient {
  readonly heard: Heard = {
    welcome: [],
    joined: [],
    match: [],
    youDied: [],
    kills: [],
    scores: [],
    stats: [],
    pickups: [],
    rejects: [],
    pongs: [],
    snapshots: [],
    enters: [],
    updates: [],
    leaves: [],
    spawns: [],
    ends: [],
    hits: [],
    sunk: [],
    bumps: [],
    bad: 0,
  };
  private readonly out = new Writer(64);
  private seq = 0;

  constructor(readonly conn: MemoryClient) {
    const h = this.heard;
    const handler: ServerHandler = {
      welcome: (m) => h.welcome.push({ ...m }),
      joined: (entityId, team, shipId) => h.joined.push({ entityId, team, shipId }),
      match: (state, winner, restartSec, killsBlue, killsRed) =>
        h.match.push({ state, winner, restartSec, killsBlue, killsRed }),
      youDied: (killerId, killerName, respawnSec) =>
        h.youDied.push({ killerId, killerName, respawnSec }),
      kill: (killerId, victimId, killerTeam, victimTeam, weapon, killerName, victimName) =>
        h.kills.push({
          killerId,
          victimId,
          killerTeam,
          victimTeam,
          weapon,
          killerName,
          victimName,
        }),
      scores: (rows) => h.scores.push(rows),
      stats: (m) => h.stats.push({ ...m, levels: m.levels.slice() }),
      pickup: (tick, id, collector, kind, value) =>
        h.pickups.push({ tick, id, collector, kind, value }),
      pong: (clientTime, serverTime) => h.pongs.push({ clientTime, serverTime }),
      reject: (r) => h.rejects.push(r),
      snapshot: (tick, seq, self) => h.snapshots.push({ tick, seq, self: { ...self } }),
      enter: (e) => h.enters.push({ ...e }),
      update: (u) => h.updates.push({ ...u }),
      leave: (id) => h.leaves.push(id),
      projectileSpawn: (tick, id, owner, weapon, x, y, _angle, power) =>
        h.spawns.push({ tick, id, owner, weapon, x, y, power }),
      projectileEnd: (tick, id, reason) => h.ends.push({ tick, id, reason }),
      shipHit: (_t, target, attacker, damage, shield) =>
        h.hits.push({ target, attacker, damage, shield }),
      shipSunk: (_t, id, killer) => h.sunk.push({ id, killer }),
      bump: (_t, ship, other, _x, _y, impact) => h.bumps.push({ ship, other, impact }),
    };
    conn.onMessage = (data): void => {
      if (!decodeServer(data, handler)) h.bad++;
    };
  }

  private flush(): void {
    this.conn.send(this.out.toBytes());
    this.out.reset();
  }

  hello(version?: number): void {
    encodeHello(this.out);
    if (version !== undefined) this.out.buf[1] = version;
    this.flush();
  }

  play(name: string, shipId = 0): void {
    encodePlay(this.out, name, shipId);
    this.flush();
  }

  ping(t: number): void {
    encodePing(this.out, t);
    this.flush();
  }

  /** Sends one INPUT with controls in [-1, 1]; returns its sequence number. */
  input(steer: number, throttle: number, aim = 0, aimDist = 0, fire = false): number {
    this.seq = (this.seq + 1) & 0xffff;
    encodeInput(this.out, this.seq, fire, qAxis(steer), qAxis(throttle), qAngle16(aim), aimDist);
    this.flush();
    return this.seq;
  }

  get lastSnapshot(): Heard['snapshots'][number] | undefined {
    return this.heard.snapshots[this.heard.snapshots.length - 1];
  }
}

/** Lets queued in-memory messages travel. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) await new Promise<void>((resolve) => setImmediate(resolve));
}
