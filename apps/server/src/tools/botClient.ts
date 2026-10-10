import { WebSocket } from 'ws';
import {
  KIND,
  PICKUP_ID_BASE,
  SHIPS,
  SHIP_IDS,
  WEAPONS,
  Writer,
  WORLD_CENTER,
  angleDiff,
  boundaryDepth,
  STAT_COUNT,
  decodeServer,
  encodeHello,
  encodeInput,
  encodePing,
  encodePlay,
  encodeTierUp,
  encodeUpgrade,
  generateMap,
  qAimDist,
  qAngle16,
  qAxis,
  segmentVsWorld,
  statCap,
  statCost,
} from '@tidebreaker/shared';
import type { ServerHandler, ShipId, WorldMap } from '@tidebreaker/shared';

export interface BotOptions {
  url: string;
  name: string;
  /** Ship class id (see SHIP_IDS). */
  ship: ShipId;
  /** Sails but never shoots or chases (a target dummy). */
  passive?: boolean;
  /** Prints what happens to this bot. */
  verbose?: boolean;
}

interface Seen {
  x: number;
  y: number;
  /** Velocity estimated from the last two updates (world units/s). */
  vx: number;
  vy: number;
  team: number;
  kind: number;
}

const TAU = Math.PI * 2;
/** Enemy ships this close are fought instead of sailing on to the carrier. */
const ENGAGE_RANGE = 80;
/** Steering offsets tried (radians from the wanted heading) until one is free of land. */
const SWERVES = [0, 0.4, -0.4, 0.8, -0.8, 1.3, -1.3, 1.9, -1.9];
/** Pickups this close are collected on the way. */
const LOOT_RANGE = 90;
const RETREAT_BELOW = 0.35;
const RETREAT_UNTIL = 0.8;
const RECONNECT_MS = 2500;

/**
 * A computer-controlled player that talks to the server like a browser does (same binary
 * protocol, quantized controls, one input every 50 ms). It sails toward the enemy carrier, fights
 * enemy ships that come near, keeps away from land, circles its target instead of ramming it and
 * falls back to its own carrier when badly hurt. Used for trying the game with a full room and
 * (later) for load tests. Reconnects by itself when the server restarts.
 */
export class BotClient {
  private ws: WebSocket | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private land: WorldMap | null = null;
  private readonly out = new Writer(64);
  private readonly seen = new Map<number, Seen>();
  /** Crates, barrels, chests and banknote piles in the water. */
  private readonly pickups = new Map<number, Seen>();
  private readonly me = {
    id: 0,
    team: -1,
    x: 0,
    y: 0,
    heading: 0,
    hull: 1,
    shield: 1,
    ready: false,
  };
  private readonly shot = { angle: 0, dist: 0 };
  private seq = 0;
  private tick = 0;
  private retreating = false;
  /** Which way this bot circles around its target. */
  private readonly side = Math.random() < 0.5 ? 1 : -1;
  /** The ship class changes as the bot climbs; these follow it. */
  private def;
  private weaponRange = 0;
  private shotSpeed = 1;
  /** Which stat to buy next (round robin, favoring the guns and shield). */
  private nextStat = 0;
  private tierUps = 0;
  hits = 0;

  constructor(private readonly opt: BotOptions) {
    this.def = SHIPS[opt.ship];
    this.useShip(opt.ship);
  }

  private useShip(id: ShipId): void {
    this.def = SHIPS[id];
    const weapons = this.def.mounts.map((m) => WEAPONS[m.weapon]);
    this.weaponRange = Math.max(...weapons.map((w) => w.range));
    this.shotSpeed = Math.min(...weapons.map((w) => w.projectileSpeed));
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.cleanup();
  }

  private log(text: string): void {
    if (this.opt.verbose) console.log(`[${this.opt.name}] ${text}`);
  }

