import { SALVO_GAP_SEC, WEAPONS, weaponIndex } from '../config/weapons.ts';
import { DEG2RAD } from '../math/angle.ts';
import type { Rng, ProjectileSink } from './mounts.ts';
import { NO_TEAM } from './types.ts';
import type { Combatant } from './types.ts';

/** Cooldowns are compared with a small tolerance so float32 rounding cannot cost a whole tick. */
const READY_EPSILON = 1e-4;

/**
 * Picks the target of one turret of a carrier (GAME_DESIGN.md §4.5): the nearest living enemy
 * within the weapon's range. Writes the world angle to fire at, leading a moving target for the
 * weapon's (constant) projectile speed, into `out[0]`. Returns the target's index or -1.
 * The server uses it to shoot and the client to turn the turret model, so both always agree.
 */
export function pickCarrierTarget(
  carrier: Combatant,
  mountIdx: number,
  targets: readonly Combatant[],
  out: Float32Array,
): number {
  const s = carrier.state;
  const mount = carrier.def.mounts[mountIdx]!;
  const weapon = WEAPONS[mount.weapon];
  const c = Math.cos(s.heading);
  const sn = Math.sin(s.heading);
  const px = s.x + c * mount.offset[0] - sn * mount.offset[1];
  const py = s.y + sn * mount.offset[0] + c * mount.offset[1];
  let best = -1;
  let bestD2 = Infinity;
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i]!;
    if (!t.state.alive || t.team === carrier.team || t.team === NO_TEAM) continue;
    const dx = t.state.x - px;
    const dy = t.state.y - py;
    const d2 = dx * dx + dy * dy;
    const reach = weapon.range + t.def.length * 0.25;
    if (d2 > reach * reach || d2 >= bestD2) continue;
    bestD2 = d2;
    best = i;
  }
  if (best < 0) return -1;

  const t = targets[best]!.state;
  const rx = t.x - px;
  const ry = t.y - py;
  const tc = Math.cos(t.heading);
  const ts = Math.sin(t.heading);
  const vx = tc * t.speed + t.kx;
  const vy = ts * t.speed + t.ky;
  const v = weapon.projectileSpeed;
  // Intercept time: |r + v_t * time| = v * time.
  const a = vx * vx + vy * vy - v * v;
  const b = 2 * (rx * vx + ry * vy);
  const cc = rx * rx + ry * ry;
  let time = 0;
  if (Math.abs(a) < 1e-6) {
    time = b < 0 ? -cc / b : 0;
  } else {
    const disc = b * b - 4 * a * cc;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      const t1 = (-b - sq) / (2 * a);
      const t2 = (-b + sq) / (2 * a);
      time = t1 > 0 && t2 > 0 ? Math.min(t1, t2) : Math.max(t1, t2);
    }
  }
  if (!(time > 0) || time > weapon.range / v) time = 0;
  out[0] = Math.atan2(ry + vy * time, rx + vx * time);
  return best;
}

const aim = new Float32Array(1);

/**
 * Ticks a carrier's turrets and fires the ones that are ready at their own targets. Shots spawn
 * at the barrel tip like everyone else's. Returns the number of shots fired.
 */
export function updateCarrier(
  carrier: Combatant,
  targets: readonly Combatant[],
  dt: number,
  rng: Rng,
  sink: ProjectileSink,
): number {
  const s = carrier.state;
  const def = carrier.def;
  let shots = 0;
  s.salvoCooldown = Math.max(0, s.salvoCooldown - dt);
  const c = Math.cos(s.heading);
  const sn = Math.sin(s.heading);
  for (let i = 0; i < def.mounts.length; i++) {
    const cd = Math.max(0, s.mountCooldown[i]! - dt);
    s.mountCooldown[i] = cd;
    if (!s.alive || cd > READY_EPSILON || s.salvoCooldown > READY_EPSILON) continue;
    if (pickCarrierTarget(carrier, i, targets, aim) < 0) continue;
    const mount = def.mounts[i]!;
    const weapon = WEAPONS[mount.weapon];
    const px = s.x + c * mount.offset[0] - sn * mount.offset[1];
    const py = s.y + sn * mount.offset[0] + c * mount.offset[1];
    const angle = aim[0]! + (rng.next() * 2 - 1) * weapon.spreadDeg * DEG2RAD;
    sink.spawn(
      px + Math.cos(angle) * mount.muzzle,
      py + Math.sin(angle) * mount.muzzle,
      angle,
      weapon.projectileSpeed * weapon.startSpeedPct,
      weapon.range,
      weapon.radius,
      weapon.damage,
      carrier.id,
      weaponIndex(mount.weapon),
    );
    s.mountCooldown[i] = weapon.intervalSec;
    s.salvoCooldown = SALVO_GAP_SEC;
    shots++;
  }
  return shots;
}
