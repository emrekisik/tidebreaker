import { WEAPONS, WEAPON_IDS } from '../config/weapons.ts';
import { applyDamage, HIT_KILLED, HIT_SHIELD } from './damage.ts';
import type { ProjectileSink } from './mounts.ts';
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
  ): void;
  /** A projectile ran out of range without hitting anything (it lands in the water). */
  onExpire(x: number, y: number, weaponIdx: number): void;
  /** A projectile hit an island or reef. */
  onBlocked(x: number, y: number, weaponIdx: number): void;
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
  readonly active: Uint8Array;
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
    this.startSpeed = new Float32Array(capacity);
    this.maxSpeed = new Float32Array(capacity);
    this.ramp = new Float32Array(capacity);
    this.age = new Float32Array(capacity);
    this.owner = new Uint16Array(capacity);
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
  ): void {
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
    const def = WEAPONS[WEAPON_IDS[weaponIdx]!];
    this.maxSpeed[slot] = def ? def.projectileSpeed : speed;
    this.startSpeed[slot] = speed;
    this.ramp[slot] = def ? def.accelSec : 0;
    this.age[slot] = 0;
    this.owner[slot] = ownerId;
    this.active[slot] = 1;
    this.activeCount++;
    if (slot >= this.highWater) this.highWater = slot + 1;
  }

  private release(slot: number): void {
    this.active[slot] = 0;
    this.activeCount--;
    this.freeSlots[this.freeTop++] = slot;
  }

  /** Advances all projectiles by `dt`, resolving hits against `targets` at the current tick. */
  step(dt: number, targets: readonly Combatant[], hits: HitSink, obstacles?: Obstacles): void {
    for (let i = 0; i < this.highWater; i++) {
      if (this.active[i] === 0) continue;
      const x0 = this.x[i]!;
      const y0 = this.y[i]!;
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
      const projRadius = this.radius[i]!;
      const owner = this.owner[i]!;
      for (let j = 0; j < targets.length; j++) {
        const target = targets[j]!;
        const ts = target.state;
        if (!ts.alive || target.id === owner) continue;
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
          hits.onBlocked(x0 + dx * ot, y0 + dy * ot, this.weapon[i]!);
          this.release(i);
          continue;
        }
      }

      if (bestTarget >= 0) {
        const target = targets[bestTarget]!;
        const damage = this.damage[i]!;
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
        );
        this.release(i);
        continue;
      }

      this.x[i] = x0 + dx;
      this.y[i] = y0 + dy;
      this.remaining[i] = remaining - Math.sqrt(dx * dx + dy * dy);
      if (expired) {
        hits.onExpire(this.x[i]!, this.y[i]!, this.weapon[i]!);
        this.release(i);
      }
    }
  }
}
