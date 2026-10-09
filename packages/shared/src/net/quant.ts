import { WORLD_SIZE } from '../config/world.ts';

/** World position: u16 in 1/16 unit (GAME_DESIGN.md §10.3). Max error 1/32 unit. */
export const POS_SCALE = 16;
const TAU = Math.PI * 2;

export function qPos(v: number): number {
  const q = Math.round(v * POS_SCALE);
  return q < 0 ? 0 : q > 65535 ? 65535 : q;
}

export function dqPos(q: number): number {
  return q / POS_SCALE;
}

/** Heading/aim angle (radians, any range) -> u8 (1.4 degrees per step). */
export function qAngle8(a: number): number {
  const t = ((((a % TAU) + TAU) % TAU) / TAU) * 256;
  return Math.round(t) & 0xff;
}

export function dqAngle8(q: number): number {
  return (q / 256) * TAU;
}

/** Angle -> u16 (0.0055 degrees per step). Used for aim and projectile launch angles. */
export function qAngle16(a: number): number {
  const t = ((((a % TAU) + TAU) % TAU) / TAU) * 65536;
  return Math.round(t) & 0xffff;
}

export function dqAngle16(q: number): number {
  return (q / 65536) * TAU;
}

/** Rudder/throttle in [-1, 1] -> i8. */
export function qAxis(v: number): number {
  const c = v < -1 ? -1 : v > 1 ? 1 : v;
  return Math.round(c * 127);
}

export function dqAxis(q: number): number {
  return q / 127;
}

/** Distance from the ship to the aim point, in units, clamped to a byte. */
export function qAimDist(d: number): number {
  const q = Math.round(d);
  return q < 0 ? 0 : q > 255 ? 255 : q;
}

/** Ship speed (units/s, may be negative) -> i8 with a scale of 6 (range about -21..21). */
export const SPEED_SCALE = 6;

export function qSpeed(v: number): number {
  const q = Math.round(v * SPEED_SCALE);
  return q < -127 ? -127 : q > 127 ? 127 : q;
}

export function dqSpeed(q: number): number {
  return q / SPEED_SCALE;
}

/** A fraction 0..1 (health, shield) -> u8. */
export function qFrac(v: number): number {
  const q = Math.round(v * 255);
  return q < 0 ? 0 : q > 255 ? 255 : q;
}

export function dqFrac(q: number): number {
  return q / 255;
}

/** Damage and impact values: u8 with a scale of `scale` (damage 1, impact 8). */
export function qByte(v: number, scale: number): number {
  const q = Math.round(v * scale);
  return q < 0 ? 0 : q > 255 ? 255 : q;
}

/** True when the position is inside the world (used to reject nonsense from the wire). */
export function inWorld(x: number, y: number): boolean {
  return x >= 0 && x <= WORLD_SIZE && y >= 0 && y <= WORLD_SIZE;
}
