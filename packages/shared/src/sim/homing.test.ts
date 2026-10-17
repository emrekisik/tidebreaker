import { describe, expect, it } from 'vitest';
import { WEAPONS, weaponIndex } from '../config/weapons.ts';
import { DEG2RAD } from '../math/angle.ts';
import { ProjectileSet } from './projectiles.ts';
import type { HitSink, HomingTargets } from './projectiles.ts';

const W = WEAPONS.missile;
const DT = 0.05;

/** A target that moves along a function of time; entity id 7. */
class Mover implements HomingTargets {
  x = 0;
  y = 0;
  locate(id: number, out: Float32Array): boolean {
    if (id !== 7) return false;
    out[0] = this.x;
    out[1] = this.y;
    return true;
  }
}

const noHits: HitSink = { onHit: () => {}, onExpire: () => {}, onBlocked: () => {} };

function launch(set: ProjectileSet, angle: number): number {
  const slot = set.spawn(0, 0, angle, W.projectileSpeed * W.startSpeedPct, W.range, W.radius, W.damage, 1, weaponIndex('missile'));
  set.chase(slot, 7);
  return slot;
}

describe('guided projectiles', () => {
  it('turn toward the chased entity, at most the turn rate per step', () => {
    const set = new ProjectileSet(4);
    const target = new Mover();
    set.homing = target;
    target.x = 0;
    target.y = 100; // straight "up" (+y); the missile leaves along +x
    const slot = launch(set, 0);
    set.step(DT, [], noHits);
    const heading = Math.atan2(set.vy[slot]!, set.vx[slot]!);
    expect(heading).toBeCloseTo(W.turnRateDeg * DEG2RAD * DT, 5);
    // Speed is unchanged by the steering (only the launch ramp changes it).
    for (let i = 0; i < 20; i++) set.step(DT, [], noHits);
    const h2 = Math.atan2(set.vy[slot]!, set.vx[slot]!);
    expect(h2).toBeGreaterThan(heading);
  });

  it('fly straight on when the chased entity is gone', () => {
    const set = new ProjectileSet(4);
    set.homing = new Mover();
    const slot = launch(set, 0.3);
    set.chase(slot, 99); // nobody
    for (let i = 0; i < 10; i++) set.step(DT, [], noHits);
    expect(Math.atan2(set.vy[slot]!, set.vx[slot]!)).toBeCloseTo(0.3, 5);
  });

  it('close in on a ship that sails off sideways, but miss one that turns harder than they can', () => {
    // Far target running away at a right angle: the missile catches up.
    const set = new ProjectileSet(4);
    const target = new Mover();
    set.homing = target;
    target.x = 120;
    target.y = 0;
    const slot = launch(set, 0);
    let closest = Infinity;
    for (let i = 0; i < 100 && set.active[slot] === 1; i++) {
      target.y += 15 * DT;
      set.step(DT, [], noHits);
      if (set.active[slot] === 1) closest = Math.min(closest, Math.hypot(target.x - set.x[slot]!, target.y - set.y[slot]!));
    }
    expect(closest).toBeLessThan(6);

    // A ship circling tightly inside the missile's turn radius is not reached.
    const set2 = new ProjectileSet(4);
    const circler = new Mover();
    set2.homing = circler;
    const turnRadius = W.projectileSpeed / (W.turnRateDeg * DEG2RAD);
    const r = turnRadius * 0.15;
    const slot2 = launch(set2, 0);
    let near = Infinity;
    for (let i = 0; i < 100 && set2.active[slot2] === 1; i++) {
      const a = (i * DT * 14) / r; // 14 units/s around a small circle
      circler.x = 60 + Math.cos(a) * r;
      circler.y = Math.sin(a) * r;
      set2.step(DT, [], noHits);
      if (i > 40 && set2.active[slot2] === 1) near = Math.min(near, Math.hypot(circler.x - set2.x[slot2]!, circler.y - set2.y[slot2]!));
    }
    expect(near).toBeGreaterThan(r * 0.6);
  });
});
