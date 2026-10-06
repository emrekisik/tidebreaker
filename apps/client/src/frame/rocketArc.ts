import { FX } from '@tidebreaker/shared';

/** Height of a rocket at flight fraction u (0 = launch, 1 = max range). */
export function rocketHeight(u: number): number {
  const A = FX.rocketArc;
  return A.start + A.a * u - A.b * u * u;
}

/** Nose pitch (radians, positive = up) at flight fraction u for a weapon with the given range. */
export function rocketPitch(u: number, range: number): number {
  const A = FX.rocketArc;
  return Math.atan(((A.a - 2 * A.b * u) / range) * A.pitchBoost);
}
