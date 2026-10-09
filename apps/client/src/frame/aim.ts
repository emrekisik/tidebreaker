import type { PerspectiveCamera } from 'three';
import { Vector3 } from 'three';

const point = new Vector3();
const dir = new Vector3();

/**
 * Like `aimAngleFromScreen`, but also writes the distance from the ship to the aim point:
 * out[0] = angle, out[1] = distance. Returns false when the ray does not reach the water.
 */
export function aimFromScreen(
  camera: PerspectiveCamera,
  ndcX: number,
  ndcY: number,
  shipX: number,
  shipY: number,
  out: Float32Array,
): boolean {
  point.set(ndcX, ndcY, 0.5).unproject(camera);
  dir.copy(point).sub(camera.position);
  if (dir.y > -1e-6) return false;
  const t = -camera.position.y / dir.y;
  const dx = camera.position.x + dir.x * t - shipX;
  const dz = camera.position.z + dir.z * t - shipY;
  out[0] = Math.atan2(dz, dx);
  out[1] = Math.sqrt(dx * dx + dz * dz);
  return true;
}

/**
 * Casts the mouse position onto the water plane (y = 0) and returns the sim-space aim angle from
 * the ship at (shipX, shipY). Sim y is world z. Returns NaN when the ray does not reach the water.
 */
export function aimAngleFromScreen(
  camera: PerspectiveCamera,
  ndcX: number,
  ndcY: number,
  shipX: number,
  shipY: number,
): number {
  point.set(ndcX, ndcY, 0.5).unproject(camera);
  dir.copy(point).sub(camera.position);
  if (dir.y > -1e-6) return Number.NaN;
  const t = -camera.position.y / dir.y;
  const gx = camera.position.x + dir.x * t;
  const gz = camera.position.z + dir.z * t;
  return Math.atan2(gz - shipY, gx - shipX);
}
