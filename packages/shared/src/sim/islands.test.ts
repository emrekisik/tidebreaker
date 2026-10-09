import { describe, expect, it } from 'vitest';
import { MAP, WORLD_CENTER, WORLD_SIZE } from '../config/world.ts';
import { SHIPS } from '../config/ships.ts';
import { Mulberry32 } from '../math/rng.ts';
import { generateMap } from '../world/generate.ts';
import { circleVsWorld, segmentVsWorld } from '../world/query.ts';
import type { WorldMap } from '../world/types.ts';
import { applyWorldBounds, boundaryDepth, collideIslands } from './islands.ts';
import { ProjectileSet } from './projectiles.ts';
import type { HitSink } from './projectiles.ts';
import { stepShip } from './stepShip.ts';
import { NO_TEAM, createShipState } from './types.ts';

const def = SHIPS.coast_guard_boat;
const DT = 0.05;

/** One square island (80..120, 80..120) in an otherwise empty world. */
function squareIsland(): WorldMap {
  return {
    seed: 0,
    islandCount: 1,
    islandType: Uint8Array.of(3),
    islandX: Float32Array.of(100),
    islandY: Float32Array.of(100),
    islandR: Float32Array.of(29),
    vertStart: Uint16Array.of(0, 4),
    verts: Float32Array.of(80, 80, 120, 80, 120, 120, 80, 120),
    reefCount: 0,
    reefX: new Float32Array(0),
    reefY: new Float32Array(0),
    reefR: new Float32Array(0),
  };
}

const hits: number[] = [];
const sink = {
  onIslandHit(_id: number, _x: number, _y: number, impact: number) {
    hits.push(impact);
  },
};

function overlaps(m: WorldMap, s: ReturnType<typeof createShipState>): boolean {
  const out = new Float32Array(3);
  const c = Math.cos(s.heading);
  const sn = Math.sin(s.heading);
  for (const circle of def.hitCircles) {
    // Allow a hair of overlap: the push-out leaves a tiny float residue.
    if (
      circleVsWorld(m, s.x + c * circle.offset, s.y + sn * circle.offset, circle.radius - 0.02, out)
    ) {
      return true;
    }
  }
  return false;
}

describe('ship vs island', () => {
  it('a ship driving straight into the coast stops outside it and reports the impact', () => {
    const m = squareIsland();
    const s = createShipState(def, 20, 100, 0); // heading +x, straight at the west coast
    hits.length = 0;
    for (let i = 0; i < 200; i++) {
      stepShip(s, 0, 1, def.vMax, 1, DT);
      collideIslands(m, s, def, 1, sink);
      expect(overlaps(m, s)).toBe(false);
    }
    expect(s.x).toBeLessThan(80);
    expect(Math.abs(s.speed)).toBeLessThan(1);
    expect(hits.length).toBeGreaterThan(0);
    expect(Math.max(...hits)).toBeGreaterThan(2);
  });

  it('a ship hitting the coast at an angle slides along it', () => {
    const m = squareIsland();
    const s = createShipState(def, 40, 70, 0.6); // heading toward the island's south-west side
    s.speed = def.vMax;
    for (let i = 0; i < 60; i++) {
      stepShip(s, 0, 1, def.vMax, 1, DT);
      collideIslands(m, s, def, 1, sink);
      expect(overlaps(m, s)).toBe(false);
    }
    // It kept moving along the coast instead of stopping dead.
    expect(Math.hypot(s.kx, s.ky) + Math.abs(s.speed)).toBeGreaterThan(1);
  });

  it('never ends up inside an island on a generated map, whatever the course', () => {
    const m = generateMap(1337);
    const rng = new Mulberry32(7);
    for (let trial = 0; trial < 40; trial++) {
      // Start near a random island and steer randomly at full speed.
      const i = Math.floor(rng.next() * m.islandCount);
      const ang = rng.next() * Math.PI * 2;
      const d = m.islandR[i]! + 12 + rng.next() * 40;
      const s = createShipState(
        def,
        m.islandX[i]! + Math.cos(ang) * d,
        m.islandY[i]! + Math.sin(ang) * d,
        rng.next() * Math.PI * 2,
      );
      let steer = 0;
      for (let t = 0; t < 400; t++) {
        if (t % 20 === 0) steer = rng.next() * 2 - 1;
        stepShip(s, steer, 1, def.vMax, (def.turnRateDeg * Math.PI) / 180, DT);
        collideIslands(m, s, def, 1, sink);
        expect(overlaps(m, s)).toBe(false);
      }
    }
  });
});

