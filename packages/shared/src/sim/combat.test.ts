import { describe, expect, it } from 'vitest';
import { SHIPS } from '../config/ships.ts';
import { WEAPONS, weaponIndex } from '../config/weapons.ts';
import { applyDamage, HIT_KILLED, HIT_SHIELD } from './damage.ts';
import { mountCanFire, updateMounts, type Rng } from './mounts.ts';
import { ProjectileSet, sweptSegmentCircle, type HitSink } from './projectiles.ts';
import { createShipState, type Combatant } from './types.ts';

const def = SHIPS.coast_guard_boat;
const weapon = WEAPONS.cannon_t3;
const zeroRng: Rng = { next: () => 0.5 }; // no spread

interface Hit {
  owner: number;
  target: number;
  x: number;
  y: number;
  damage: number;
  shield: boolean;
  killed: boolean;
}

function recorder(): { hits: Hit[]; expired: number[]; sink: HitSink } {
  const hits: Hit[] = [];
  const expired: number[] = [];
  return {
    hits,
    expired,
    sink: {
      onHit(owner, target, x, y, damage, shield, killed) {
        hits.push({ owner, target, x, y, damage, shield, killed });
      },
      onExpire(_x, _y, weaponIdx) {
        expired.push(weaponIdx);
      },
    },
  };
}

describe('applyDamage', () => {
  it('hits shield first, then hull', () => {
    const s = createShipState(def, 0, 0, 0);
    expect(applyDamage(s, 30)).toBe(HIT_SHIELD);
    expect(s.shield).toBe(10);
    expect(s.hull).toBe(100);
    applyDamage(s, 25); // 10 shield + 15 hull
    expect(s.shield).toBe(0);
    expect(s.hull).toBe(85);
  });

  it('kills once and reports it once', () => {
    const s = createShipState(def, 0, 0, 0);
    expect(applyDamage(s, 500) & HIT_KILLED).toBe(HIT_KILLED);
    expect(s.alive).toBe(false);
    expect(applyDamage(s, 10) & HIT_KILLED).toBe(0);
  });
});