  private connect(): void {
    this.cleanup();
    const ws = new WebSocket(this.opt.url, { origin: 'http://localhost:5173' });
    ws.binaryType = 'nodebuffer';
    this.ws = ws;
    ws.on('open', () => {
      this.write(() => encodeHello(this.out));
      this.timer = setInterval(() => this.think(), 50);
    });
    ws.on('message', (data: Buffer) => {
      decodeServer(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), this.handler);
    });
    ws.on('close', () => {
      this.log('disconnected');
      this.cleanup();
      if (!this.stopped) this.retry = setTimeout(() => this.connect(), RECONNECT_MS);
    });
    ws.on('error', () => ws.terminate());
  }

  private cleanup(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.retry) clearTimeout(this.retry);
    this.timer = null;
    this.retry = null;
    this.me.ready = false;
    this.seen.clear();
    this.pickups.clear();
    const ws = this.ws;
    this.ws = null;
    if (ws && ws.readyState <= WebSocket.OPEN) {
      ws.removeAllListeners('close');
      ws.on('error', () => {});
      ws.terminate();
    }
  }

  private write(build: () => void): void {
    build();
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(this.out.toBytes());
    this.out.reset();
  }

  private readonly handler: ServerHandler = {
    welcome: (m) => {
      this.land ??= generateMap(m.mapSeed);
      this.write(() => encodePlay(this.out, this.opt.name, SHIP_IDS.indexOf(this.opt.ship)));
    },
    joined: (id, team) => {
      this.me.id = id;
      this.me.team = team;
      this.me.ready = true;
      this.retreating = false;
      this.log(`joined as entity ${id}, team ${team === 0 ? 'blue' : 'red'}`);
    },
    match: () => {},
    youDied: (_killer, killerName) => {
      this.me.ready = false;
      this.tierUps = 0;
      this.log(`sunk by ${killerName || 'a carrier'}`);
    },
    kill: () => {},
    scores: () => {},
    stats: (m) => {
      const id = SHIP_IDS[m.shipId];
      if (id && SHIPS[id] !== this.def) this.useShip(id);
      if (this.opt.passive) return;
      // Spend the money (the server refuses what is not allowed) and climb when possible.
      if (m.canTierUp && this.tierUps < 8) {
        this.tierUps++;
        this.write(() => encodeTierUp(this.out, 0));
        return;
      }
      for (let tries = 0; tries < STAT_COUNT; tries++) {
        const stat = this.nextStat;
        const level = m.levels[stat]!;
        if (level < statCap(m.tier) && m.cash >= statCost(level)) {
          this.nextStat = (this.nextStat + 1) % STAT_COUNT;
          this.write(() => encodeUpgrade(this.out, stat));
          return;
        }
        this.nextStat = (this.nextStat + 1) % STAT_COUNT;
      }
    },
    pickup: () => {},
    pong: () => {},
    reject: (reason) => {
      this.log(`rejected (${reason})`);
    },
    snapshot: (_tick, _seq, self) => {
      this.me.x = self.x;
      this.me.y = self.y;
      this.me.heading = self.heading;
      this.me.hull = self.hull / this.def.hull;
      this.me.shield = self.shield / this.def.shield;
    },
    enter: (e) =>
      (e.id >= PICKUP_ID_BASE ? this.pickups : this.seen).set(e.id, {
        x: e.x,
        y: e.y,
        vx: 0,
        vy: 0,
        team: e.team,
        kind: e.kind,
      }),
    update: (u) => {
      const s = this.seen.get(u.id);
      if (!s) return;
      // Snapshots come every 100 ms; smooth the velocity a little.
      s.vx += ((u.x - s.x) / 0.1 - s.vx) * 0.5;
      s.vy += ((u.y - s.y) / 0.1 - s.vy) * 0.5;
      s.x = u.x;
      s.y = u.y;
    },
    leave: (id) => {
      this.seen.delete(id);
      this.pickups.delete(id);
    },
    projectileSpawn: () => {},
    projectileEnd: () => {},
    shipHit: (_t, target) => {
      if (target === this.me.id) this.hits++;
    },
    shipSunk: () => {},
    bump: () => {},
  };

  /** True when a ship of this bot's size can sail `length` units along `angle` without touching land. */
  private clear(angle: number, length: number): boolean {
    const land = this.land;
    if (!land) return true;
    const { x, y } = this.me;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    for (const lateral of [0, 2.6, -2.6]) {
      const ox = x - s * lateral;
      const oy = y + c * lateral;
      if (segmentVsWorld(land, ox, oy, ox + c * length, oy + s * length) >= 0) return false;
    }
    return true;
  }

  /**
   * What to shoot at, whatever the ship is doing (fleeing bots keep firing back): the nearest enemy
   * ship in range, else the enemy carrier if it is in range. Writes the lead angle and distance
   * into `shot` and returns true, or returns false when nothing is in range.
   */
  private pickShot(nearest: Seen | null, nearestD: number, carrier: Seen | null): boolean {
    const range = this.weaponRange * 0.95;
    const t = nearest && nearestD < range ? nearest : carrier;
    if (!t) return false;
    const d = Math.hypot(t.x - this.me.x, t.y - this.me.y);
    if (d >= range) return false;
    const flight = d / this.shotSpeed;
    this.shot.angle = Math.atan2(t.y + t.vy * flight - this.me.y, t.x + t.vx * flight - this.me.x);
    this.shot.dist = d;
    return true;
  }

  private think(): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.tick++;
    if (this.tick % 40 === 0) this.write(() => encodePing(this.out, this.tick));
    const me = this.me;
    if (!me.ready) return;
    this.seq = (this.seq + 1) & 0xffff;

    if (this.opt.passive) {
      this.sendInput(false, 0, 0, me.heading, 0);
      return;
    }

    // Hurt badly: head home until the shield is back.
    const health =
      (me.hull * this.def.hull + me.shield * this.def.shield) / (this.def.hull + this.def.shield);
    if (health < RETREAT_BELOW) this.retreating = true;
    else if (health > RETREAT_UNTIL) this.retreating = false;

    let nearest: Seen | null = null;
    let nearestD = Infinity;
    let enemyCarrier: Seen | null = null;
    let ownCarrier: Seen | null = null;
    for (const s of this.seen.values()) {
      if (s.kind === KIND.CARRIER) {
        if (s.team === me.team) ownCarrier = s;
        else enemyCarrier = s;
        continue;
      }
      if (s.team === me.team) continue;
      const d = Math.hypot(s.x - me.x, s.y - me.y);
      if (d < nearestD) {
        nearestD = d;
        nearest = s;
      }
    }

    // Free money nearby is worth a detour while nobody is close enough to fight.
    let loot: Seen | null = null;
    let lootD = LOOT_RANGE;
    if (!this.retreating && !(nearest && nearestD < ENGAGE_RANGE)) {
      for (const p of this.pickups.values()) {
        const d = Math.hypot(p.x - me.x, p.y - me.y);
        if (d < lootD) {
          lootD = d;
          loot = p;
        }
      }
    }
    const target: Seen | null = this.retreating
      ? ownCarrier
      : loot
        ? loot
        : nearest && nearestD < ENGAGE_RANGE
          ? nearest
          : (enemyCarrier ?? nearest);
    if (!target) {
      this.sendInput(false, 0, 0.5, me.heading, 0);
      return;
    }
    const canShoot = this.pickShot(nearest, nearestD, enemyCarrier);

    const dist = Math.hypot(target.x - me.x, target.y - me.y);
    // Lead a moving target by the time a shot needs to reach it.
    const flight = dist / this.shotSpeed;
    const aimX = target.x + target.vx * flight;
    const aimY = target.y + target.vy * flight;
    const bearing = Math.atan2(target.y - me.y, target.x - me.x);
    const aimAngle = Math.atan2(aimY - me.y, aimX - me.x);

    // Where to sail: toward the target, then circle it at a comfortable distance.
    const fightingCarrier = target.kind === KIND.CARRIER;
    const standOff = loot
      ? 0
      : this.retreating
        ? 40
        : fightingCarrier
          ? 52
          : this.weaponRange * 0.55;
    let wanted = bearing;
    let throttle = 1;
    if (dist < standOff * 1.2) {
      wanted = bearing + this.side * (1.2 + (dist < standOff * 0.8 ? 0.5 : 0));
      throttle = dist < standOff * 0.6 ? 0.2 : 0.7;
    }
    // Do not wander into the stormy edge of the world.
    if (boundaryDepth(me.x, me.y) > 0.15) {
      wanted = Math.atan2(WORLD_CENTER - me.y, WORLD_CENTER - me.x);
      throttle = 0.8;
    }

    // Steer around land: the first heading (closest to the wanted one) with open water ahead.
    const lookAhead = 22 + this.def.vMax * 1.4;
    let heading = wanted;
    let found = false;
    for (const swerve of SWERVES) {
      const a = wanted + swerve;
      if (this.clear(a, lookAhead)) {
        heading = a;
        found = true;
        break;
      }
    }
    if (!found) {
      // Boxed in: back out.
      this.sendInput(canShoot, 1, -1, this.shot.angle, this.shot.dist);
      return;
    }
    const diff = angleDiff(heading, me.heading);
    const steer = Math.max(-1, Math.min(1, diff * 2.5));
    // Slow down in a sharp turn so the ship can follow.
    if (Math.abs(diff) > 1.2) throttle = Math.min(throttle, 0.4);

    // Shooting does not depend on where the ship is sailing: a retreating bot shoots back.
    if (canShoot) this.sendInput(true, steer, throttle, this.shot.angle, this.shot.dist);
    else this.sendInput(false, steer, throttle, aimAngle, dist);
  }

  private sendInput(
    fire: boolean,
    steer: number,
    throttle: number,
    aim: number,
    dist: number,
  ): void {
    this.write(() =>
      encodeInput(
        this.out,
        this.seq,
        fire,
        qAxis(steer),
        qAxis(throttle),
        qAngle16(((aim % TAU) + TAU) % TAU),
        qAimDist(dist),
      ),
    );
  }
}
