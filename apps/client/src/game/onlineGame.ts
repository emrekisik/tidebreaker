import type { Scene } from 'three';
import {
  CARRIER,
  END_REASON,
  FX,
  KIND,
  MAX_PROJECTILES,
  PICKUP_ID_BASE,
  ProjectileSet,
  SHIPS,
  SHIP_IDS,
  STEP_MS,
  STAT,
  STAT_COUNT,
  STEP_SEC,
  TEAM_BLUE,
  WEAPONS,
  WEAPON_IDS,
  configHash,
  createCombatant,
  dqAxis,
  generateMap,
  pickCarrierTarget,
  qAimDist,
  qAngle16,
  qAxis,
  segmentVsWorld,
} from '@tidebreaker/shared';
import type {
  Combatant,
  EnterEntry,
  ScoreEntry,
  HitSink,
  Obstacles,
  SelfState,
  ServerHandler,
  ShipDef,
  StatsMsg,
  UpdateEntry,
  WelcomeMsg,
  WorldMap,
} from '@tidebreaker/shared';
import { ShipEntity } from '../frame/entity.ts';
import { HealthBar } from '../frame/healthBar.ts';
import type { PickupView } from '../frame/pickupView.ts';
import { ServerClock } from '../net/clock.ts';
import { SnapshotBuffer } from '../net/interpolation.ts';
import type { PoseSample } from '../net/interpolation.ts';
import { NetClient } from '../net/netClient.ts';
import { Predictor } from '../net/prediction.ts';
import { ShotTable } from '../net/shotTable.ts';
import type { AssetProvider } from '../render/assets.ts';
import type { BarKit } from '../render/barKit.ts';
import type { GameEvents } from './localGame.ts';
import type { GameSession, ProjectileLayer } from './session.ts';

/** Other players are shown this far in the past, so jitter never makes them stutter (§10.5). */
export const INTERP_DELAY_MS = 150;
const PING_EVERY_MS = 2000;
/** A shot fired by you is caught up by at most this many ticks when it is shown. */
const CATCH_UP_MAX = 10;

type TeamName = 'blue' | 'red';

/** What the game tells the UI beyond the effects shared with the sandbox. */
export interface OnlineEvents extends GameEvents {
  /** A ship went down (anyone's, carriers included). */
  onSunk(entity: ShipEntity, x: number, y: number): void;
  /** The player was sunk. */
  onDied(killerId: number, killerName: string, respawnSec: number): void;
  onMatch(
    state: number,
    winner: number,
    restartSec: number,
    killsBlue: number,
    killsRed: number,
  ): void;
  /** Someone sank someone (kill feed). */
  onKill(
    killerId: number,
    victimId: number,
    killerTeam: number,
    victimTeam: number,
    weapon: number,
    killerName: string,
    victimName: string,
  ): void;
  /** The scoreboard of the round. */
  onScores(rows: ScoreEntry[], myId: number): void;
  /** Score, money or upgrades of the player changed. */
  onStats(m: StatsMsg): void;
  /** The player picked something up. */
  onPickup(kind: number, value: number, x: number, y: number): void;
  /** The player (re)spawned. */
  onJoined(team: number, shipIdx: number): void;
  /** The connection is gone (after the game started). */
  onClosed(): void;
}

/** Why the connection attempt failed (shown on the menu). */
export type ConnectError = 'failed' | 'version' | 'full' | 'name' | 'closed' | 'rate' | 'other';

interface Remote {
  entity: ShipEntity;
  buf: SnapshotBuffer;
  kind: number;
  name: string;
  /** Last time this ship fired (server ms): its turrets point at the shot, then back to the bow. */
  lastFireMs: number;
  /** Told to leave, waiting for its sinking animation. */
  leaving: boolean;
}

interface Action {
  time: number;
  run: () => void;
}

const noopHits: HitSink = { onHit() {}, onExpire() {}, onBlocked() {} };
const noTargets: Combatant[] = [];
const teamName = (team: number): TeamName => (team === TEAM_BLUE ? 'blue' : 'red');

