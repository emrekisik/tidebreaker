import { describe, expect, it } from 'vitest';
import { SHIP_MOVEMENT, SHIPS } from '../config/ships.ts';
import { STEP_SEC } from '../config/net.ts';
import { DEG2RAD } from '../math/angle.ts';
import { createShipState } from './types.ts';
import { stepShip } from './stepShip.ts';

const def = SHIPS.coast_guard_boat;
const turnRate = def.turnRateDeg * DEG2RAD;

type State = ReturnType<typeof createShipState>;

function run(s: State, ticks: number, steer: number, throttle: number): void {
  for (let i = 0; i < ticks; i++) stepShip(s, steer, throttle, def.vMax, turnRate, STEP_SEC);
}

describe('stepShip', () => {
  it('accelerates toward vMax with the throttle and never exceeds it', () => {
    const s = createShipState(def, 0, 0, 0);
    let max = 0;
    for (let i = 0; i < 200; i++) {
      stepShip(s, 0, 1, def.vMax, turnRate, STEP_SEC);
      max = Math.max(max, s.speed);
    }
    expect(max).toBeLessThanOrEqual(def.vMax + 1e-9);
    expect(s.speed).toBeCloseTo(def.vMax, 5);
    expect(s.x).toBeGreaterThan(0);
    expect(Math.abs(s.y)).toBeLessThan(1e-9);
  });

  it('takes about accelSeconds to reach full speed', () => {
    const s = createShipState(def, 0, 0, 0);
    run(s, 25, 0, 1); // 1.25 s
    expect(s.speed).toBeCloseTo(def.vMax / 2, 1);
  });

  it('does not move without throttle', () => {
    const s = createShipState(def, 0, 0, 0);
    run(s, 40, 0, 0);
    expect(s.speed).toBe(0);
    expect(s.x).toBe(0);
  });

  it('coasts to a stop slowly and brakes much faster', () => {
    const coasting = createShipState(def, 0, 0, 0);
    const braking = createShipState(def, 0, 0, 0);
    run(coasting, 100, 0, 1);
    run(braking, 100, 0, 1);
    run(coasting, 31, 0, 0); // 1.55 s
    run(braking, 31, 0, -1); // brakeSeconds = 1.5 s
    expect(Math.abs(braking.speed)).toBeLessThan(0.6); // stopped (and just starting to back up)
    expect(coasting.speed).toBeGreaterThan(def.vMax * 0.5);
    run(coasting, 140, 0, 0);
    expect(coasting.speed).toBe(0);
  });

  it('S brakes first, then backs up slowly to a lower top speed', () => {
    const s = createShipState(def, 0, 0, 0);
    run(s, 100, 0, 1);
    run(s, 10, 0, -1);
    expect(s.speed).toBeGreaterThan(0); // still braking, not yet reversing
    run(s, 300, 0, -1);
    expect(s.speed).toBeCloseTo(-def.vMax * SHIP_MOVEMENT.reverseSpeedFactor, 5);
    expect(s.x).toBeLessThan(def.vMax * 2); // it drove forward first, then came back
  });

  it('reverse is slower than forward', () => {
    const f = createShipState(def, 0, 0, 0);
    const r = createShipState(def, 0, 0, 0);
    run(f, 200, 0, 1);
    run(r, 200, 0, -1);
    expect(Math.abs(r.speed)).toBeLessThan(f.speed * 0.5);
    expect(r.x).toBeLessThan(0);
  });

  it('coming out of reverse, the throttle brakes first and then accelerates', () => {
    const s = createShipState(def, 0, 0, 0);
    run(s, 200, 0, -1);
    run(s, 200, 0, 1);
    expect(s.speed).toBeCloseTo(def.vMax, 5);
  });

  it('steers: positive rudder turns toward +y, at most the class turn rate', () => {
    const s = createShipState(def, 0, 0, 0);
    run(s, 60, 0, 1); // reach full speed
    const h0 = s.heading;
    run(s, 10, 1, 1);
    expect(s.heading - h0).toBeGreaterThan(0);
    expect(s.heading - h0).toBeLessThanOrEqual(turnRate * 10 * STEP_SEC + 1e-9);
    const t = createShipState(def, 0, 0, 0);
    run(t, 60, 0, 1);
    run(t, 10, -1, 1);
    expect(t.heading).toBeLessThan(0);
  });

  it('turns slowly when stationary and faster when moving', () => {
    const still = createShipState(def, 0, 0, 0);
    const moving = createShipState(def, 0, 0, 0);
    moving.speed = def.vMax;
    run(still, 10, 1, 0);
    run(moving, 10, 1, 0);
    expect(still.heading).toBeGreaterThan(0);
    expect(still.heading).toBeLessThan(moving.heading * 0.5);
  });

  it('a heavier class turns slower than a light one at the same rudder', () => {
    const heavy = SHIPS.heavy_frigate;
    const light = createShipState(def, 0, 0, 0);
    const big = createShipState(heavy, 0, 0, 0);
    light.speed = def.vMax;
    big.speed = heavy.vMax;
    for (let i = 0; i < 20; i++) {
      stepShip(light, 1, 1, def.vMax, def.turnRateDeg * DEG2RAD, STEP_SEC);
      stepShip(big, 1, 1, heavy.vMax, heavy.turnRateDeg * DEG2RAD, STEP_SEC);
    }
    expect(big.heading).toBeLessThan(light.heading * 0.6);
  });

  it('bleeds some speed when the rudder is hard over', () => {
    const straight = createShipState(def, 0, 0, 0);
    const turning = createShipState(def, 0, 0, 0);
    run(straight, 150, 0, 1);
    run(turning, 150, 1, 1);
    expect(turning.speed).toBeLessThan(straight.speed);
  });

  it('is deterministic for the same input sequence', () => {
    const inputs: Array<[number, number]> = [];
    for (let i = 0; i < 400; i++) inputs.push([Math.sin(i * 0.07), Math.cos(i * 0.11)]);
    const a = createShipState(def, 5, 5, 0);
    const b = createShipState(def, 5, 5, 0);
    for (const [st, th] of inputs) stepShip(a, st, th, def.vMax, turnRate, STEP_SEC);
    for (const [st, th] of inputs) stepShip(b, st, th, def.vMax, turnRate, STEP_SEC);
    expect(b.x).toBe(a.x);
    expect(b.y).toBe(a.y);
    expect(b.heading).toBe(a.heading);
    expect(b.speed).toBe(a.speed);
  });
});
