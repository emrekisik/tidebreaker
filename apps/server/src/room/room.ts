import {
  C2S,
  KIND,
  MATCH,
  MATCH_STATE,
  NO_TEAM,
  PICKUP_ID_BASE,
  PROTOCOL_VERSION,
  REJECT_REASON,
  SHIP_IDS,
  SNAPSHOT_EVERY,
  STAT,
  STAT_COUNT,
  STEP_MS,
  SnapshotBuilder,
  TEAM_BLUE,
  TICK_RATE,
  Writer,
  beginScores,
  configHash,
  decodeClient,
  dqAngle16,
  dqAxis,
  encodeJoined,
  encodeKill,
  encodeMatch,
  encodePong,
  encodeReject,
  encodeStats,
  encodeWelcome,
  encodeYouDied,
  finishScores,
  newClientMsg,
  canTierUp,
  newSelfState,
  writeScore,
} from '@tidebreaker/shared';
import type { ClientMsg, EnterEntry, StatsMsg } from '@tidebreaker/shared';
import type { Connection, Transport } from '../net/transport.ts';
import { PICKUP_CAPACITY } from '../sim/hot/pickups.ts';
import { CARRIER_SLOTS, World } from '../sim/hot/world.ts';
import { sanitizeName } from './names.ts';

export interface RoomOptions {
  transport: Transport;
  /** Map seed sent to clients (they generate the same map from it). */
  seed: number;
  name?: string;
  /**
   * Players may pick any ship class when they join (for testing). Otherwise everyone starts as T1
   * and has to earn the rest. Default: on, except in production.
   */
  anyClass?: boolean;
  /** Milliseconds clock; tests can supply their own. */
  clock?: () => number;
}

/** Limits and timeouts (GAME_DESIGN.md §11.4, §13). */
const HELLO_TIMEOUT_MS = 5000;
const IDLE_TIMEOUT_MS = 20000;
const BACKPRESSURE_BYTES = 64 * 1024;
const BACKPRESSURE_KICK_MS = 5000;
const RATE_BURST = 120;
const RATE_PER_SEC = 60;
const RATE_KICK_VIOLATIONS = 300;
const INPUT_QUEUE = 16;
/** Steps of saved-up credit a player may hold, and the queue length kept after a stall. */
const CREDIT_MAX = 12;
const CATCH_UP_KEEP = 14;
/** New players are refused while the tick loop is this busy (fraction of the tick budget). */
const BUSY_LIMIT = 0.65;

const enum Stage {
  New = 0,
  Welcomed = 1,
  Playing = 2,
}

/** Everything the room remembers about one connection. */
class Client {
  stage: Stage = Stage.New;
  slot = -1;
  name = '';
  readonly connectedAt: number;
  lastMsgAt: number;
  tokens = RATE_BURST;
  tokensAt: number;
  violations = 0;
  overSince = 0;
  readonly msg: ClientMsg = newClientMsg();
  // Pending inputs (ring buffer), consumed one per tick.
  readonly qSeq = new Uint16Array(INPUT_QUEUE);
  readonly qSteer = new Float32Array(INPUT_QUEUE);
  readonly qThrottle = new Float32Array(INPUT_QUEUE);
  readonly qAim = new Float32Array(INPUT_QUEUE);
  readonly qDist = new Float32Array(INPUT_QUEUE);
  readonly qFire = new Uint8Array(INPUT_QUEUE);
  qHead = 0;
  qCount = 0;
  /** Input steps this player may still take (see Room.consumeInputs). */
  credit = 1;
  /** Which entities this client has been told about (and in which spawn generation). */
  readonly known: Uint8Array;
  readonly knownGen: Uint16Array;

  constructor(
    readonly conn: Connection,
    slots: number,
    now: number,
  ) {
    this.known = new Uint8Array(slots + PICKUP_CAPACITY);
    this.knownGen = new Uint16Array(slots + PICKUP_CAPACITY);
    this.connectedAt = now;
    this.lastMsgAt = now;
    this.tokensAt = now;
  }
}