describe('world edge', () => {
  it('slows ships and keeps them inside the world', () => {
    const s = createShipState(def, WORLD_SIZE - 300, WORLD_CENTER, 0); // full speed toward the east edge
    let nearEdgeSpeed: number = def.vMax;
    let closest = Infinity;
    for (let i = 0; i < 600; i++) {
      stepShip(s, 0, 1, def.vMax, 1, DT);
      applyWorldBounds(s, DT);
      expect(s.x).toBeLessThanOrEqual(WORLD_SIZE);
      expect(s.x).toBeGreaterThanOrEqual(0);
      closest = Math.min(closest, WORLD_SIZE - s.x);
      if (WORLD_SIZE - s.x < MAP.boundary.width) nearEdgeSpeed = Math.min(nearEdgeSpeed, s.speed);
    }
    expect(nearEdgeSpeed).toBeLessThan(def.vMax * 0.8);
    // It never reaches the very edge.
    expect(closest).toBeGreaterThan(1);
  });

  it('is invisible in open water and total at the edge', () => {
    expect(boundaryDepth(WORLD_CENTER, WORLD_CENTER)).toBe(0);
    expect(boundaryDepth(0, WORLD_CENTER)).toBe(1);
    expect(boundaryDepth(MAP.boundary.width / 2, WORLD_CENTER)).toBeCloseTo(0.5, 5);
    const s = createShipState(def, WORLD_CENTER, WORLD_CENTER, 0);
    applyWorldBounds(s, DT);
    expect(s.kx).toBe(0);
    expect(s.speed).toBe(0);
  });
});

describe('projectiles vs islands', () => {
  function sinkOf(): { blocked: number[][]; sink: HitSink } {
    const blocked: number[][] = [];
    return {
      blocked,
      sink: {
        onHit() {},
        onExpire() {},
        onBlocked(x, y, w) {
          blocked.push([x, y, w]);
        },
      },
    };
  }

  it('stops at the coast and reports where', () => {
    const m = squareIsland();
    const set = new ProjectileSet(4);
    const { blocked, sink: s } = sinkOf();
    set.spawn(0, 100, 0, 60, 300, 0.3, 10, 1, 0);
    const obstacles = {
      segmentHit: (a: number, b: number, c: number, d: number) => segmentVsWorld(m, a, b, c, d),
    };
    for (let i = 0; i < 40; i++) set.step(DT, [], s, obstacles);
    expect(set.activeCount).toBe(0);
    expect(blocked).toHaveLength(1);
    expect(blocked[0]![0]).toBeCloseTo(80, 3);
  });

  it('does not tunnel through the island at any speed', () => {
    const m = squareIsland();
    const set = new ProjectileSet(4);
    const { blocked, sink: s } = sinkOf();
    set.spawn(0, 100, 0, 9000, 5000, 0.1, 10, 1, 0); // 450 units in one tick
    set.step(DT, [], s, {
      segmentHit: (a, b, c, d) => segmentVsWorld(m, a, b, c, d),
    });
    expect(blocked).toHaveLength(1);
  });

  it('a ship in front of the island is hit before the island blocks the shot', () => {
    const m = squareIsland();
    const set = new ProjectileSet(4);
    const events: string[] = [];
    const s: HitSink = {
      onHit() {
        events.push('hit');
      },
      onExpire() {},
      onBlocked() {
        events.push('blocked');
      },
    };
    const foe = { id: 2, state: createShipState(def, 50, 100, 0), def, team: NO_TEAM };
    set.spawn(0, 100, 0, 60, 300, 0.3, 10, 1, 0);
    for (let i = 0; i < 20; i++) {
      set.step(DT, [foe], s, { segmentHit: (a, b, c, d) => segmentVsWorld(m, a, b, c, d) });
    }
    expect(events).toEqual(['hit']);
  });
});
