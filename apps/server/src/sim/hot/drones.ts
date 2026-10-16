import {
  DEG2RAD,
  DRONE,
  DRONE_TYPES,
  MATCH,
  Mulberry32,
  PIRATE,
  STEP_SEC,
  TAU,
  WEAPONS,
  WORLD_SIZE,
  angleDiff,
  clamp,
  resetShipState,
} from '@tidebreaker/shared';
import type { World } from './world.ts';

/** Slots drones may use: every player may have `DRONE.perPlayer` of them. */
export const DRONE_SLOTS = MATCH.maxPlayers * DRONE.perPlayer;

const FREE = -1;
const THINK_SEC = DRONE.thinkEveryTicks * STEP_SEC;
/** A drone shoots once its nose is this close (radians) to the aim direction. */
const AIM_OK = 8 * DEG2RAD;
const EDGE = 12;
/** Above this speed (units/s) a drone faces the way it moves. */
const MOVE_FACE_SPEED = 1.8;

/**
 * The drones of a room (GAME_DESIGN.md §7.3). A drone belongs to a player, hovers around them and
 * attacks the nearest enemy that comes close, as long as the enemy is not too far from the owner
 * and not under the enemy carrier's guns. It is a combatant like a ship, so shots hit it, its gun
 * is an ordinary mount, and it dies when its hull is gone, when its owner sinks or leaves, or when
 * the round restarts. It flies: no islands, no collisions. Plain data in typed arrays; lives in
 * `hot/`, so no allocation.
 *
 * Drones occupy the last entity slots of the world (`World.pirateEnd` and up).
 */
export class Drones {
  /** Slot of the owner, or FREE. */
  readonly owner = new Int16Array(DRONE_SLOTS).fill(FREE);
  /** Index into `DRONE_TYPES`. */
  readonly type = new Uint8Array(DRONE_SLOTS);
  /** Number of drones each slot owns. */
  readonly countOf: Uint8Array;
  private readonly vx = new Float32Array(DRONE_SLOTS);
  private readonly vy = new Float32Array(DRONE_SLOTS);
  /** Where in its circle around the owner the drone rests (radians). */
  private readonly phase = new Float32Array(DRONE_SLOTS);
  /** Slot of the enemy being attacked, or -1. */
  private readonly target = new Int16Array(DRONE_SLOTS).fill(-1);
  /** Where it flies to (updated when thinking) and the direction it wants to face. */
  private readonly goalX = new Float32Array(DRONE_SLOTS);
  private readonly goalY = new Float32Array(DRONE_SLOTS);
  private readonly face = new Float32Array(DRONE_SLOTS);
  private readonly noise = new Float32Array(DRONE_SLOTS);
  /** Per type: preferred fighting distance, farthest firing distance, shot speed. */
  private readonly fightDist = new Float32Array(DRONE_TYPES.length);
  private readonly fireRange = new Float32Array(DRONE_TYPES.length);
  private readonly shotSpeed = new Float32Array(DRONE_TYPES.length);
  private active = 0;

  private readonly rng: Mulberry32;

  constructor(
    private readonly w: World,
    seed: number,
  ) {
    this.rng = new Mulberry32(seed ^ 0x2c1b3c6d);
    this.countOf = new Uint8Array(w.slotCount);
    for (let t = 0; t < DRONE_TYPES.length; t++) {
      const weapon = WEAPONS[DRONE_TYPES[t]!.def.mounts[0]!.weapon];
      this.fireRange[t] = weapon.range;
      this.fightDist[t] = weapon.range * DRONE.fightDistFactor;
      this.shotSpeed[t] = weapon.projectileSpeed;
    }
  }

  slotOf(d: number): number {
    return this.w.pirateEnd + d;
  }

  /** The drone index of an entity slot, or -1 when the slot is not a drone. */
  indexOf(slot: number): number {
    return slot >= this.w.pirateEnd && slot < this.w.slotCount ? slot - this.w.pirateEnd : -1;
  }

  /** Number of drones in the air. */
  get count(): number {
    return this.active;
  }

