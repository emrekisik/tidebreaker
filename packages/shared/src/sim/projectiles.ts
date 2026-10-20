import { WEAPONS, WEAPON_IDS } from '../config/weapons.ts';
import type { WeaponDef } from '../config/weapons.ts';
import { DEG2RAD, angleDiff } from '../math/angle.ts';
import { applyDamage, HIT_KILLED, HIT_SHIELD } from './damage.ts';
import type { ProjectileSink } from './mounts.ts';
import { NO_TEAM } from './types.ts';
import type { Combatant } from './types.ts';

/**
 * Earliest parameter t in [0, 1] at which the segment (x0,y0)+t*(dx,dy) touches the circle
 * (cx,cy,r), or -1 for no contact. Swept test, so fast projectiles cannot tunnel.
 */
export function sweptSegmentCircle(
  x0: number,
  y0: number,
  dx: number,
  dy: number,
  cx: number,
  cy: number,
  r: number,
): number {
  const fx = x0 - cx;
  const fy = y0 - cy;
  const c = fx * fx + fy * fy - r * r;
  if (c <= 0) return 0; // already overlapping at the start
  const a = dx * dx + dy * dy;
  if (a < 1e-12) return -1;
  const b = fx * dx + fy * dy;
  const disc = b * b - a * c;
  if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / a;
  return t >= 0 && t <= 1 ? t : -1;
}

/** Static things that stop projectiles (islands, reefs). */
export interface Obstacles {
  /** First entry of the segment into an obstacle as a fraction 0..1, or -1 for open water. */
  segmentHit(x0: number, y0: number, x1: number, y1: number): number;
}

/** Receives hit results from `ProjectileSet.step`. */
export interface HitSink {
  onHit(
    ownerId: number,
    targetId: number,
    x: number,
    y: number,
    damage: number,
    shieldHit: boolean,
    killed: boolean,
    weaponIdx: number,
    /** Projectile slot (its id on the wire). */
    slot: number,
  ): void;
  /** A projectile ran out of range without hitting anything (it lands in the water). */
  onExpire(x: number, y: number, weaponIdx: number, slot: number): void;
  /** A projectile hit an island or reef. */
  onBlocked(x: number, y: number, weaponIdx: number, slot: number): void;
}

const NO_TARGETS: readonly Combatant[] = [];

/** Per weapon: its range, and how much of its damage and thickness it keeps at the end of its range (1 = no falloff). */
const RANGE_OF = new Float32Array(WEAPON_IDS.length);
const DAMAGE_AT_END = new Float32Array(WEAPON_IDS.length);
const RADIUS_AT_END = new Float32Array(WEAPON_IDS.length);
for (let w = 0; w < WEAPON_IDS.length; w++) {
  const def = WEAPONS[WEAPON_IDS[w]!] as WeaponDef;
  RANGE_OF[w] = def.range;
  DAMAGE_AT_END[w] = def.falloff?.damage ?? 1;
  RADIUS_AT_END[w] = def.falloff?.radius ?? 1;
}

/** Where a guided projectile's target is right now (the server's world, or the client's view of it). */
export interface HomingTargets {
  /** Writes the position of entity `id` into `out[0]`, `out[1]`; false when it is gone or sunk. */
  locate(id: number, out: Float32Array): boolean;
}

/** Struct-of-arrays projectile storage with a fixed capacity (no allocation after creation). */
export class ProjectileSet implements ProjectileSink {
  readonly capacity: number;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly remaining: Float32Array;
  readonly radius: Float32Array;
  readonly damage: Float32Array;
  /** Index into WEAPON_IDS; the client picks the visual from it. */
  readonly weapon: Uint8Array;
  /** Launch profile (rockets): speed eases from `startSpeed` to `maxSpeed` over `ramp` seconds. */
  readonly startSpeed: Float32Array;
  readonly maxSpeed: Float32Array;
  readonly ramp: Float32Array;
  readonly age: Float32Array;
  readonly owner: Uint16Array;
  /** Damage upgrade level of the shooter: only used to draw the shot thicker (client). */
  readonly power: Uint8Array;
  /** Owner team: projectiles pass through their own team. */
  readonly team: Uint8Array;
  /** Guided shots: entity id of the ship being chased (0 = flies straight) and the turn rate (radians per second). */
  readonly homingId: Uint16Array;
  /** Hit points of a projectile that enemy shots can destroy (the guided missile); 0 = cannot be shot. */
  readonly hp: Float32Array;
  readonly turn: Float32Array;
  readonly active: Uint8Array;
  /** Who tells where the chased ships are; without it guided shots fly straight. */
  homing: HomingTargets | null = null;
  private readonly where = new Float32Array(2);
  /** One past the highest slot index that may be active. */
  highWater = 0;
  activeCount = 0;