export interface OnlineDeps {
  scene: Scene;
  assets: AssetProvider;
  bars: BarKit;
  pickups: PickupView;
  events: OnlineEvents;
  url: string;
  name: string;
  shipIdx: number;
}

/**
 * A match on a server (GAME_DESIGN.md §10.5). Your own ship is predicted with the shared sim and
 * corrected by snapshots; everything else is shown 150 ms in the past, interpolated between
 * snapshots. Shots are simulated here from the server's spawn events (nothing is predicted that
 * the server could disagree about): yours at once, the others on the delayed timeline.
 */
export class OnlineGame implements GameSession, ServerHandler {
  readonly entities: ShipEntity[] = [];
  readonly layers: ProjectileLayer[];
  land!: WorldMap;
  player!: ShipEntity;
  kills = 0;
  ticks = 0;
  myId = 0;
  myTeam = 0;
  teamKills: number[] = [0, 0];
  /** The player's own score, money and upgrades, as the server last said. */
  readonly progress: StatsMsg = {
    score: 0,
    cash: 0,
    tier: 0,
    shipId: 0,
    levels: new Uint8Array(STAT_COUNT),
    maxHull: 1,
    maxShield: 1,
    canTierUp: false,
  };
  readonly clock = new ServerClock();
  predictor!: Predictor;
  net!: NetClient;
  /** Server ticks seen so far (debug). */
  latestTick = 0;

  private readonly deps: OnlineDeps;
  private readonly others = new ProjectileSet(MAX_PROJECTILES);
  private readonly mine = new ProjectileSet(MAX_PROJECTILES);
  /** Which shot an id means, and where it lives (see ShotTable). */
  private readonly shots = new ShotTable(MAX_PROJECTILES);
  private obstacles: Obstacles | null = null;
  private readonly remotes = new Map<number, Remote>();
  private readonly queue: Action[] = [];
  private readonly sample: PoseSample = { x: 0, y: 0, heading: 0, speed: 0, hp: 1, shield: 1 };
  private readonly combatants: Combatant[] = [];
  private projTick = -1;
  private curTime = 0;
  private seq = 0;
  private awaitSpawn = true;
  private lastPing = 0;
  private resolveJoin: (() => void) | null = null;
  private rejectJoin: ((e: ConnectError) => void) | null = null;
  private joined_ = false;
  private shipIdx = 0;

  constructor(deps: OnlineDeps) {
    this.deps = deps;
    this.shipIdx = deps.shipIdx;
    this.layers = [
      { set: this.others, alpha: 0 },
      { set: this.mine, alpha: 0 },
    ];
  }

