import { SHIP_MOVEMENT } from '../config/ships.ts';
import { angleDiff, clamp, lerp, normalizeAngle } from '../math/angle.ts';
import type { ShipState } from './types.ts';

/**
 * Advances one ship by `dt` seconds (GAME_DESIGN.md §5.2). Pure and deterministic:
 * the only inputs are the arguments; the ship state is mutated in place.
 *
 * @param moveX desired world-direction x in [-1, 1]
 * @param moveY desired world-direction y in [-1, 1]
 * @param turnRate radians per second
 */
export function stepShip(
  s: ShipState,
  moveX: number,
  moveY: number,
  vMax: number,
  turnRate: number,
  dt: number,
): void {
  let mx = moveX;
  let my = moveY;
  let len = Math.sqrt(mx * mx + my * my);
  if (len > 1) {
    mx /= len;
    my /= len;
    len = 1;
  }

  let vTarget = 0;
  if (len > SHIP_MOVEMENT.moveEpsilon) {
    const diff = angleDiff(Math.atan2(my, mx), s.heading);
    const maxTurn = turnRate * dt;
    s.heading = normalizeAngle(s.heading + clamp(diff, -maxTurn, maxTurn));
    const headingFactor = lerp(1, SHIP_MOVEMENT.minHeadingFactor, Math.abs(diff) / Math.PI);
    vTarget = vMax * len * headingFactor;
  }

  const accel = vMax / SHIP_MOVEMENT.accelSeconds;
  const decel = vMax / SHIP_MOVEMENT.decelSeconds;
  s.speed += clamp(vTarget - s.speed, -decel * dt, accel * dt);

  s.x += Math.cos(s.heading) * s.speed * dt;
  s.y += Math.sin(s.heading) * s.speed * dt;
}
