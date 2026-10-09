import { COLLISION } from '../config/collision.ts';
import { applyDamage, HIT_KILLED } from './damage.ts';
import { NO_TEAM } from './types.ts';
import type { Combatant, ShipState } from './types.ts';

/** Receives the result of a ship-to-ship collision. */
export interface CollisionSink {
  onCollision(
    aId: number,
    bId: number,
    /** Contact point. */
    x: number,
    y: number,
    /** Closing speed along the contact normal (world units/s). */
    impact: number,
    damageA: number,
    damageB: number,
    killedA: boolean,
    killedB: boolean,
  ): void;
}

/** Adds a velocity change to a ship: the forward part changes speed, the rest becomes knock. */
function applyVelocityChange(s: ShipState, dvx: number, dvy: number): void {
  const fx = Math.cos(s.heading);
  const fy = Math.sin(s.heading);
  const along = dvx * fx + dvy * fy;
  s.speed += along;
  s.kx += dvx - along * fx;
  s.ky += dvy - along * fy;
  const k = Math.sqrt(s.kx * s.kx + s.ky * s.ky);
  if (k > COLLISION.maxKnock) {
    const f = COLLISION.maxKnock / k;
    s.kx *= f;
    s.ky *= f;
  }
}

/**
 * Resolves overlaps between ships (circle chains, GAME_DESIGN.md §5.2): pushes them apart,
 * exchanges momentum along the contact normal (mass = hull), adds knock-back and spin from an
 * off-center hit, and applies damage when the closing speed is high. A lighter ship takes more
 * damage than a heavier one for the same impact.
 *
 * Broad phase is a plain pair loop for now; Phase 6 replaces it with the spatial grid.
 */
export function resolveCollisions(ships: readonly Combatant[], sink: CollisionSink): void {
  for (let i = 0; i < ships.length; i++) {
    const a = ships[i]!;
    if (!a.state.alive) continue;
    for (let j = i + 1; j < ships.length; j++) {
      const b = ships[j]!;
      if (!b.state.alive) continue;
      collide(a, b, sink);
    }
  }
}

function collide(a: Combatant, b: Combatant, sink: CollisionSink): void {
  const sa = a.state;
  const sb = b.state;
  const reach = (a.def.length + b.def.length) * 0.5;
  const ddx = sa.x - sb.x;
  const ddy = sa.y - sb.y;
  if (ddx * ddx + ddy * ddy > reach * reach) return;

  const cosA = Math.cos(sa.heading);
  const sinA = Math.sin(sa.heading);
  const cosB = Math.cos(sb.heading);
  const sinB = Math.sin(sb.heading);

  // Deepest overlapping pair of hull circles.
  let bestPen = 0;
  let nx = 0;
  let ny = 0;
  let cx = 0;
  let cy = 0;
  const ca = a.def.hitCircles;
  const cb = b.def.hitCircles;
  for (let p = 0; p < ca.length; p++) {
    const ac = ca[p]!;
    const ax = sa.x + cosA * ac.offset;
    const ay = sa.y + sinA * ac.offset;
    for (let q = 0; q < cb.length; q++) {
      const bc = cb[q]!;
      const bx = sb.x + cosB * bc.offset;
      const by = sb.y + sinB * bc.offset;
      const dx = ax - bx;
      const dy = ay - by;
      const rad = ac.radius + bc.radius;
      const d2 = dx * dx + dy * dy;
      if (d2 >= rad * rad) continue;
      const d = Math.sqrt(d2);
      const pen = rad - d;
      if (pen > bestPen) {
        bestPen = pen;
        if (d > 0.3 * rad) {
          nx = dx / d;
          ny = dy / d;
        } else {
          // Circles almost coincide: the circle-to-circle direction is unreliable, so use the
          // direction between the two ship centers instead.
          const l = Math.sqrt(ddx * ddx + ddy * ddy);
          nx = l > 1e-6 ? ddx / l : 1;
          ny = l > 1e-6 ? ddy / l : 0;
        }
        // Contact point on b's circle, facing a.
        cx = bx + nx * bc.radius;
        cy = by + ny * bc.radius;
      }
    }
  }
  if (bestPen <= 0) return;

  const mA = a.def.hull;
  const mB = b.def.hull;
  const sum = mA + mB;
  // A ship that cannot move (the aircraft carrier, vMax 0) is never pushed or knocked.
  const fixedA = a.def.vMax === 0;
  const fixedB = b.def.vMax === 0;
  if (fixedA && fixedB) return;

  // Push apart in proportion to the other ship's mass.
  const push = bestPen + COLLISION.slop;
  const shareA = fixedA ? 0 : fixedB ? 1 : mB / sum;
  const shareB = fixedB ? 0 : fixedA ? 1 : mA / sum;
  sa.x += nx * push * shareA;
  sa.y += ny * push * shareA;
  sb.x -= nx * push * shareB;
  sb.y -= ny * push * shareB;

  // Velocities including knock; closing > 0 when the ships approach each other along n.
  const vax = cosA * sa.speed + sa.kx;
  const vay = sinA * sa.speed + sa.ky;
  const vbx = cosB * sb.speed + sb.kx;
  const vby = sinB * sb.speed + sb.ky;
  const closing = (vbx - vax) * nx + (vby - vay) * ny;
  if (closing <= 0) return;

  const invA = fixedA ? 0 : 1 / mA;
  const invB = fixedB ? 0 : 1 / mB;
  const j = ((1 + COLLISION.restitution) * closing) / (invA + invB);
  const dvAx = j * invA * nx;
  const dvAy = j * invA * ny;
  const dvBx = -j * invB * nx;
  const dvBy = -j * invB * ny;
  if (!fixedA) applyVelocityChange(sa, dvAx, dvAy);
  if (!fixedB) applyVelocityChange(sb, dvBx, dvBy);

  // An off-center hit twists the ship (heading grows toward +y).
  const torqueA = (cx - sa.x) * dvAy - (cy - sa.y) * dvAx;
  const torqueB = (cx - sb.x) * dvBy - (cy - sb.y) * dvBx;
  if (!fixedA) sa.spin = clampSpin(sa.spin + (torqueA * COLLISION.spinPerTorque) / a.def.length);
  if (!fixedB) sb.spin = clampSpin(sb.spin + (torqueB * COLLISION.spinPerTorque) / b.def.length);

  if (closing < COLLISION.eventSpeed) return;

  let damageA = 0;
  let damageB = 0;
  let killedA = false;
  let killedB = false;
  const friendly = a.team !== NO_TEAM && a.team === b.team;
  if (closing > COLLISION.minDamageSpeed && !friendly) {
    const base = COLLISION.damagePerSpeed * closing;
    damageA = (base * 2 * mB) / sum;
    damageB = (base * 2 * mA) / sum;
    killedA = (applyDamage(sa, damageA) & HIT_KILLED) !== 0;
    killedB = (applyDamage(sb, damageB) & HIT_KILLED) !== 0;
  }
  sink.onCollision(a.id, b.id, cx, cy, closing, damageA, damageB, killedA, killedB);
}

function clampSpin(v: number): number {
  return v > COLLISION.maxSpin
    ? COLLISION.maxSpin
    : v < -COLLISION.maxSpin
      ? -COLLISION.maxSpin
      : v;
}
