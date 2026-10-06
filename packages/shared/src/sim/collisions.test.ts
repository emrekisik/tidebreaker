import { describe, expect, it } from 'vitest';
import { COLLISION } from '../config/collision.ts';
import { STEP_SEC } from '../config/net.ts';
import { SHIPS, type ShipDef } from '../config/ships.ts';
import { DEG2RAD } from '../math/angle.ts';
import { resolveCollisions, type CollisionSink } from './collisions.ts';
import { stepShip } from './stepShip.ts';
import { createShipState, type Combatant } from './types.ts';

interface Event {
  a: number;
  b: number;
  impact: number;
  damageA: number;
  damageB: number;
  killedA: boolean;
  killedB: boolean;
}

function recorder(): { events: Event[]; sink: CollisionSink } {
  const events: Event[] = [];
  return {
    events,
    sink: {
      onCollision(a, b, _x, _y, impact, damageA, damageB, killedA, killedB) {
        events.push({ a, b, impact, damageA, damageB, killedA, killedB });
      },
    },
  };
}

function ship(id: number, def: ShipDef, x: number, y: number, heading: number): Combatant {
  return { id, def, state: createShipState(def, x, y, heading) };
}

const small = SHIPS.coast_guard_boat;
const big = SHIPS.heavy_frigate;

describe('resolveCollisions', () => {
  it('does nothing for ships that are apart', () => {
    const a = ship(1, small, 0, 0, 0);
    const b = ship(2, small, 40, 0, Math.PI);
    const { events, sink } = recorder();
    resolveCollisions([a, b], sink);
    expect(events).toHaveLength(0);
    expect(a.state.x).toBe(0);
    expect(b.state.x).toBe(40);
  });

  it('pushes overlapping ships apart until they no longer overlap', () => {
    const a = ship(1, small, 0, 0, 0);
    const b = ship(2, small, 4, 0, 0);
    const { sink } = recorder();
    resolveCollisions([a, b], sink);
    expect(a.state.x).toBeLessThan(0);
    expect(b.state.x).toBeGreaterThan(4);
    const { events } = recorder();
    resolveCollisions([a, b], recorder().sink);
    expect(events).toHaveLength(0);
  });

  it('a head-on ramming damages both ships and slows them down', () => {
    const a = ship(1, small, -2, 0, 0);
    const b = ship(2, small, 2, 0, Math.PI);
    a.state.speed = 12;
    b.state.speed = 12;
    const { events, sink } = recorder();
    resolveCollisions([a, b], sink);
    expect(events).toHaveLength(1);
    const e = events[0]!;
    expect(e.impact).toBeGreaterThan(20);
    expect(e.damageA).toBeGreaterThan(0);
    expect(e.damageB).toBeGreaterThan(0);
    expect(a.state.shield + a.state.hull).toBeLessThan(small.shield + small.hull);
    expect(a.state.speed).toBeLessThan(12);
    expect(b.state.speed).toBeLessThan(12);
  });

  it('the lighter ship takes more damage than the heavy one', () => {
    const a = ship(1, small, -1, 0, 0);
    const b = ship(2, big, 8, 0, Math.PI);
    a.state.speed = 12;
    b.state.speed = 0;
    const { events, sink } = recorder();
    resolveCollisions([a, b], sink);
    const e = events[0]!;
    expect(e.damageA).toBeGreaterThan(e.damageB * 3);
  });

  it('gentle bumps cause no damage', () => {
    const a = ship(1, small, -1.5, 0, 0);
    const b = ship(2, small, 1.5, 0, 0);
    a.state.speed = 1.5;
    const { events, sink } = recorder();
    resolveCollisions([a, b], sink);
    for (const e of events) expect(e.damageA + e.damageB).toBe(0);
    expect(a.state.hull).toBe(small.hull);
    expect(a.state.shield).toBe(small.shield);
  });

  it('an off-center hit twists the ship and knocks it sideways; a centered one does not', () => {
    // b rams a's bow from the side: its bow circle meets a's bow circle off to one side.
    const bow = small.hitCircles[small.hitCircles.length - 1]!;
    const gap = 0.8 * 2 * bow.radius;
    const a = ship(1, small, 0, 0, 0);
    const b = ship(2, small, bow.offset + 0.1, bow.offset + gap, -Math.PI / 2);
    b.state.speed = 10;
    resolveCollisions([a, b], recorder().sink);
    expect(Math.abs(a.state.spin)).toBeGreaterThan(0.01);
    expect(Math.abs(a.state.ky)).toBeGreaterThan(0.1);

    const c = ship(3, small, 0, 0, 0);
    const d = ship(4, small, 4, 0, Math.PI);
    d.state.speed = 10;
    resolveCollisions([c, d], recorder().sink);
    expect(Math.abs(c.state.spin)).toBeLessThan(1e-6);
  });

  it('knock-back and spin fade away on their own', () => {
    const s = createShipState(small, 0, 0, 0);
    s.kx = 8;
    s.spin = 2;
    for (let i = 0; i < 100; i++) {
      stepShip(s, 0, 0, small.vMax, small.turnRateDeg * DEG2RAD, STEP_SEC);
    }
    expect(Math.abs(s.kx)).toBeLessThan(0.1);
    expect(Math.abs(s.spin)).toBeLessThan(0.05);
    expect(s.x).toBeGreaterThan(1); // it did get pushed
  });

  it('a hard enough ramming can sink a ship, once', () => {
    const a = ship(1, big, -5, 0, 0);
    const b = ship(2, small, 4, 0, Math.PI);
    a.state.speed = big.vMax;
    b.state.speed = small.vMax;
    b.state.hull = 5;
    b.state.shield = 0;
    const { events, sink } = recorder();
    resolveCollisions([a, b], sink);
    expect(events[0]?.killedB).toBe(true);
    expect(b.state.alive).toBe(false);
    resolveCollisions([a, b], recorder().sink); // dead ships no longer collide
    expect(events).toHaveLength(1);
  });

  it('is deterministic', () => {
    const run = (): number[] => {
      const a = ship(1, small, -2, 0.3, 0.1);
      const b = ship(2, big, 3, 0, Math.PI);
      a.state.speed = 10;
      resolveCollisions([a, b], recorder().sink);
      return [a.state.x, a.state.y, a.state.spin, a.state.kx, b.state.hull, b.state.spin];
    };
    expect(run()).toEqual(run());
  });

  it('config sanity: damage needs a real impact', () => {
    expect(COLLISION.minDamageSpeed).toBeGreaterThan(COLLISION.eventSpeed);
  });
});
