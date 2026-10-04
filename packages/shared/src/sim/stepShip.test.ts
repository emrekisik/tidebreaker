import { describe, expect, it } from 'vitest';
import { SHIPS } from '../config/ships.ts';
import { STEP_SEC } from '../config/net.ts';
import { DEG2RAD } from '../math/angle.ts';
import { createShipState } from './types.ts';
import { stepShip } from './stepShip.ts';

const def = SHIPS.coast_guard_boat;
const turnRate = def.turnRateDeg * DEG2RAD;

function run(s: ReturnType<typeof createShipState>, ticks: number, mx: number, my: number): void {
  for (let i = 0; i < ticks; i++) stepShip(s, mx, my, def.vMax, turnRate, STEP_SEC);
}

describe('stepShip', () => {
  it('accelerates toward vMax and never exceeds it', () => {
    const s = createShipState(def, 0, 0, 0);
    let max = 0;
    for (let i = 0; i < 200; i++) {
      stepShip(s, 1, 0, def.vMax, turnRate, STEP_SEC);
      max = Math.max(max, s.speed);
    }
    expect(max).toBeLessThanOrEqual(def.vMax + 1e-9);
    expect(s.speed).toBeCloseTo(def.vMax, 5);
    expect(s.x).toBeGreaterThan(0);
    expect(Math.abs(s.y)).toBeLessThan(1e-9);
  });

  it('takes about accelSeconds to reach full speed', () => {
    const s = createShipState(def, 0, 0, 0);
    run(s, 25, 1, 0); // 1.25 s
    expect(s.speed).toBeCloseTo(def.vMax / 2, 1);
  });

  it('coasts to a stop without input', () => {
    const s = createShipState(def, 0, 0, 0);
    run(s, 100, 1, 0);
    run(s, 140, 0, 0); // 7 s > decelSeconds
    expect(s.speed).toBe(0);
  });

  it('limits the turn rate', () => {
    const s = createShipState(def, 0, 0, 0);
    run(s, 1, 0, 1); // wants +90 degrees
    expect(s.heading).toBeCloseTo(turnRate * STEP_SEC, 9);
  });

  it('turns the short way (+y is positive heading)', () => {
    const s = createShipState(def, 0, 0, 0);
    run(s, 40, 0, 1);
    expect(s.heading).toBeCloseTo(Math.PI / 2, 5);
    const t = createShipState(def, 0, 0, 0);
    run(t, 40, 0, -1);
    expect(t.heading).toBeCloseTo(-Math.PI / 2, 5);
  });

  it('slows down on a sharp turn', () => {
    const straight = createShipState(def, 0, 0, 0);
    const sharp = createShipState(def, 0, 0, 0);
    // Start at full speed, then ask for a 180 degree reversal: speed must drop while turning.
    run(straight, 100, 1, 0);
    run(sharp, 100, 1, 0);
    run(straight, 10, 1, 0);
    run(sharp, 10, -1, 0);
    expect(sharp.speed).toBeLessThan(straight.speed);
  });

  it('normalizes diagonal input (no speed bonus)', () => {
    const a = createShipState(def, 0, 0, Math.PI / 4);
    const b = createShipState(def, 0, 0, Math.PI / 4);
    run(a, 100, 1, 1);
    run(b, 100, 0.7071, 0.7071);
    expect(a.speed).toBeCloseTo(b.speed, 2);
    expect(a.speed).toBeLessThanOrEqual(def.vMax + 1e-9);
  });

  it('is deterministic for the same input sequence', () => {
    const inputs: Array<[number, number]> = [];
    for (let i = 0; i < 400; i++) inputs.push([Math.sin(i * 0.07), Math.cos(i * 0.11)]);
    const a = createShipState(def, 5, 5, 0);
    const b = createShipState(def, 5, 5, 0);
    for (const [mx, my] of inputs) stepShip(a, mx, my, def.vMax, turnRate, STEP_SEC);
    for (const [mx, my] of inputs) stepShip(b, mx, my, def.vMax, turnRate, STEP_SEC);
    expect(b.x).toBe(a.x);
    expect(b.y).toBe(a.y);
    expect(b.heading).toBe(a.heading);
    expect(b.speed).toBe(a.speed);
  });
});