describe('mounts', () => {
  const mg = def.mounts[0];
  if (!mg) throw new Error('missing mount');

  it('a 360 degree turret can aim anywhere', () => {
    const s = createShipState(def, 0, 0, 1.0);
    for (const aim of [0, 1, 2, 3, -3, -1.5]) expect(mountCanFire(s, mg, aim)).toBe(true);
  });

  it('a broadside mount only fires inside its arc', () => {
    const side = { ...mg, facingDeg: 90, arcDeg: 25 };
    const s = createShipState(def, 0, 0, 0); // starboard = +y = PI/2
    expect(mountCanFire(s, side, Math.PI / 2)).toBe(true);
    expect(mountCanFire(s, side, Math.PI / 2 + 0.3)).toBe(true);
    expect(mountCanFire(s, side, 0)).toBe(false);
    expect(mountCanFire(s, side, -Math.PI / 2)).toBe(false);
  });

  it('respects the weapon reload and the fire flag', () => {
    const s = createShipState(def, 0, 0, 0);
    const set = new ProjectileSet(64);
    expect(updateMounts(s, def, 1, 0, false, 0.05, zeroRng, set)).toBe(0);
    let shots = 0;
    for (let i = 0; i < 20; i++) shots += updateMounts(s, def, 1, 0, true, 0.05, zeroRng, set);
    // machine gun: 0.15 s interval -> one shot every 3 ticks -> 7 shots in 1 s
    expect(shots).toBe(7);
  });

  it('spawns shots at the barrel tip, along the fire direction', () => {
    const s = createShipState(def, 10, 20, 0);
    const set = new ProjectileSet(4);
    updateMounts(s, def, 1, Math.PI / 2, true, 0.05, zeroRng, set);
    expect(set.activeCount).toBe(1);
    // Ship heading is 0, so forward = +x and starboard = +y; the shot goes along +y.
    const m = def.mounts[0]!;
    expect(set.x[0]).toBeCloseTo(10 + m.offset[0], 3);
    expect(set.y[0]).toBeCloseTo(20 + m.offset[1] + m.muzzle, 3);
  });

  it('records which weapon fired', () => {
    const corvette = SHIPS.corvette;
    const s = createShipState(corvette, 0, 0, 0);
    const set = new ProjectileSet(16);
    for (let i = 0; i < 80; i++) updateMounts(s, corvette, 1, 0, true, 0.05, zeroRng, set);
    const used = new Set<number>();
    for (let i = 0; i < set.highWater; i++) if (set.active[i] === 1) used.add(set.weapon[i]!);
    expect(used.has(weaponIndex('cannon_t3'))).toBe(true);
    expect(used.has(weaponIndex('rocket'))).toBe(true);
  });

  it('fires mounts one after another and each on its own reload', () => {
    const boat = SHIPS.gunboat; // two machine guns
    const s = createShipState(boat, 0, 0, 0);
    const times: number[][] = [[], []];
    const sink = {
      spawn(...args: number[]) {
        // args[1] is the spawn y: port mount is at y < 0, starboard at y > 0
        times[args[1]! < 0 ? 0 : 1]!.push(tick);
      },
    };
    let tick = 0;
    for (; tick < 40; tick++) updateMounts(s, boat, 1, 0, true, 0.05, zeroRng, sink);
    const [a, b] = times;
    // never two shots in the same tick, and both guns keep firing at their own pace
    expect(a!.length).toBeGreaterThan(5);
    expect(b!.length).toBeGreaterThan(5);
    for (const t of a!) expect(b!.includes(t)).toBe(false);
  });

  it('does not fire when dead', () => {
    const s = createShipState(def, 0, 0, 0);
    s.alive = false;
    const set = new ProjectileSet(4);
    expect(updateMounts(s, def, 1, 0, true, 0.05, zeroRng, set)).toBe(0);
  });
});

describe('sweptSegmentCircle', () => {
  it('detects a hit and misses correctly', () => {
    expect(sweptSegmentCircle(0, 0, 10, 0, 5, 0, 1)).toBeCloseTo(0.4);
    expect(sweptSegmentCircle(0, 0, 10, 0, 5, 3, 1)).toBe(-1);
    expect(sweptSegmentCircle(0, 0, -10, 0, 5, 0, 1)).toBe(-1);
    expect(sweptSegmentCircle(5, 0, 1, 0, 5, 0, 1)).toBe(0);
  });
});

describe('rocket launch profile', () => {
  const rocket = WEAPONS.rocket;
  const idx = weaponIndex('rocket');

  it('leaves slowly, speeds up to full speed, and then stays there', () => {
    const set = new ProjectileSet(4);
    const { sink } = recorder();
    set.spawn(
      0,
      0,
      0,
      rocket.projectileSpeed * rocket.startSpeedPct,
      rocket.range,
      rocket.radius,
      1,
      1,
      idx,
    );
    const speeds: number[] = [];
    for (let i = 0; i < 30; i++) {
      set.step(0.05, [], sink);
      speeds.push(Math.hypot(set.vx[0]!, set.vy[0]!));
    }
    const start = rocket.projectileSpeed * rocket.startSpeedPct;
    expect(speeds[0]!).toBeGreaterThanOrEqual(start);
    expect(speeds[0]!).toBeLessThan(start * 1.2); // still crawling after the first step
    for (let i = 1; i < 28; i++) expect(speeds[i]!).toBeGreaterThanOrEqual(speeds[i - 1]!);
    // Convex: the gain per step keeps growing (slow start, fast finish).
    expect(speeds[20]! - speeds[19]!).toBeGreaterThan(speeds[5]! - speeds[4]!);
    expect(speeds[29]!).toBeCloseTo(rocket.projectileSpeed, 3);
  });

  it('constant-speed weapons never change speed', () => {
    const set = new ProjectileSet(4);
    const { sink } = recorder();
    const gun = WEAPONS.machine_gun;
    set.spawn(
      0,
      0,
      0,
      gun.projectileSpeed,
      gun.range,
      gun.radius,
      1,
      1,
      weaponIndex('machine_gun'),
    );
    for (let i = 0; i < 5; i++) set.step(0.05, [], sink);
    expect(Math.hypot(set.vx[0]!, set.vy[0]!)).toBeCloseTo(gun.projectileSpeed, 4);
  });
});

