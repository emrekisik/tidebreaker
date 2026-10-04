export const TAU = Math.PI * 2;
export const DEG2RAD = Math.PI / 180;

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Wraps an angle into [-PI, PI). */
export function normalizeAngle(a: number): number {
  return a - TAU * Math.floor((a + Math.PI) / TAU);
}

/** Shortest signed rotation (radians) that takes `current` to `target`, in [-PI, PI). */
export function angleDiff(target: number, current: number): number {
  return normalizeAngle(target - current);
}

/** Interpolates along the shortest arc. */
export function lerpAngle(a: number, b: number, t: number): number {
  return a + angleDiff(b, a) * t;
}