  /** Connects, plays and resolves once the server has put the player into the world. */
  connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.resolveJoin = resolve;
      this.rejectJoin = reject;
      this.net = new NetClient(this.deps.url, this, {
        open: () => this.net.hello(),
        close: (why) => {
          if (!this.joined_) this.fail(why === 'failed' ? 'failed' : 'closed');
          else this.deps.events.onClosed();
        },
      });
    });
  }

  private fail(error: ConnectError): void {
    const r = this.rejectJoin;
    this.resolveJoin = null;
    this.rejectJoin = null;
    this.net?.close();
    r?.(error);
  }

  /** Changes the class (the server respawns the player at the carrier). */
  changeShip(shipIdx: number): void {
    this.shipIdx = shipIdx;
    this.net.play(this.deps.name, shipIdx);
  }

  close(): void {
    this.net.close();
  }

  // ---- fixed step: the player's own ship

  step(steer: number, throttle: number, aim: number, aimDist: number, fire: boolean): void {
    if (!this.player) return;
    this.ticks++;
    const s = this.predictor.state;
    this.player.pose.capture(s.x, s.y, s.heading);
    // The server sees quantized controls, so the prediction uses the very same values.
    const mx = qAxis(steer);
    const my = qAxis(throttle);
    this.seq = (this.seq + 1) & 0xffff;
    this.predictor.apply(this.seq, dqAxis(mx), dqAxis(my));
    this.net.input(this.seq, fire, mx, my, qAngle16(aim), qAimDist(aimDist));
    this.player.aim = aim;
    this.player.aimDist = aimDist;
    this.mine.step(STEP_SEC, noTargets, noopHits, this.obstacles ?? undefined);
  }

  // ---- every frame: the delayed world

  frame(nowMs: number, dtSec: number, fixedAlpha: number): void {
    this.net.tick(nowMs);
    if (nowMs - this.lastPing > PING_EVERY_MS) {
      this.lastPing = nowMs;
      this.net.ping(nowMs);
    }
    this.layers[1]!.alpha = fixedAlpha;
    if (!this.player) return;
    this.predictor.frame(dtSec);
    this.player.visualOffsetX = this.predictor.offsetX;
    this.player.visualOffsetY = this.predictor.offsetY;
    if (!this.clock.isReady) return;

    const renderTime = this.clock.serverNow(nowMs) - INTERP_DELAY_MS;
    const targetTick = Math.floor(renderTime / STEP_MS);
    if (this.projTick < 0) this.projTick = targetTick - 1;
    while (this.projTick < targetTick) {
      this.projTick++;
      this.processUntil(this.projTick * STEP_MS);
      this.others.step(STEP_SEC, noTargets, noopHits, this.obstacles ?? undefined);
    }
    this.processUntil(renderTime);
    this.layers[0]!.alpha = Math.min(
      1,
      Math.max(0, (renderTime - this.projTick * STEP_MS) / STEP_MS),
    );

    this.combatants.length = 0;
    this.combatants.push(this.player.combatant);
    for (const [id, r] of this.remotes) {
      const e = r.entity;
      const s = e.combatant.state;
      if (r.buf.sample(renderTime, this.sample)) {
        s.x = this.sample.x;
        s.y = this.sample.y;
        s.heading = this.sample.heading;
        s.speed = this.sample.speed;
        s.hull = this.sample.hp * e.combatant.def.hull;
        s.shield = this.sample.shield * e.combatant.def.shield;
        e.pose.snap(s.x, s.y, s.heading);
      }
      // Turrets point where the ship last fired, then settle back toward the bow.
      if (renderTime - r.lastFireMs > 1500) e.aim = s.heading;
      this.combatants.push(e.combatant);
      if (r.leaving && !s.alive && e.sinkSeconds >= 2) this.removeRemote(id);
    }
    // Carrier turrets choose their own targets, with the same rule the server uses.
    for (const r of this.remotes.values()) {
      const aims = r.entity.mountAims;
      if (!aims) continue;
      const def = r.entity.combatant.def;
      for (let m = 0; m < def.mounts.length; m++) {
        if (
          pickCarrierTarget(r.entity.combatant, m, this.combatants, aims.subarray(m, m + 1)) < 0
        ) {
          aims[m] = r.entity.combatant.state.heading;
        }
      }
    }
  }

  // ---- scheduling on the server's timeline

  private at(timeMs: number, run: () => void): void {
    let i = this.queue.length;
    while (i > 0 && this.queue[i - 1]!.time > timeMs) i--;
    this.queue.splice(i, 0, { time: timeMs, run });
  }

  private processUntil(timeMs: number): void {
    while (this.queue.length > 0 && this.queue[0]!.time <= timeMs) this.queue.shift()!.run();
  }

  // ---- messages: connection

  welcome(m: WelcomeMsg): void {
    if (m.configHash !== configHash()) {
      this.fail('version');
      return;
    }
    this.land = generateMap(m.mapSeed);
    this.obstacles = { segmentHit: (a, b, c, d) => segmentVsWorld(this.land, a, b, c, d) };
    this.net.play(this.deps.name, this.deps.shipIdx);
  }

  reject(reason: number): void {
    // 1 version, 2 room full, 3 bad name, 4 rate, 5 banned, 6 config
    const map: Record<number, ConnectError> = {
      1: 'version',
      2: 'full',
      3: 'name',
      4: 'rate',
      6: 'version',
    };
    this.fail(map[reason] ?? 'other');
  }

  pong(clientTime: number): void {
    const now = Math.floor(performance.now()) >>> 0;
    this.clock.onPong(clientTime, clientTime + ((now - clientTime) >>> 0));
  }

  joined(entityId: number, team: number, shipId: number): void {
    const def = SHIPS[SHIP_IDS[shipId]!] as ShipDef;
    this.myId = entityId;
    this.myTeam = team;
    this.shipIdx = shipId;
    const d = this.deps;
    if (!this.player) {
      this.predictor = new Predictor(def, this.land, entityId);
      const combatant = createCombatant(entityId, def, team);
      combatant.state = this.predictor.state;
      const model = d.assets.createShip(def.modelKey, teamName(team), true);
      this.player = new ShipEntity(combatant, model, null);
      d.scene.add(model.root);
      this.entities.unshift(this.player);
    } else {
      const c = this.player.combatant;
      if (c.def !== def) {
        d.scene.remove(this.player.model.root);
        const model = d.assets.createShip(def.modelKey, teamName(team), true);
        d.scene.add(model.root);
        this.player.setModel(model);
        c.def = def;
        this.predictor.def = def;
      }
      c.team = team;
    }
    // The new ship appears where the next snapshot says.
    this.awaitSpawn = true;
    this.predictor.enabled = true;
    this.player.combatant.state.alive = true;
    this.player.sinkSeconds = 0;
    d.events.onJoined(team, shipId);
    if (!this.joined_) {
      this.joined_ = true;
      this.resolveJoin?.();
      this.resolveJoin = null;
      this.rejectJoin = null;
    }
  }

  match(
    state: number,
    winner: number,
    restartSec: number,
    killsBlue: number,
    killsRed: number,
  ): void {
    this.teamKills[0] = killsBlue;
    this.teamKills[1] = killsRed;
    this.kills = this.teamKills[this.myTeam] ?? 0;
    this.deps.events.onMatch(state, winner, restartSec, killsBlue, killsRed);
  }

  youDied(killerId: number, killerName: string, respawnSec: number): void {
    if (!this.player) return;
    this.predictor.enabled = false;
    this.player.combatant.state.alive = false;
    this.deps.events.onDied(killerId, killerName, respawnSec);
  }

  kill(
    killerId: number,
    victimId: number,
    killerTeam: number,
    victimTeam: number,
    weapon: number,
    killerName: string,
    victimName: string,
  ): void {
    this.deps.events.onKill(
      killerId,
      victimId,
      killerTeam,
      victimTeam,
      weapon,
      killerName,
      victimName,
    );
  }

  scores(rows: ScoreEntry[]): void {
    this.deps.events.onScores(rows, this.myId);
  }

  stats(m: StatsMsg): void {
    const p = this.progress;
    p.score = m.score;
    p.cash = m.cash;
    p.tier = m.tier;
    p.shipId = m.shipId;
    p.levels.set(m.levels);
    p.maxHull = m.maxHull;
    p.maxShield = m.maxShield;
    p.canTierUp = m.canTierUp;
    if (this.predictor) {
      this.predictor.speedLevel = m.levels[STAT.SPEED]!;
      this.predictor.turnLevel = m.levels[STAT.TURN]!;
    }
    // A class jump while sailing: new model, same place. (A sunk ship changes at its respawn.)
    if (this.player && this.player.combatant.state.alive && !this.awaitSpawn) {
      this.swapShip(m.shipId);
    }
    this.deps.events.onStats(p);
  }

  private swapShip(shipId: number): void {
    const def = SHIPS[SHIP_IDS[shipId]!] as ShipDef;
    const c = this.player.combatant;
    if (c.def === def) return;
    const d = this.deps;
    d.scene.remove(this.player.model.root);
    const model = d.assets.createShip(def.modelKey, teamName(this.myTeam), true);
    d.scene.add(model.root);
    this.player.setModel(model);
    c.def = def;
    this.predictor.def = def;
    this.shipIdx = shipId;
  }

  pickup(
    _tick: number,
    _id: number,
    collector: number,
    kind: number,
    value: number,
    x: number,
    y: number,
  ): void {
    if (collector === this.myId) this.deps.events.onPickup(kind, value, x, y);
  }

  // ---- messages: snapshots

  snapshot(tick: number, lastInputSeq: number, self: SelfState): void {
    if (!this.player) return;
    this.latestTick = tick;
    this.curTime = tick * STEP_MS;
    this.clock.onServerTime(this.curTime, performance.now());
    if (this.awaitSpawn) {
      this.predictor.reset(self.x, self.y, self.heading);
      const s = this.predictor.state;
      s.hull = self.hull;
      s.shield = self.shield;
      s.alive = true;
      this.player.pose.snap(s.x, s.y, s.heading);
      this.awaitSpawn = false;
      return;
    }
    this.predictor.reconcile(self, lastInputSeq);
  }

  enter(e: EnterEntry): void {
    if (e.id >= PICKUP_ID_BASE) {
      this.deps.pickups.add(e.id, e.kind, e.shipId, e.x, e.y);
      return;
    }
    const old = this.remotes.get(e.id);
    if (old) this.removeRemote(e.id);
    const d = this.deps;
    const def = e.kind === KIND.CARRIER ? CARRIER : (SHIPS[SHIP_IDS[e.shipId]!] as ShipDef);
    const combatant = createCombatant(e.id, def, e.team);
    combatant.state.x = e.x;
    combatant.state.y = e.y;
    combatant.state.heading = e.heading;
    const model = d.assets.createShip(def.modelKey, teamName(e.team), false);
    const bar = new HealthBar(
      d.scene,
      d.bars,
      teamName(e.team),
      e.kind === KIND.CARRIER ? undefined : e.name,
    );
    const entity = new ShipEntity(combatant, model, bar);
    entity.aim = e.heading;
    if (e.kind === KIND.CARRIER) entity.mountAims = new Float32Array(def.mounts.length);
    d.scene.add(model.root);
    this.entities.push(entity);
    const buf = new SnapshotBuffer();
    buf.push(this.curTime, e.x, e.y, e.heading, 0, e.hp, e.shield);
    this.remotes.set(e.id, {
      entity,
      buf,
      kind: e.kind,
      name: e.name,
      lastFireMs: -1e9,
      leaving: false,
    });
  }

  update(u: UpdateEntry): void {
    this.remotes.get(u.id)?.buf.push(this.curTime, u.x, u.y, u.heading, u.speed, u.hp, u.shield);
  }

  leave(id: number): void {
    if (id >= PICKUP_ID_BASE) {
      this.deps.pickups.remove(id);
      return;
    }
    // The ship that is leaving is the one known right now: the same id may come back in this very
    // snapshot (a respawn or class jump), and that new ship must stay.
    const leaving = this.remotes.get(id);
    this.at(this.curTime, () => {
      const r = this.remotes.get(id);
      if (!r || r !== leaving) return;
      // A ship that is sinking finishes its animation first.
      if (!r.entity.combatant.state.alive) r.leaving = true;
      else this.removeRemote(id);
    });
  }

  private removeRemote(id: number): void {
    const r = this.remotes.get(id);
    if (!r) return;
    const d = this.deps;
    d.scene.remove(r.entity.model.root);
    r.entity.bar?.remove(d.scene);
    const at = this.entities.indexOf(r.entity);
    if (at >= 0) this.entities.splice(at, 1);
    this.remotes.delete(id);
  }

  /** Name of a ship by entity id (kill messages). */
  nameOf(id: number): string {
    return this.remotes.get(id)?.name ?? '';
  }

  // ---- messages: events

  /** Your own ship and shots live in the present; everything else on the delayed timeline. */
  private entityOf(id: number): ShipEntity | undefined {
    return id === this.myId ? this.player : this.remotes.get(id)?.entity;
  }

  projectileSpawn(
    tick: number,
    id: number,
    owner: number,
    weapon: number,
    x: number,
    y: number,
    angle: number,
    power: number,
  ): void {
    if (id >= MAX_PROJECTILES) return;
    const def = WEAPONS[WEAPON_IDS[weapon]!];
    if (!def) return;
    const events = this.deps.events;
    const launch = (set: ProjectileSet): number => {
      const slot = set.spawn(
        x,
        y,
        angle,
        def.projectileSpeed * def.startSpeedPct,
        def.range,
        def.radius,
        def.damage,
        owner,
        weapon,
      );
      // The damage upgrade makes the shot thicker.
      set.power[slot] = power;
      return slot;
    };
    const mine = owner === this.myId;
    this.shots.noteSpawn(id, mine, weapon);
    if (mine) {
      // Yours: shown right away, caught up by the time the message spent on the way.
      const slot = launch(this.mine);
      const nowTick = Math.floor(this.clock.serverNow(performance.now()) / STEP_MS);
      const late = Math.max(0, Math.min(CATCH_UP_MAX, nowTick - tick));
      this.mine.advance(slot, late, STEP_SEC, noopHits, this.obstacles ?? undefined);
      this.shots.bind(id, true, slot);
      events.onShot(x, y, angle, weapon);
      return;
    }
    this.at(tick * STEP_MS, () => {
      const slot = launch(this.others);
      this.shots.bind(id, false, slot);
      const shooter = this.remotes.get(owner);
      if (shooter) {
        shooter.entity.aim = angle;
        shooter.lastFireMs = tick * STEP_MS;
      }
      events.onShot(x, y, angle, weapon);
    });
  }

  projectileEnd(tick: number, id: number, reason: number, x: number, y: number): void {
    if (id >= MAX_PROJECTILES) return;
    const events = this.deps.events;
    // Whose shot this is is decided now, in message order, not when the delayed action runs.
    const mine = this.shots.isMine(id);
    const weapon = this.shots.weaponOf(id);
    const finish = (): void => {
      const slot = this.shots.take(id, mine);
      if (slot >= 0) (mine ? this.mine : this.others).remove(slot);
      if (reason === END_REASON.HIT_ISLAND) events.onBlocked(x, y, weapon);
      else if (reason === END_REASON.EXPIRED) events.onMiss(x, y, weapon);
    };
    if (mine) finish();
    else this.at(tick * STEP_MS, finish);
  }

  shipHit(
    tick: number,
    target: number,
    attacker: number,
    damage: number,
    shield: boolean,
    weapon: number,
    x: number,
    y: number,
  ): void {
    const apply = (): void => {
      const e = this.entityOf(target);
      if (!e) return;
      e.flashSeconds = FX.hitFlashSec;
      this.deps.events.onHit(
        x,
        y,
        damage,
        shield,
        false,
        e,
        weapon,
        attacker === this.myId || target === this.myId,
      );
    };
    if (target === this.myId) apply();
    else this.at(tick * STEP_MS, apply);
  }

  shipSunk(tick: number, id: number, _killer: number, x: number, y: number): void {
    const apply = (): void => {
      const e = this.entityOf(id);
      if (!e) return;
      e.combatant.state.alive = false;
      this.deps.events.onSunk(e, x, y);
    };
    if (id === this.myId) apply();
    else this.at(tick * STEP_MS, apply);
  }

  bump(tick: number, ship: number, other: number, x: number, y: number, impact: number): void {
    const apply = (): void => {
      const a = this.entityOf(ship);
      if (!a) return;
      if (other === 0xffff) {
        this.deps.events.onIslandHit(x, y, impact, a);
        return;
      }
      const b = this.entityOf(other);
      if (b) this.deps.events.onCollision(x, y, impact, a, b, 0, 0, false, false);
    };
    if (ship === this.myId || other === this.myId) apply();
    else this.at(tick * STEP_MS, apply);
  }
}
