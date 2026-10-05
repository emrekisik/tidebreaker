import { SHIP_MOVEMENT } from '../config/ships.ts';
import { clamp, lerp, normalizeAngle } from '../math/angle.ts';
import type { ShipState } from './types.ts';

function moveToward(value: number, target: number, maxDelta: number): number {
  const d = target - value;
  return d > maxDelta ? value + maxDelta : d < -maxDelta ? value - maxDelta : target;
}

/**
 * Advances one ship by `dt` seconds (GAME_DESIGN.md §5.2). Pure and deterministic:
 * the only inputs are the arguments; the ship state is mutated in place.
 *
 * Controls are rudder + throttle: the ship turns itself and never moves sideways.
 *
 * @param steer rudder in [-1, 1]; positive turns toward +y (clockwise on screen)
 * @param throttle in [-1, 1]; positive = accelerate, negative = brake, 0 = coast
 * @param turnRate radians per second at full speed
 */
export function stepShip(
  s: ShipState,
  steer: number,
  throttle: number,
  vMax: number,
  turnRate: number,
  dt: number,
): void {
  const st = clamp(steer, -1, 1);
  const th = clamp(throttle, -1, 1);

  // A nearly stationary ship turns sluggishly; steerage comes with speed.
  const speedFrac = clamp(s.speed / (vMax * SHIP_MOVEMENT.turnFullSpeedFrac), 0, 1);
  const turnScale = lerp(SHIP_MOVEMENT.minTurnFactor, 1, speedFrac);
  s.heading = normalizeAngle(s.heading + st * turnRate * turnScale * dt);

  const accel = vMax / SHIP_MOVEMENT.accelSeconds;
  const coast = vMax / SHIP_MOVEMENT.coastSeconds;
  const brake = vMax / SHIP_MOVEMENT.brakeSeconds;
  if (th > 0) {
    const vTarget = vMax * th * (1 - SHIP_MOVEMENT.turnDrag * Math.abs(st));
    s.speed += clamp(vTarget - s.speed, -coast * dt, accel * dt);
  } else if (th < 0) {
    s.speed = moveToward(s.speed, 0, brake * dt);
  } else {
    s.speed = moveToward(s.speed, 0, coast * dt);
  }

  s.x += Math.cos(s.heading) * s.speed * dt;
  s.y += Math.sin(s.heading) * s.speed * dt;
}