/**
 * One room: the world, its tick loop and every connection (GAME_DESIGN.md §10, §11). The network
 * code lives here; the simulation is in `World` (hot path, no allocation).
 */
export class Room {
  readonly world: World;
  private readonly transport: Transport;
  private readonly seed: number;
  private readonly name: string;
  private readonly clock: () => number;
  private readonly t0: number;
  private readonly clients = new Set<Client>();
  /** slot -> client (players only). */
  private readonly bySlot: (Client | undefined)[];
  private readonly names: string[];
  private readonly snapshot = new SnapshotBuilder();
  private readonly small = new Writer(256);
  private readonly big = new Writer(12288);
  private readonly stats: StatsMsg = {
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
  private readonly anyClass: boolean;
  private readonly self = newSelfState();
  private readonly enter: EnterEntry = {
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
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private nextAt = 0;
  /** Fraction of the tick budget spent on the last ticks (exponential moving average). */
  tickBusyEma = 0;
  private ticksSinceMatch = 0;
  private lastScoresTick = -TICK_RATE;

  constructor(options: RoomOptions) {
    this.transport = options.transport;
    this.seed = options.seed;
    this.name = options.name ?? 'room-1';
    this.clock = options.clock ?? ((): number => performance.now());
    this.anyClass = options.anyClass ?? process.env['NODE_ENV'] !== 'production';
    this.t0 = this.clock();
    this.world = new World(options.seed);
    this.bySlot = new Array<Client | undefined>(this.world.slotCount).fill(undefined);
    this.names = new Array<string>(this.world.slotCount).fill('');
    this.names[0] = 'Carrier';
    this.names[1] = 'Carrier';
    this.transport.onConnection = (conn): void => this.attach(conn);
  }

  /** Starts listening and ticking. */
  async start(): Promise<void> {
    await this.transport.start();
    this.running = true;
    this.nextAt = this.clock();
    this.loop();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    for (const c of this.clients) c.conn.close();
    await this.transport.stop();
  }

  /** What GET /status reports. */
  status(): Record<string, unknown> {
    return {
      room: this.name,
      tickRate: TICK_RATE,
      players: this.world.playerCount(),
      max: this.world.maxPlayers,
      accepting: this.accepting(),
      match: this.world.matchState === MATCH_STATE.PLAYING ? 'playing' : 'ended',
      tick: this.world.tick,
      tickBusyEma: Math.round(this.tickBusyEma * 1000) / 1000,
      build: 'dev',
    };
  }

  accepting(): boolean {
    return this.world.playerCount() < this.world.maxPlayers && this.tickBusyEma < BUSY_LIMIT;
  }

  // ---- tick loop (§11.1)

  private loop(): void {
    if (!this.running) return;
    const now = this.clock();
    let steps = 0;
    while (now >= this.nextAt && steps < 3) {
      this.tick();
      this.nextAt += STEP_MS;
      steps++;
    }
    // Drop accumulated lag instead of spiralling.
    if (now >= this.nextAt) this.nextAt = now + STEP_MS;
    this.timer = setTimeout(() => this.loop(), Math.max(0, this.nextAt - this.clock() - 1));
  }

  /** One server tick. Public so tests can drive time themselves. */
  tick(): void {
    const started = this.clock();
    const w = this.world;
    this.consumeInputs();
    w.step();
    this.afterStep();
    if (w.tick % SNAPSHOT_EVERY === 0) this.sendSnapshots();
    if (w.tick % TICK_RATE === 0) this.housekeeping(started);
    const busy = (this.clock() - started) / STEP_MS;
    this.tickBusyEma += (busy - this.tickBusyEma) * 0.05;
  }

  /**
   * Movement is driven by the player's inputs, one step per input (never an invented step), so the
   * client can replay exactly what the server has not seen. A player earns one step of credit per
   * tick (a few can be saved), which lets a burst after a hiccup catch up but stops a client from
   * speeding up by sending inputs too fast.
   */
  private consumeInputs(): void {
    const w = this.world;
    for (const c of this.clients) {
      if (c.stage !== Stage.Playing || c.slot < 0) continue;
      c.credit = Math.min(CREDIT_MAX, c.credit + 1);
      // Far behind after a long stall: skip the oldest, keep the freshest few.
      while (c.qCount > CATCH_UP_KEEP) {
        c.qHead = (c.qHead + 1) % INPUT_QUEUE;
        c.qCount--;
      }
      const s = c.slot;
      while (c.qCount > 0 && c.credit >= 1) {
        const i = c.qHead;
        w.lastSeq[s] = c.qSeq[i]!;
        w.inAim[s] = c.qAim[i]!;
        w.inAimDist[s] = c.qDist[i]!;
        w.inFire[s] = c.qFire[i]!;
        w.moveShip(s, c.qSteer[i]!, c.qThrottle[i]!);
        c.qHead = (c.qHead + 1) % INPUT_QUEUE;
        c.qCount--;
        c.credit -= 1;
      }
    }
  }

  /** Events, deaths, respawns and match changes of the tick that just ran. */
  private afterStep(): void {
    const w = this.world;
    if (w.events.finish()) {
      const bytes = w.events.w.toBytes();
      for (const c of this.clients) if (c.stage === Stage.Playing) this.send(c, bytes);
    }
    for (let i = 0; i < w.feedCount; i++) this.broadcastKill(i);
    if (w.scoresDirty && w.tick - this.lastScoresTick >= TICK_RATE) this.broadcastScores();
    for (let i = 0; i < w.diedCount; i++) {
      const victim = this.bySlot[w.diedVictim[i]! - 1];
      if (!victim) continue;
      const killerId = w.diedKiller[i]!;
      const killerName = this.names[killerId - 1] ?? '';
      this.small.reset();
      encodeYouDied(this.small, killerId, killerName, Math.ceil(MATCH.respawnSec));
      this.send(victim, this.small.toBytes());
    }
    for (let s = CARRIER_SLOTS; s < w.slotCount; s++) {
      if (w.respawned[s] === 0) continue;
      w.respawned[s] = 0;
      const c = this.bySlot[s];
      if (c) this.sendJoined(c);
    }
    this.sendStats();
    this.ticksSinceMatch++;
    if (w.matchChanged || this.ticksSinceMatch >= TICK_RATE) this.broadcastMatch();
  }

  /** Tells everyone who sank whom (kill feed). */
  private broadcastKill(i: number): void {
    const w = this.world;
    const killer = w.feedKiller[i]!;
    const victim = w.feedVictim[i]!;
    const k = w.slots[killer - 1];
    const v = w.slots[victim - 1];
    if (!v) return;
    this.small.reset();
    encodeKill(
      this.small,
      killer,
      victim,
      k ? k.team : NO_TEAM,
      v.team,
      w.feedWeapon[i]!,
      this.names[killer - 1] ?? '',
      this.names[victim - 1] ?? '',
    );
    const bytes = this.small.toBytes();
    for (const c of this.clients) if (c.stage === Stage.Playing) this.send(c, bytes);
  }

  /** The scoreboard: everyone's kills and deaths this round (at most once a second, when changed). */
  private broadcastScores(): void {
    const w = this.world;
    w.scoresDirty = false;
    this.lastScoresTick = w.tick;
    this.big.reset();
    const at = beginScores(this.big);
    let n = 0;
    for (let s = CARRIER_SLOTS; s < w.slotCount; s++) {
      if (w.used[s] === 0) continue;
      writeScore(
        this.big,
        s + 1,
        w.slots[s]!.team,
        w.kills[s]!,
        w.deaths[s]!,
        w.score[s]!,
        w.tier[s]!,
        this.names[s] ?? '',
      );
      n++;
    }
    finishScores(this.big, at, n);
    if (this.big.overflow) return;
    const bytes = this.big.toBytes();
    for (const c of this.clients) if (c.stage === Stage.Playing) this.send(c, bytes);
  }

  /** Each player hears about changes of their own score, money and upgrades. */
  private sendStats(): void {
    const w = this.world;
    for (let s = CARRIER_SLOTS; s < w.slotCount; s++) {
      if (w.statsDirty[s] === 0) continue;
      const c = this.bySlot[s];
      if (!c) {
        w.statsDirty[s] = 0;
        continue;
      }
      w.statsDirty[s] = 0;
      const m = this.stats;
      m.score = w.score[s]!;
      m.cash = w.cash[s]!;
      m.tier = w.tier[s]!;
      m.shipId = w.shipIdx[s]!;
      for (let k = 0; k < STAT_COUNT; k++) m.levels[k] = w.level(s, k);
      m.maxHull = w.slots[s]!.def.hull;
      m.maxShield = Math.round(w.maxShieldOf(s));
      m.canTierUp = canTierUp(m.tier, m.score);
      m.lives = w.lives[s]!;
      this.small.reset();
      encodeStats(this.small, m);
      this.send(c, this.small.toBytes());
    }
  }

  private broadcastMatch(): void {
    const w = this.world;
    w.matchChanged = false;
    this.ticksSinceMatch = 0;
    this.small.reset();
    encodeMatch(
      this.small,
      w.matchState,
      w.winner,
      Math.max(0, Math.min(255, Math.ceil(w.restartLeft))),
      w.teamKills[0]!,
      w.teamKills[1]!,
    );
    const bytes = this.small.toBytes();
    for (const c of this.clients) if (c.stage >= Stage.Welcomed) this.send(c, bytes);
  }

  private sendJoined(c: Client): void {
    const w = this.world;
    this.small.reset();
    encodeJoined(this.small, c.slot + 1, w.slots[c.slot]!.team, w.shipIdx[c.slot]!);
    this.send(c, this.small.toBytes());
  }

  // ---- snapshots (§10.3): every client sees every entity (AOI comes in Phase 6)

  private sendSnapshots(): void {
    const w = this.world;
    for (const c of this.clients) {
      if (c.stage !== Stage.Playing || c.slot < 0) continue;
      const sb = this.snapshot;
      sb.begin();
      for (let s = 0; s < w.slotCount; s++) {
        if (s === c.slot) continue;
        const ship = w.slots[s]!;
        const present = w.used[s] === 1 && ship.state.alive;
        const gen = w.spawnGen[s]!;
        if (present && c.known[s] === 1 && c.knownGen[s] !== gen) {
          // Respawned since the client last saw it: forget the old ship first.
          sb.leave(s + 1);
          c.known[s] = 0;
        }
        if (present && c.known[s] === 0) {
          const e = this.enter;
          e.id = s + 1;
          e.kind = s < CARRIER_SLOTS ? KIND.CARRIER : KIND.SHIP;
          e.shipId = w.shipIdx[s]!;
          e.team = ship.team;
          e.x = ship.state.x;
          e.y = ship.state.y;
          e.heading = ship.state.heading;
          e.hp = ship.state.hull / ship.def.hull;
          e.shield = ship.state.shield / w.maxShieldOf(s);
          e.power = s < CARRIER_SLOTS ? 0 : w.level(s, STAT.DAMAGE);
          e.name = this.names[s]!;
          sb.enter(e);
          c.known[s] = 1;
          c.knownGen[s] = gen;
        } else if (present) {
          const st = ship.state;
          sb.update(
            s + 1,
            st.x,
            st.y,
            st.heading,
            st.speed,
            st.hull / ship.def.hull,
            st.shield / w.maxShieldOf(s),
          );
        } else if (c.known[s] === 1) {
          sb.leave(s + 1);
          c.known[s] = 0;
        }
      }
      this.snapshotPickups(c, sb);
      const me = w.slots[c.slot]!.state;
      const self = this.self;
      self.x = me.x;
      self.y = me.y;
      self.heading = me.heading;
      self.speed = me.speed;
      self.kx = me.kx;
      self.ky = me.ky;
      self.spin = me.spin;
      self.hull = me.hull;
      self.shield = me.shield;
      this.big.reset();
      sb.finish(this.big, w.tick, w.lastSeq[c.slot]!, self);
      if (this.big.overflow) continue;
      this.send(c, this.big.toBytes());
    }
  }

  /** Pickups are static: told once when they appear (or move to a new spot), and again when gone. */
  private snapshotPickups(c: Client, sb: SnapshotBuilder): void {
    const p = this.world.pickups;
    const e = this.enter;
    for (let i = 0; i < PICKUP_CAPACITY; i++) {
      const at = this.world.slotCount + i;
      const present = p.active[i] === 1;
      if (present && c.known[at] === 1 && c.knownGen[at] !== p.gen[i]) {
        sb.leave(PICKUP_ID_BASE + i);
        c.known[at] = 0;
      }
      if (present && c.known[at] === 0) {
        e.id = PICKUP_ID_BASE + i;
        e.kind = p.kind[i]!;
        e.shipId = p.look(i);
        e.team = NO_TEAM;
        e.x = p.x[i]!;
        e.y = p.y[i]!;
        e.heading = 0;
        e.hp = 1;
        e.shield = 1;
        e.power = 0;
        e.name = '';
        sb.enter(e);
        c.known[at] = 1;
        c.knownGen[at] = p.gen[i]!;
      } else if (!present && c.known[at] === 1) {
        sb.leave(PICKUP_ID_BASE + i);
        c.known[at] = 0;
      }
    }
  }

  // ---- connections

  private attach(conn: Connection): void {
    const now = this.clock();
    const c = new Client(conn, this.world.slotCount, now);
    this.clients.add(c);
    conn.onMessage = (data): void => this.onData(c, data);
    conn.onClose = (): void => this.detach(c);
  }

  private detach(c: Client): void {
    if (!this.clients.delete(c)) return;
    if (c.slot >= 0) {
      this.world.removePlayer(c.slot);
      this.bySlot[c.slot] = undefined;
      // The name stays: a ship that is still drifting in the water keeps its name tag.
      c.slot = -1;
    }
  }

  private kick(c: Client): void {
    c.conn.close();
    this.detach(c);
  }

  private reject(c: Client, reason: number, close: boolean): void {
    this.small.reset();
    encodeReject(this.small, reason);
    c.conn.send(this.small.toBytes());
    if (close) this.kick(c);
  }

  private send(c: Client, bytes: Uint8Array): void {
    if (c.conn.bufferedAmount > BACKPRESSURE_BYTES) {
      // The client cannot keep up: skip this message, and drop it if it stays that way.
      const now = this.clock();
      if (c.overSince === 0) c.overSince = now;
      else if (now - c.overSince > BACKPRESSURE_KICK_MS) this.kick(c);
      return;
    }
    c.overSince = 0;
    c.conn.send(bytes);
  }

  private onData(c: Client, data: Uint8Array): void {
    const now = this.clock();
    c.lastMsgAt = now;
    // Token bucket: a flood is dropped, a persistent flood disconnects.
    c.tokens = Math.min(RATE_BURST, c.tokens + ((now - c.tokensAt) / 1000) * RATE_PER_SEC);
    c.tokensAt = now;
    if (c.tokens < 1) {
      if (++c.violations > RATE_KICK_VIOLATIONS) this.reject(c, REJECT_REASON.RATE, true);
      return;
    }
    c.tokens -= 1;

    const type = decodeClient(data, c.msg);
    if (type === 0) {
      // Malformed messages are counted, never fatal on their own (§10.2).
      if (++c.violations > RATE_KICK_VIOLATIONS) this.kick(c);
      return;
    }
    switch (type) {
      case C2S.HELLO:
        this.onHello(c);
        break;
      case C2S.PLAY:
        this.onPlay(c);
        break;
      case C2S.INPUT:
        this.onInput(c);
        break;
      case C2S.UPGRADE:
        if (c.stage === Stage.Playing) this.world.upgrade(c.slot, c.msg.stat);
        break;
      case C2S.TIER_UP:
        if (c.stage === Stage.Playing) this.world.tierUp(c.slot);
        break;
      case C2S.PING:
        this.small.reset();
        encodePong(this.small, c.msg.clientTime, this.serverTime());
        c.conn.send(this.small.toBytes());
        break;
    }
  }

  private serverTime(): number {
    return Math.floor(this.clock() - this.t0) >>> 0;
  }

  private onHello(c: Client): void {
    if (c.stage !== Stage.New) return;
    if (c.msg.version !== PROTOCOL_VERSION) return this.reject(c, REJECT_REASON.VERSION, true);
    if (!this.accepting()) return this.reject(c, REJECT_REASON.ROOM_FULL, true);
    c.stage = Stage.Welcomed;
    this.small.reset();
    encodeWelcome(this.small, {
      version: PROTOCOL_VERSION,
      mapSeed: this.seed,
      tickRate: TICK_RATE,
      snapshotEvery: SNAPSHOT_EVERY,
      serverTimeMs: this.serverTime(),
      configHash: configHash(),
    });
    c.conn.send(this.small.toBytes());
  }

  private onPlay(c: Client): void {
    if (c.stage === Stage.New) return;
    const w = this.world;
    if (c.msg.shipId >= SHIP_IDS.length) return;
    // Everyone starts as T1 unless this server lets players pick (test builds).
    const shipIdx = this.anyClass ? c.msg.shipId : 0;
    if (c.stage === Stage.Playing) {
      // Already in the game: only the class can change.
      w.changeShip(c.slot, shipIdx);
      return;
    }
    const name = sanitizeName(c.msg.name);
    if (name === null) return this.reject(c, REJECT_REASON.BAD_NAME, false);
    const team = w.playersOnTeam(TEAM_BLUE) <= w.playersOnTeam(1) ? TEAM_BLUE : 1;
    if (w.playersOnTeam(team) >= MATCH.perTeam || !this.accepting()) {
      return this.reject(c, REJECT_REASON.ROOM_FULL, true);
    }
    const slot = w.addPlayer(team, shipIdx);
    if (slot < 0) return this.reject(c, REJECT_REASON.ROOM_FULL, true);
    c.slot = slot;
    c.name = name;
    c.stage = Stage.Playing;
    this.bySlot[slot] = c;
    this.names[slot] = name;
    w.respawned[slot] = 0;
    this.sendJoined(c);
    this.broadcastMatch();
  }

  private onInput(c: Client): void {
    if (c.stage !== Stage.Playing || c.qCount >= INPUT_QUEUE) return;
    const m = c.msg;
    const i = (c.qHead + c.qCount) % INPUT_QUEUE;
    c.qSeq[i] = m.seq;
    c.qSteer[i] = dqAxis(m.moveX);
    c.qThrottle[i] = dqAxis(m.moveY);
    c.qAim[i] = dqAngle16(m.aim);
    c.qDist[i] = m.aimDist;
    c.qFire[i] = m.fire ? 1 : 0;
    c.qCount++;
  }

  /** Once per second: connection timeouts. */
  private housekeeping(now: number): void {
    for (const c of Array.from(this.clients)) {
      if (c.stage === Stage.New && now - c.connectedAt > HELLO_TIMEOUT_MS) this.kick(c);
      else if (now - c.lastMsgAt > IDLE_TIMEOUT_MS) this.kick(c);
    }
  }
}