  /** Launches a drone of `type` for `owner` from its carrier. Returns false when no slot is free. */
  spawn(owner: number, type: number): boolean {
    const w = this.w;
    let d = 0;
    while (d < DRONE_SLOTS && this.owner[d] !== FREE) d++;
    if (d === DRONE_SLOTS) return false;
    const slot = this.slotOf(d);
    const o = w.slots[owner]!;
    const t = DRONE_TYPES[type]!;
    const carrier = w.slots[o.team]!.state;
    const c = w.slots[slot]!;
    c.def = t.def;
    c.team = o.team;
    resetShipState(c.state, t.def, carrier.x, carrier.y, Math.atan2(o.state.y - carrier.y, o.state.x - carrier.x));
    this.owner[d] = owner;
    this.type[d] = type;
    this.countOf[owner] = this.countOf[owner]! + 1;
    // The drones of one owner rest on opposite sides of the circle.
    this.phase[d] = this.countOf[owner]! % 2 === 0 ? Math.PI : 0;
    this.target[d] = -1;
    this.vx[d] = 0;
    this.vy[d] = 0;
    this.face[d] = c.state.heading;
    w.used[slot] = 1;
    w.shipIdx[slot] = type;
    w.spawnGen[slot] = w.spawnGen[slot]! + 1;
    // Leaving the carrier: untouchable (and, as for ships, protection ends with the first shot).
    w.protectLeft[slot] = DRONE.launchSec;
    w.inFire[slot] = 0;
    w.clearAssists(slot);
    w.combatants.push(c);
    this.active++;
    return true;
  }

  /** Takes drone `d` out of the world (sunk, owner gone, new round). */
  remove(d: number): void {
    if (this.owner[d] === FREE) return;
    const w = this.w;
    const slot = this.slotOf(d);
    const c = w.slots[slot]!;
    const o = this.owner[d]!;
    this.countOf[o] = Math.max(0, this.countOf[o]! - 1);
    this.owner[d] = FREE;
    this.target[d] = -1;
    c.state.alive = false;
    w.used[slot] = 0;
    w.inFire[slot] = 0;
    const at = w.combatants.indexOf(c);
    if (at >= 0) w.combatants.splice(at, 1);
    this.active--;
    w.statsDirty[o] = 1;
  }

  /** Every drone of `owner` goes down with them; `explode` tells the clients so they show it. */
  removeAllOf(owner: number, explode: boolean): void {
    for (let d = 0; d < DRONE_SLOTS; d++) {
      if (this.owner[d] !== owner) continue;
      if (explode) {
        const s = this.w.slots[this.slotOf(d)]!;
        this.w.events.shipSunk(s.id, 0, s.state.x, s.state.y);
      }
      this.remove(d);
    }
  }

  /** A new round: no drones. */
  clear(): void {
    for (let d = 0; d < DRONE_SLOTS; d++) this.remove(d);
  }

  /** One tick: think (a few per tick), then fly and aim (every tick). */
  step(dt: number): void {
    if (this.active === 0) return;
    const w = this.w;
    for (let d = 0; d < DRONE_SLOTS; d++) {
      if (this.owner[d] === FREE) continue;
      const slot = this.slotOf(d);
      const c = w.slots[slot]!;
      if (!c.state.alive) continue;
      if (w.protectLeft[slot]! > 0) w.protectLeft[slot] = Math.max(0, w.protectLeft[slot]! - dt);
      if ((w.tick + d) % DRONE.thinkEveryTicks === 0) this.think(d, slot);
      this.act(d, slot, dt);
    }
  }

  // ---- thinking

  private think(d: number, slot: number): void {
    const w = this.w;
    const c = w.slots[slot]!;
    const s = c.state;
    const o = w.slots[this.owner[d]!]!.state;
    const t = this.type[d]!;
    this.noise[d] = (this.rng.next() * 2 - 1) * DRONE.aimErrorDeg * DEG2RAD;

    // Keep the target while it stays valid, otherwise look for the nearest enemy.
    let cur = this.target[d]!;
    if (cur >= 0 && !this.valid(c.team, cur, s.x, s.y, o.x, o.y, DRONE.detectRadius * 1.3)) cur = -1;
    if (cur < 0) {
      let bestD2 = DRONE.detectRadius * DRONE.detectRadius;
      for (let j = 0; j < w.combatants.length; j++) {
        const e = w.combatants[j]!;
        const es = e.id - 1;
        if (!this.valid(c.team, es, s.x, s.y, o.x, o.y, DRONE.detectRadius)) continue;
        const d2 = (e.state.x - s.x) * (e.state.x - s.x) + (e.state.y - s.y) * (e.state.y - s.y);
        if (d2 < bestD2) {
          bestD2 = d2;
          cur = es;
        }
      }
    }
    this.target[d] = cur;

    if (cur >= 0) {
      // Fighting: straight at the enemy up to the preferred distance (an attack run: the nose points
      // where it flies, so the gun is on the target when it arrives).
      const ts = w.slots[cur]!.state;
      const dx = s.x - ts.x;
      const dy = s.y - ts.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      this.goalX[d] = ts.x + (dx / dist) * this.fightDist[t]!;
      this.goalY[d] = ts.y + (dy / dist) * this.fightDist[t]!;
      // Lead the target by the time a shot needs to reach it.
      const flight = dist / this.shotSpeed[t]!;
      const tvx = Math.cos(ts.heading) * ts.speed + ts.kx;
      const tvy = Math.sin(ts.heading) * ts.speed + ts.ky;
      this.face[d] = Math.atan2(ts.y + tvy * flight - s.y, ts.x + tvx * flight - s.x);
    } else {
      // Resting: a spot on a slowly turning circle around the owner.
      const a = this.phase[d]! + (w.tick * STEP_SEC * TAU) / DRONE.orbitSec;
      this.goalX[d] = o.x + Math.cos(a) * DRONE.orbitRadius + Math.cos(o.heading) * o.speed * THINK_SEC;
      this.goalY[d] = o.y + Math.sin(a) * DRONE.orbitRadius + Math.sin(o.heading) * o.speed * THINK_SEC;
      this.face[d] = s.heading;
    }
  }