  private readonly freeSlots: Int32Array;
  private freeTop = 0;
  private recycleCursor = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.vx = new Float32Array(capacity);
    this.vy = new Float32Array(capacity);
    this.remaining = new Float32Array(capacity);
    this.radius = new Float32Array(capacity);
    this.damage = new Float32Array(capacity);
    this.weapon = new Uint8Array(capacity);
    this.power = new Uint8Array(capacity);
    this.startSpeed = new Float32Array(capacity);
    this.maxSpeed = new Float32Array(capacity);
    this.ramp = new Float32Array(capacity);
    this.age = new Float32Array(capacity);
    this.owner = new Uint16Array(capacity);
    this.team = new Uint8Array(capacity);
    this.homingId = new Uint16Array(capacity);
    this.hp = new Float32Array(capacity);
    this.turn = new Float32Array(capacity);
    this.active = new Uint8Array(capacity);
    this.freeSlots = new Int32Array(capacity);
    for (let i = 0; i < capacity; i++) this.freeSlots[i] = capacity - 1 - i;
    this.freeTop = capacity;
  }

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
    team: number = NO_TEAM,
  ): number {
    let slot: number;
    if (this.freeTop > 0) {
      slot = this.freeSlots[--this.freeTop]!;
    } else {
      // Full: drop an old projectile (GAME_DESIGN.md §11.3), round-robin.
      slot = this.recycleCursor;
      this.recycleCursor = (this.recycleCursor + 1) % this.capacity;
      if (this.active[slot] === 1) this.activeCount--;
    }
    this.x[slot] = x;
    this.y[slot] = y;
    this.vx[slot] = Math.cos(angle) * speed;
    this.vy[slot] = Math.sin(angle) * speed;
    this.remaining[slot] = range;
    this.radius[slot] = radius;
    this.damage[slot] = damage;
    this.weapon[slot] = weaponIdx;
    this.power[slot] = 0;
    const def = WEAPONS[WEAPON_IDS[weaponIdx]!];
    this.maxSpeed[slot] = def ? def.projectileSpeed : speed;
    this.startSpeed[slot] = speed;
    this.ramp[slot] = def ? def.accelSec : 0;
    this.homingId[slot] = 0;
    this.hp[slot] = 0;
    this.turn[slot] = def ? ((def as WeaponDef).turnRateDeg ?? 0) * DEG2RAD : 0;
    this.age[slot] = 0;
    this.owner[slot] = ownerId;
    this.team[slot] = team;
    this.active[slot] = 1;
    this.activeCount++;
    if (slot >= this.highWater) this.highWater = slot + 1;
    return slot;
  }

  /** Makes a guided shot (a weapon with a turn rate) chase entity `targetId`. */
  chase(slot: number, targetId: number): void {
    this.homingId[slot] = targetId;
  }

  /** How far along its range a shot is, 0 at the muzzle and 1 at the end (0..1). */
  flightFraction(slot: number): number {
    const range = RANGE_OF[this.weapon[slot]!]!;
    const f = range > 0 ? 1 - this.remaining[slot]! / range : 0;
    return f < 0 ? 0 : f > 1 ? 1 : f;
  }

  /** The share of its thickness a shot has after flying that far (1 for weapons without falloff). */
  radiusFactor(slot: number): number {
    const end = RADIUS_AT_END[this.weapon[slot]!]!;
    return end === 1 ? 1 : 1 + (end - 1) * this.flightFraction(slot);
  }

  /** Removes one projectile (the client does this when the server reports its end). */
  remove(slot: number): void {
    if (this.active[slot] === 1) this.release(slot);
  }

  /** Removes every projectile (new round). */
  clear(): void {
    for (let i = 0; i < this.highWater; i++) if (this.active[i] === 1) this.release(i);
  }

  private release(slot: number): void {
    this.active[slot] = 0;
    this.activeCount--;
    this.freeSlots[this.freeTop++] = slot;
  }

  /** Advances all projectiles by `dt`, resolving hits against `targets` at the current tick. */
  step(dt: number, targets: readonly Combatant[], hits: HitSink, obstacles?: Obstacles): void {
    for (let i = 0; i < this.highWater; i++) {
      if (this.active[i] === 1) this.stepOne(i, dt, targets, hits, obstacles);
    }
  }

  /**
   * Moves one projectile forward by `steps` ticks without ship hits (obstacles still apply). The
   * client uses it to catch up a shot that was fired a little while ago.
   */
  advance(slot: number, steps: number, dt: number, hits: HitSink, obstacles?: Obstacles): void {
    for (let k = 0; k < steps && this.active[slot] === 1; k++) {
      this.stepOne(slot, dt, NO_TARGETS, hits, obstacles);
    }
  }

  private stepOne(
    i: number,
    dt: number,
    targets: readonly Combatant[],
    hits: HitSink,
    obstacles?: Obstacles,
  ): void {
    const x0 = this.x[i]!;
    const y0 = this.y[i]!;
    if (this.homingId[i]! !== 0 && this.homing !== null && this.homing.locate(this.homingId[i]!, this.where)) {
      // Turn the flight direction toward the chased ship, as far as the turn rate allows.
      const vx = this.vx[i]!;
      const vy = this.vy[i]!;
      const heading = Math.atan2(vy, vx);
      const want = Math.atan2(this.where[1]! - y0, this.where[0]! - x0);
      const limit = this.turn[i]! * dt;
      const diff = angleDiff(want, heading);
      const turned = heading + (diff > limit ? limit : diff < -limit ? -limit : diff);
      const v = Math.sqrt(vx * vx + vy * vy);
      this.vx[i] = Math.cos(turned) * v;
      this.vy[i] = Math.sin(turned) * v;
    }
    if (this.ramp[i]! > 0) {
      const age = this.age[i]! + dt;
      this.age[i] = age;
      const f = Math.min(1, age / this.ramp[i]!);
      const target = this.startSpeed[i]! + (this.maxSpeed[i]! - this.startSpeed[i]!) * f * f;
      const v = Math.sqrt(this.vx[i]! * this.vx[i]! + this.vy[i]! * this.vy[i]!);
      if (v > 0) {
        const k = target / v;
        this.vx[i] = this.vx[i]! * k;
        this.vy[i] = this.vy[i]! * k;
      }
    }
    let dx = this.vx[i]! * dt;
    let dy = this.vy[i]! * dt;
    const len = Math.sqrt(dx * dx + dy * dy);
    const remaining = this.remaining[i]!;
    let expired = false;
    if (len >= remaining) {
      const k = len > 0 ? remaining / len : 0;
      dx *= k;
      dy *= k;
      expired = true;
    }

    let bestT = 2;
    let bestTarget = -1;
    const projRadius = this.radius[i]! * this.radiusFactor(i);
    const owner = this.owner[i]!;
    const ownerTeam = this.team[i]!;
    for (let j = 0; j < targets.length; j++) {
      const target = targets[j]!;
      const ts = target.state;
      if (!ts.alive || target.id === owner) continue;
      if (ownerTeam !== NO_TEAM && target.team === ownerTeam) continue;
      const cosH = Math.cos(ts.heading);
      const sinH = Math.sin(ts.heading);
      const circles = target.def.hitCircles;
      for (let k = 0; k < circles.length; k++) {
        const circle = circles[k]!;
        const t = sweptSegmentCircle(
          x0,
          y0,
          dx,
          dy,
          ts.x + cosH * circle.offset,
          ts.y + sinH * circle.offset,
          circle.radius + projRadius,
        );
        if (t >= 0 && t < bestT) {
          bestT = t;
          bestTarget = j;
        }
      }
    }

    // Islands and reefs stop a shot too, if they come before the first ship hit.
    if (obstacles) {
      const ot = obstacles.segmentHit(x0, y0, x0 + dx, y0 + dy);
      if (ot >= 0 && ot < bestT) {
        hits.onBlocked(x0 + dx * ot, y0 + dy * ot, this.weapon[i]!, i);
        this.release(i);
        return;
      }
    }

    if (bestTarget >= 0) {
      const target = targets[bestTarget]!;
      // A shot that has flown far hits softer (rapid-fire guns): by how far it had gone when it reached the ship.
      let damage = this.damage[i]!;
      const w = this.weapon[i]!;
      if (DAMAGE_AT_END[w]! !== 1) {
        const range = RANGE_OF[w]!;
        const f = range > 0 ? 1 - (remaining - bestT * len) / range : 0;
        damage *= 1 + (DAMAGE_AT_END[w]! - 1) * (f < 0 ? 0 : f > 1 ? 1 : f);
      }
      const flags = applyDamage(target.state, damage);
      hits.onHit(
        owner,
        target.id,
        x0 + dx * bestT,
        y0 + dy * bestT,
        damage,
        (flags & HIT_SHIELD) !== 0,
        (flags & HIT_KILLED) !== 0,
        this.weapon[i]!,
        i,
      );
      this.release(i);
      return;
    }

    this.x[i] = x0 + dx;
    this.y[i] = y0 + dy;
    this.remaining[i] = remaining - Math.sqrt(dx * dx + dy * dy);
    if (expired) {
      hits.onExpire(this.x[i]!, this.y[i]!, this.weapon[i]!, i);
      this.release(i);
    }
  }
}