describe('ProjectileSet', () => {
  function target(id: number, x: number, y: number): Combatant {
    return { id, state: createShipState(def, x, y, 0), def };
  }

  it('hits a ship in range and reports shield/damage', () => {
    const set = new ProjectileSet(8);
    const foe = target(2, 30, 0);
    const { hits, sink } = recorder();
    set.spawn(0, 0, 0, weapon.projectileSpeed, weapon.range, weapon.radius, weapon.damage, 1, 0);
    for (let i = 0; i < 20 && hits.length === 0; i++) set.step(0.05, [foe], sink);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ owner: 1, target: 2, damage: 16, shield: true, killed: false });
    expect(foe.state.shield).toBe(24);
    expect(set.activeCount).toBe(0);
  });

  it('does not tunnel through a ship at very high speed or large dt', () => {
    const set = new ProjectileSet(8);
    const foe = target(2, 30, 0);
    const { hits, sink } = recorder();
    set.spawn(0, 0, 0, 5000, 1000, 0.1, 10, 1, 0); // 250 units in one 0.05 s step
    set.step(0.05, [foe], sink);
    expect(hits).toHaveLength(1);
  });

  it('never hits its owner', () => {
    const set = new ProjectileSet(8);
    const me = target(1, 0, 0);
    const { hits, sink } = recorder();
    set.spawn(0, 0, 0, 60, 42, 0.5, 10, 1, 0);
    set.step(0.05, [me], sink);
    expect(hits).toHaveLength(0);
  });

  it('expires at max range without hitting anything', () => {
    const set = new ProjectileSet(8);
    const { hits, expired, sink } = recorder();
    set.spawn(0, 0, 0, weapon.projectileSpeed, weapon.range, weapon.radius, 10, 1, 3);
    for (let i = 0; i < 40; i++) set.step(0.05, [], sink);
    expect(set.activeCount).toBe(0);
    expect(hits).toHaveLength(0);
    expect(expired).toEqual([3]); // reported once, with the weapon index
  });

  it('does not travel past its range', () => {
    const set = new ProjectileSet(8);
    const { sink } = recorder();
    const far = target(2, 52, 0); // beyond range 46 plus the hull circles
    set.spawn(0, 0, 0, weapon.projectileSpeed, weapon.range, weapon.radius, 10, 1, 0);
    for (let i = 0; i < 40; i++) set.step(0.05, [far], sink);
    expect(far.state.shield).toBe(def.shield);
  });

  it('kills a ship and ignores dead targets afterwards', () => {
    const set = new ProjectileSet(8);
    const foe = target(2, 10, 0);
    foe.state.hull = 5;
    foe.state.shield = 0;
    const { hits, sink } = recorder();
    set.spawn(0, 0, 0, 60, 42, 0.5, 10, 1, 0);
    set.spawn(0, 0, 0, 60, 42, 0.5, 10, 1, 0);
    for (let i = 0; i < 10; i++) set.step(0.05, [foe], sink);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.killed).toBe(true);
    expect(set.activeCount).toBe(1); // second shell is still flying and ignores the wreck
    for (let i = 0; i < 20; i++) set.step(0.05, [foe], sink);
    expect(hits).toHaveLength(1);
    expect(set.activeCount).toBe(0); // expired at max range
  });

  it('recycles old projectiles when full', () => {
    const set = new ProjectileSet(2);
    for (let i = 0; i < 5; i++) set.spawn(i, 0, 0, 1, 10, 0.5, 1, 1, 0);
    expect(set.activeCount).toBe(2);
  });
});
