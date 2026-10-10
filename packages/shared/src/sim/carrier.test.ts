import { describe, expect, it } from 'vitest';
import { CARRIER, MATCH, TEAM_BLUE, TEAM_RED } from '../config/match.ts';
import { SHIPS } from '../config/ships.ts';
import { WEAPONS, weaponIndex } from '../config/weapons.ts';
import { configHash } from '../config/hash.ts';
import { resolveCollisions } from './collisions.ts';
import type { CollisionSink } from './collisions.ts';
import { pickCarrierTarget, updateCarrier } from './carrier.ts';
import { NO_TEAM, createShipState } from './types.ts';
import type { Combatant } from './types.ts';

const gun = WEAPONS.carrier_gun;
const small = SHIPS.coast_guard_boat;
const rng = { next: () => 0.5 }; // no spread

function carrier(team = TEAM_BLUE): Combatant {
  const b = MATCH.carriers[team]!;
  return { id: 1, def: CARRIER, state: createShipState(CARRIER, b.x, b.y, b.heading), team };
}

function boat(id: number, team: number, x: number, y: number, heading = 0, speed = 0): Combatant {
  const state = createShipState(small, x, y, heading);
  state.speed = speed;
  return { id, def: small, state, team };
}

interface Shot {
  x: number;
  y: number;
  angle: number;
  owner: number;
  weapon: number;
}

function sinkOf(): { shots: Shot[]; sink: { spawn: (...a: number[]) => void } } {
  const shots: Shot[] = [];
  return {
    shots,
    sink: {
      spawn: (...a: number[]) => {
        shots.push({ x: a[0]!, y: a[1]!, angle: a[2]!, owner: a[7]!, weapon: a[8]! });
      },
    },
  };
}

describe('carrier turrets', () => {
  it('shoot the nearest enemy in range and ignore teammates', () => {
    const c = carrier();
    const mate = boat(2, TEAM_BLUE, c.state.x + 20, c.state.y + 30);
    const enemyFar = boat(3, TEAM_RED, c.state.x + 40, c.state.y + 10);
    const enemyNear = boat(4, TEAM_RED, c.state.x + 15, c.state.y + 25);
    const out = new Float32Array(1);
    expect(pickCarrierTarget(c, 0, [mate, enemyFar, enemyNear], out)).toBe(2);
    expect(pickCarrierTarget(c, 0, [mate], out)).toBe(-1);
  });

  it('do not shoot beyond their range', () => {
    const c = carrier();
    const out = new Float32Array(1);
    const far = boat(2, TEAM_RED, c.state.x + gun.range + 40, c.state.y);
    expect(pickCarrierTarget(c, 0, [far], out)).toBe(-1);
  });

  it('lead a moving target', () => {
    const c = carrier();
    // Enemy straight ahead crossing sideways at 10 u/s: the shot must aim ahead of it.
    const mover = boat(2, TEAM_RED, c.state.x + 40, c.state.y, Math.PI / 2, 10);
    const still = boat(3, TEAM_RED, c.state.x + 40, c.state.y);
    const out = new Float32Array(1);
    pickCarrierTarget(c, 0, [mover], out);
    const ledAngle = out[0]!;
    pickCarrierTarget(c, 0, [still], out);
    expect(ledAngle).toBeGreaterThan(out[0]! + 0.05);
    // And the projectile really meets the target: simulate both.
    const mount = CARRIER.mounts[0]!;
    const px = c.state.x + mount.offset[0];
    const py = c.state.y + mount.offset[1];
    let best = Infinity;
    for (let t = 0; t < 3; t += 0.01) {
      const bx = px + Math.cos(ledAngle) * gun.projectileSpeed * t;
      const by = py + Math.sin(ledAngle) * gun.projectileSpeed * t;
      const tx = mover.state.x;
      const ty = mover.state.y + 10 * t;
      best = Math.min(best, Math.hypot(bx - tx, by - ty));
    }
    expect(best).toBeLessThan(0.6);
  });

  it('fire at their own pace and tag the shot with the carrier as owner', () => {
    const c = carrier();
    const enemy = boat(2, TEAM_RED, c.state.x + 30, c.state.y + 20);
    const { shots, sink } = sinkOf();
    for (let i = 0; i < 20; i++) updateCarrier(c, [enemy], 0.05, rng, sink);
    // 1 second: a machine gun (0.25 s reload) and a rocket launcher (1.5 s reload).
    const bullets = shots.filter((x) => x.weapon === weaponIndex('carrier_gun'));
    const rockets = shots.filter((x) => x.weapon === weaponIndex('carrier_rocket'));
    expect(bullets.length).toBeGreaterThanOrEqual(3);
    expect(bullets.length).toBeLessThanOrEqual(5);
    expect(rockets.length).toBe(1);
    expect(shots.every((s) => s.owner === c.id)).toBe(true);
  });

  it('stay silent when nobody is in range or the carrier is sunk', () => {
    const c = carrier();
    const { shots, sink } = sinkOf();
    for (let i = 0; i < 20; i++)
      updateCarrier(c, [boat(2, TEAM_BLUE, c.state.x + 20, c.state.y)], 0.05, rng, sink);
    expect(shots).toHaveLength(0);
    c.state.alive = false;
    const enemy = boat(3, TEAM_RED, c.state.x + 30, c.state.y + 20);
    for (let i = 0; i < 20; i++) updateCarrier(c, [enemy], 0.05, rng, sink);
    expect(shots).toHaveLength(0);
  });
});

describe('carrier collisions', () => {
  const quiet: CollisionSink = { onCollision() {} };

  it('never moves, and the ship that rams it takes the damage', () => {
    const c = carrier();
    const x0 = c.state.x;
    const ram = boat(2, TEAM_RED, c.state.x + 40, c.state.y, Math.PI, 12);
    // Drive into the carrier for a while.
    for (let i = 0; i < 40; i++) {
      ram.state.x += Math.cos(ram.state.heading) * ram.state.speed * 0.05;
      resolveCollisions([c, ram], quiet);
    }
    expect(c.state.x).toBe(x0);
    expect(c.state.speed).toBe(0);
    expect(c.state.hull).toBeGreaterThan(CARRIER.hull - 50);
    expect(ram.state.hull).toBeLessThan(small.hull);
  });

  it('teammates bump without damage', () => {
    const a = boat(1, TEAM_BLUE, 100, 100, 0, 10);
    const b = boat(2, TEAM_BLUE, 100.5, 100, Math.PI, 10);
    resolveCollisions([a, b], quiet);
    expect(a.state.hull).toBe(small.hull);
    expect(b.state.hull).toBe(small.hull);
    // Without teams the same hit does hurt.
    const c = boat(3, NO_TEAM, 100, 100, 0, 10);
    const d = boat(4, NO_TEAM, 100.5, 100, Math.PI, 10);
    resolveCollisions([c, d], quiet);
    expect(c.state.hull).toBeLessThan(small.hull);
  });
});

describe('config hash', () => {
  it('is stable and never zero', () => {
    expect(configHash()).toBe(configHash());
    expect(configHash()).toBeGreaterThan(0);
  });
});