  /** An enemy a drone of `team` may attack: alive, hostile, in reach, in the owner's neighbourhood, away from carrier guns. */
  private valid(
    team: number,
    slot: number,
    x: number,
    y: number,
    ox: number,
    oy: number,
    range: number,
  ): boolean {
    const w = this.w;
    if (slot < MATCH.carriers.length || slot >= w.slotCount || w.used[slot] === 0) return false;
    const e = w.slots[slot]!;
    if (!e.state.alive || e.team === team || w.protectLeft[slot]! > 0 || e.def.vMax === 0) return false;
    const ex = e.state.x;
    const ey = e.state.y;
    if ((ex - x) * (ex - x) + (ey - y) * (ey - y) > range * range) return false;
    if ((ex - ox) * (ex - ox) + (ey - oy) * (ey - oy) > DRONE.leash * DRONE.leash) return false;
    for (let k = 0; k < MATCH.carriers.length; k++) {
      if (k === team) continue;
      const base = MATCH.carriers[k]!;
      if (Math.hypot(ex - base.x, ey - base.y) < PIRATE.carrierAvoid) return false;
    }
    return true;
  }

  // ---- acting (every tick)

  private act(d: number, slot: number, dt: number): void {
    const w = this.w;
    const c = w.slots[slot]!;
    const s = c.state;
    const def = c.def;
    // Velocity: toward the goal, fast when far, easing in near it; it hovers, so heading and
    // movement are independent.
    const gx = this.goalX[d]! - s.x;
    const gy = this.goalY[d]! - s.y;
    const gd = Math.sqrt(gx * gx + gy * gy);
    const want = Math.min(def.vMax, gd * 2.4);
    const k = gd > 0.001 ? want / gd : 0;
    let dvx = gx * k - this.vx[d]!;
    let dvy = gy * k - this.vy[d]!;
    const dl = Math.sqrt(dvx * dvx + dvy * dvy);
    const maxDv = DRONE.accel * dt;
    if (dl > maxDv) {
      dvx = (dvx / dl) * maxDv;
      dvy = (dvy / dl) * maxDv;
    }
    this.vx[d] = (this.vx[d]! + dvx) * (1 - DRONE.drag * dt * 0.3);
    this.vy[d] = (this.vy[d]! + dvy) * (1 - DRONE.drag * dt * 0.3);
    s.x = clamp(s.x + this.vx[d]! * dt, EDGE, WORLD_SIZE - EDGE);
    s.y = clamp(s.y + this.vy[d]! * dt, EDGE, WORLD_SIZE - EDGE);
    s.speed = Math.sqrt(this.vx[d]! * this.vx[d]! + this.vy[d]! * this.vy[d]!);

    // Heading: the nose points where the drone flies; only when it hovers (nearly) still does it
    // turn toward what it wants to face (the enemy it is shooting at). Turn rate is limited.
    const flying = s.speed > MOVE_FACE_SPEED;
    const wantHeading = flying ? Math.atan2(this.vy[d]!, this.vx[d]!) : this.face[d]!;
    const turn = def.turnRateDeg * DEG2RAD * dt;
    s.heading += clamp(angleDiff(wantHeading, s.heading), -turn, turn);

    // Shooting.
    w.inFire[slot] = 0;
    const target = this.target[d]!;
    if (target < 0) return;
    const ts = w.slots[target]!.state;
    if (!ts.alive) return;
    const dx = ts.x - s.x;
    const dy = ts.y - s.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    w.inAim[slot] = this.face[d]! + this.noise[d]!;
    w.inAimDist[slot] = dist;
    if (dist < this.fireRange[this.type[d]!]! * 0.95 && Math.abs(angleDiff(this.face[d]!, s.heading)) < AIM_OK) {
      w.inFire[slot] = 1;
    }
  }
}
