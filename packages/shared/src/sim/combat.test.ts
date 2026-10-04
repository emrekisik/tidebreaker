import { describe, expect, it } from 'vitest';
import { SHIPS } from '../config/ships.ts';
import { WEAPONS } from '../config/weapons.ts';
import { applyDamage, HIT_KILLED, HIT_SHIELD } from './damage.ts';
import { mountCanFire, updateMounts, type Rng } from './mounts.ts';
import { ProjectileSet, sweptSegmentCircle, type HitSink } from './projectiles.ts';
import { createShipState, type Combatant } from './types.ts';

const def = SHIPS.coast_guard_boat;
const weapon = WEAPONS.deck_cannon_t1;
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

function recorder(): { hits: Hit[]; sink: HitSink } {
  const hits: Hit[] = [];
  return {
    hits,
    sink: {
      onHit(owner, target, x, y, damage, shield, killed) {
        hits.push({ owner, target, x, y, damage, shield, killed });
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
  const deck = def.mounts[0];
  if (!deck) throw new Error('missing mount');

  it('a 360 degree deck gun can aim anywhere', () => {
    const s = createShipState(def, 0, 0, 1.0);
    for (const aim of [0, 1, 2, 3, -3, -1.5]) expect(mountCanFire(s, deck, aim)).toBe(true);
  });

  it('a broadside mount only fires inside its arc', () => {
    const side = { ...deck, facingDeg: 90, arcDeg: 25 };
    const s = createShipState(def, 0, 0, 0); // starboard = +y = PI/2
    expect(mountCanFire(s, side, Math.PI / 2)).toBe(true);
    expect(mountCanFire(s, side, Math.PI / 2 + 0.3)).toBe(true);
    expect(mountCanFire(s, side, 0)).toBe(false);
    expect(mountCanFire(s, side, -Math.PI / 2)).toBe(false);
  });

  it('respects cooldown and the fire flag', () => {
    const s = createShipState(def, 0, 0, 0);
    const set = new ProjectileSet(16);
    expect(updateMounts(s, def, 1, 0, false, 0.05, zeroRng, set)).toBe(0);
    expect(updateMounts(s, def, 1, 0, true, 0.05, zeroRng, set)).toBe(1);
    expect(updateMounts(s, def, 1, 0, true, 0.05, zeroRng, set)).toBe(0); // cooling down
    let shots = 0;
    for (let i = 0; i < 20; i++) shots += updateMounts(s, def, 1, 0, true, 0.05, zeroRng, set);
    expect(shots).toBe(1); // 20 * 0.05 = 1 s > 0.9 s interval
    expect(set.activeCount).toBe(2); // the first shot plus the one after the cooldown
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

describe('ProjectileSet', () => {
  function target(id: number, x: number, y: number): Combatant {
    return { id, state: createShipState(def, x, y, 0), def };
  }

  it('hits a ship in range and reports shield/damage', () => {
    const set = new ProjectileSet(8);
    const foe = target(2, 30, 0);
    const { hits, sink } = recorder();
    set.spawn(0, 0, 0, weapon.projectileSpeed, weapon.range, weapon.radius, weapon.damage, 1);
    for (let i = 0; i < 20 && hits.length === 0; i++) set.step(0.05, [foe], sink);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ owner: 1, target: 2, damage: 10, shield: true, killed: false });
    expect(foe.state.shield).toBe(30);
    expect(set.activeCount).toBe(0);
  });

  it('does not tunnel through a ship at very high speed or large dt', () => {
    const set = new ProjectileSet(8);
    const foe = target(2, 30, 0);
    const { hits, sink } = recorder();
    set.spawn(0, 0, 0, 5000, 1000, 0.1, 10, 1); // 250 units in one 0.05 s step
    set.step(0.05, [foe], sink);
    expect(hits).toHaveLength(1);
  });

  it('never hits its owner', () => {
    const set = new ProjectileSet(8);
    const me = target(1, 0, 0);
    const { hits, sink } = recorder();
    set.spawn(0, 0, 0, 60, 42, 0.5, 10, 1);
    set.step(0.05, [me], sink);
    expect(hits).toHaveLength(0);
  });

  it('expires at max range without hitting anything', () => {
    const set = new ProjectileSet(8);
    const { hits, sink } = recorder();
    set.spawn(0, 0, 0, weapon.projectileSpeed, weapon.range, weapon.radius, 10, 1);
    for (let i = 0; i < 40; i++) set.step(0.05, [], sink);
    expect(set.activeCount).toBe(0);
    expect(hits).toHaveLength(0);
  });

  it('does not travel past its range', () => {
    const set = new ProjectileSet(8);
    const { sink } = recorder();
    const far = target(2, 45, 0); // beyond range 42 (+ circles ~ 44.2)
    set.spawn(0, 0, 0, weapon.projectileSpeed, weapon.range, weapon.radius, 10, 1);
    for (let i = 0; i < 40; i++) set.step(0.05, [far], sink);
    expect(far.state.shield).toBe(def.shield);
  });

  it('kills a ship and ignores dead targets afterwards', () => {
    const set = new ProjectileSet(8);
    const foe = target(2, 10, 0);
    foe.state.hull = 5;
    foe.state.shield = 0;
    const { hits, sink } = recorder();
    set.spawn(0, 0, 0, 60, 42, 0.5, 10, 1);
    set.spawn(0, 0, 0, 60, 42, 0.5, 10, 1);
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
    for (let i = 0; i < 5; i++) set.spawn(i, 0, 0, 1, 10, 0.5, 1, 1);
    expect(set.activeCount).toBe(2);
  });
});
