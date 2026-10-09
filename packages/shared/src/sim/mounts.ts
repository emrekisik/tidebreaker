import type { MountDef, ShipDef } from '../config/ships.ts';
import { MOUNT_CONVERGE_MIN, SALVO_GAP_SEC, WEAPONS, weaponIndex } from '../config/weapons.ts';
import { DEG2RAD, angleDiff } from '../math/angle.ts';
import type { ShipState } from './types.ts';

/** Receives projectiles spawned by firing mounts. */
export interface ProjectileSink {
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
  ): void;
}

/** Injected randomness so the sim stays deterministic. Returns [0, 1). */
export interface Rng {
  next(): number;
}

/** Cooldowns are compared with a small tolerance so float32 rounding cannot cost a whole tick. */
const READY_EPSILON = 1e-4;

/** True when `aim` (world angle) lies inside the mount's firing arc for the ship's heading. */
export function mountCanFire(ship: ShipState, mount: MountDef, aim: number): boolean {
  const facing = ship.heading + mount.facingDeg * DEG2RAD;
  return Math.abs(angleDiff(aim, facing)) <= mount.arcDeg * DEG2RAD;
}

/**
 * World angle a mount at (mountX, mountY) should fire at so its shot passes through the aim point:
 * the point `aimDist` units from the ship center (shipX, shipY) along `aim`. With `aimDist` <= 0
 * the mount just fires along `aim` (parallel shots).
 */
export function convergedAngle(
  shipX: number,
  shipY: number,
  aim: number,
  aimDist: number,
  mountX: number,
  mountY: number,
): number {
  if (!(aimDist > 0)) return aim;
  const d = Math.max(aimDist, MOUNT_CONVERGE_MIN);
  return Math.atan2(shipY + Math.sin(aim) * d - mountY, shipX + Math.cos(aim) * d - mountX);
}

/**
 * Ticks mount cooldowns and fires ready mounts whose arc contains `aim` (GAME_DESIGN.md §5.3).
 * Every weapon has its own reload; at most one mount fires per `SALVO_GAP_SEC`, in mount order,
 * so volleys roll out one barrel after another. Shots spawn at the barrel tip and converge on the
 * aim point `aimDist` away (0 = parallel). Returns the number of shots fired.
 */
export function updateMounts(
  ship: ShipState,
  def: ShipDef,
  ownerId: number,
  aim: number,
  fire: boolean,
  dt: number,
  rng: Rng,
  sink: ProjectileSink,
  aimDist = 0,
): number {
  let shots = 0;
  ship.salvoCooldown = Math.max(0, ship.salvoCooldown - dt);
  const cosH = Math.cos(ship.heading);
  const sinH = Math.sin(ship.heading);
  for (let i = 0; i < def.mounts.length; i++) {
    const mount = def.mounts[i]!;
    const cd = Math.max(0, ship.mountCooldown[i]! - dt);
    ship.mountCooldown[i] = cd;
    if (
      !fire ||
      !ship.alive ||
      cd > READY_EPSILON ||
      ship.salvoCooldown > READY_EPSILON ||
      !mountCanFire(ship, mount, aim)
    ) {
      continue;
    }

    const weapon = WEAPONS[mount.weapon];
    // starboard = forward rotated +90 degrees (heading goes from +x toward +y).
    const px = ship.x + cosH * mount.offset[0] - sinH * mount.offset[1];
    const py = ship.y + sinH * mount.offset[0] + cosH * mount.offset[1];
    const angle =
      convergedAngle(ship.x, ship.y, aim, aimDist, px, py) +
      (rng.next() * 2 - 1) * weapon.spreadDeg * DEG2RAD;
    sink.spawn(
      px + Math.cos(angle) * mount.muzzle,
      py + Math.sin(angle) * mount.muzzle,
      angle,
      weapon.projectileSpeed * weapon.startSpeedPct,
      weapon.range,
      weapon.radius,
      weapon.damage,
      ownerId,
      weaponIndex(mount.weapon),
    );
    ship.mountCooldown[i] = weapon.intervalSec;
    ship.salvoCooldown = SALVO_GAP_SEC;
    shots++;
  }
  return shots;
}
