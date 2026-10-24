import { describe, expect, it } from 'vitest';
import { MATCH } from '../config/match.ts';
import { PIRATE, PIRATE_COVES, PIRATE_GARRISONS } from '../config/pirates.ts';
import { RIG, RIGS } from '../config/rigs.ts';
import { ECONOMY } from '../config/economy.ts';
import { CHANNEL, MAP, WORLD_CENTER, WORLD_SIZE } from '../config/world.ts';
import { CHANNEL_REACH, channelDistance, channelRocks, channelSpots } from './channel.ts';
import { generateMap } from './generate.ts';
import { mapHash } from './hash.ts';
import { circleVsWorld, lineOfFire, pointInIsland, segmentVsWorld } from './query.ts';
import { ISLAND_TYPES } from './types.ts';
import type { WorldMap } from './types.ts';

/** A map with one square island (80..120) and one reef, for exact geometry tests. */
function tinyMap(): WorldMap {
  return {
    seed: 0,
    islandCount: 1,
    islandType: Uint8Array.of(3),
    islandX: Float32Array.of(100),
    islandY: Float32Array.of(100),
    islandR: Float32Array.of(29),
    vertStart: Uint16Array.of(0, 4),
    verts: Float32Array.of(80, 80, 120, 80, 120, 120, 80, 120),
    reefCount: 1,
    reefX: Float32Array.of(200),
    reefY: Float32Array.of(100),
    reefR: Float32Array.of(5),
  };
}

describe('map generation', () => {
  it('is deterministic and the hash is pinned per seed', () => {
    // If these change, the generator (or the engine's math) changed: server and client would
    // build different maps. Update them only on purpose, together with PROTOCOL_VERSION.
    expect(mapHash(generateMap(1))).toBe(PINNED[1]);
    expect(mapHash(generateMap(1337))).toBe(PINNED[1337]);
    expect(mapHash(generateMap(987654))).toBe(PINNED[987654]);
    expect(mapHash(generateMap(1337))).toBe(mapHash(generateMap(1337)));
    expect(mapHash(generateMap(1))).not.toBe(mapHash(generateMap(2)));
  });

  it('places the requested islands and reefs for many seeds', () => {
    const want = MAP.counts.port + MAP.counts.fort + MAP.counts.treasure + MAP.counts.flat;
    for (let seed = 1; seed <= 200; seed++) {
      const m = generateMap(seed);
      expect(m.islandCount).toBe(want);
      expect(m.reefCount).toBeGreaterThanOrEqual(MAP.reefs.groups);
      const counts = [0, 0, 0, 0];
      for (let i = 0; i < m.islandCount; i++) counts[m.islandType[i]!]!++;
      expect(counts).toEqual(ISLAND_TYPES.map((t) => MAP.counts[t]));
    }
  });

  it('keeps islands apart, inside the world and away from the spawn area', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const m = generateMap(seed);
      for (let i = 0; i < m.islandCount; i++) {
        const x = m.islandX[i]!;
        const y = m.islandY[i]!;
        const r = m.islandR[i]!;
        expect(x - r).toBeGreaterThanOrEqual(MAP.edgeMargin - 1);
        expect(WORLD_SIZE - x - r).toBeGreaterThanOrEqual(MAP.edgeMargin - 1);
        expect(y - r).toBeGreaterThanOrEqual(MAP.edgeMargin - 1);
        expect(WORLD_SIZE - y - r).toBeGreaterThanOrEqual(MAP.edgeMargin - 1);
        expect(Math.hypot(x - WORLD_CENTER, y - WORLD_CENTER) - r).toBeGreaterThanOrEqual(
          MAP.spawnClear - 1,
        );
        for (let j = i + 1; j < m.islandCount; j++) {
          const d = Math.hypot(x - m.islandX[j]!, y - m.islandY[j]!);
          expect(d).toBeGreaterThan(r + m.islandR[j]!);
        }
      }
    }
  });

  it('puts each island type in its zone', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const m = generateMap(seed);
      for (let i = 0; i < m.islandCount; i++) {
        const d = Math.hypot(m.islandX[i]! - WORLD_CENTER, m.islandY[i]! - WORLD_CENTER);
        const type = ISLAND_TYPES[m.islandType[i]!]!;
        if (type === 'port') expect(d).toBeGreaterThan(MAP.regions.inner);
        if (type === 'fort') expect(d).toBeLessThan(MAP.regions.outer);
        if (type === 'treasure') {
          expect(d).toBeGreaterThan(MAP.regions.inner);
          expect(d).toBeLessThan(MAP.regions.outer);
        }
      }
    }
  });

  it('builds simple counter-clockwise outlines with 12-18 corners', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const m = generateMap(seed);
      for (let i = 0; i < m.islandCount; i++) {
        const s = m.vertStart[i]!;
        const n = m.vertStart[i + 1]! - s;
        expect(n).toBeGreaterThanOrEqual(MAP.corners.min);
        expect(n).toBeLessThanOrEqual(MAP.corners.max);
        let area2 = 0;
        for (let k = 0; k < n; k++) {
          const ax = m.verts[(s + k) * 2]!;
          const ay = m.verts[(s + k) * 2 + 1]!;
          const bx = m.verts[(s + ((k + 1) % n)) * 2]!;
          const by = m.verts[(s + ((k + 1) % n)) * 2 + 1]!;
          area2 += ax * by - bx * ay;
          expect(Math.hypot(ax - m.islandX[i]!, ay - m.islandY[i]!)).toBeLessThanOrEqual(
            m.islandR[i]! + 0.1,
          );
        }
        expect(area2).toBeGreaterThan(0);
        // The center is inside its own island.
        expect(pointInIsland(m, i, m.islandX[i]!, m.islandY[i]!)).toBe(true);
      }
    }
  });

  it('keeps reefs out of islands and the spawn area', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const m = generateMap(seed);
      // (The first reefs are the oil rig platforms: they stand in the middle on purpose.)
      for (let k = RIG.count; k < m.reefCount; k++) {
        const x = m.reefX[k]!;
        const y = m.reefY[k]!;
        expect(Math.hypot(x - WORLD_CENTER, y - WORLD_CENTER)).toBeGreaterThan(MAP.spawnClear);
        for (let i = 0; i < m.islandCount; i++) {
          const d = Math.hypot(x - m.islandX[i]!, y - m.islandY[i]!);
          expect(d).toBeGreaterThan(m.islandR[i]!);
        }
      }
    }
  });
});

describe('world queries', () => {
  const m = tinyMap();
  const out = new Float32Array(3);

  it('pointInIsland follows the polygon', () => {
    expect(pointInIsland(m, 0, 100, 100)).toBe(true);
    expect(pointInIsland(m, 0, 79, 100)).toBe(false);
    expect(pointInIsland(m, 0, 100, 121)).toBe(false);
  });

  it('circle outside: no hit until it overlaps the coast', () => {
    expect(circleVsWorld(m, 70, 100, 9, out)).toBe(false); // 10 from the coast
    expect(circleVsWorld(m, 70, 100, 11, out)).toBe(true);
    expect(out[0]).toBeCloseTo(-1, 5); // pushed toward -x
    expect(out[1]).toBeCloseTo(0, 5);
    expect(out[2]).toBeCloseTo(1, 5);
  });

  it('circle at a corner is pushed along the diagonal', () => {
    expect(circleVsWorld(m, 75, 75, 10, out)).toBe(true);
    expect(out[0]).toBeCloseTo(-Math.SQRT1_2, 3);
    expect(out[1]).toBeCloseTo(-Math.SQRT1_2, 3);
  });

  it('circle inside is pushed out through the nearest edge', () => {
    expect(circleVsWorld(m, 90, 100, 2, out)).toBe(true);
    expect(out[0]).toBeCloseTo(-1, 5); // nearest edge is x = 80
    expect(out[2]).toBeCloseTo(10 + 2, 5);
  });

  it('reefs are round obstacles', () => {
    expect(circleVsWorld(m, 190, 100, 4, out)).toBe(false);
    expect(circleVsWorld(m, 190, 100, 6, out)).toBe(true);
    expect(out[0]).toBeCloseTo(-1, 5);
  });

  it('segments stop at the coast and never tunnel, however fast', () => {
    expect(segmentVsWorld(m, 0, 100, 200, 100)).toBeCloseTo(80 / 200, 5);
    // A very long step from far away still hits.
    expect(segmentVsWorld(m, -5000, 100, 5000, 100)).toBeCloseTo(5080 / 10000, 5);
    expect(segmentVsWorld(m, 0, 60, 300, 60)).toBe(-1); // passes south of the island
    expect(segmentVsWorld(m, 150, 100, 300, 100)).toBeGreaterThan(0); // hits the reef at 195
    expect(segmentVsWorld(m, 100, 100, 300, 100)).toBe(0); // starts inside
  });
});

// Pinned hashes (see the determinism test).
const PINNED: Record<number, number> = { 1: 1379200569, 1337: 531194549, 987654: 219852941 };

describe('team bases', () => {
  it('keeps islands and reefs away from both carriers', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const m = generateMap(seed);
      for (const b of MATCH.carriers) {
        for (let i = 0; i < m.islandCount; i++) {
          expect(
            Math.hypot(m.islandX[i]! - b.x, m.islandY[i]! - b.y) - m.islandR[i]!,
          ).toBeGreaterThanOrEqual(MAP.baseClear - 1);
        }
        for (let k = 0; k < m.reefCount; k++) {
          expect(Math.hypot(m.reefX[k]! - b.x, m.reefY[k]! - b.y)).toBeGreaterThanOrEqual(
            MAP.baseClear - 1,
          );
        }
      }
    }
  });
});

describe('oil rigs', () => {
  it('stand the same distance from both carriers and inside the map', () => {
    expect(RIGS).toHaveLength(RIG.count);
    const [blue, red] = MATCH.carriers;
    for (const rig of RIGS) {
      expect(Math.hypot(rig.x - blue!.x, rig.y - blue!.y)).toBeCloseTo(
        Math.hypot(rig.x - red!.x, rig.y - red!.y),
        6,
      );
      expect(rig.x).toBeGreaterThan(MAP.boundary.width + RIG.captureRadius);
      expect(rig.x).toBeLessThan(WORLD_SIZE - MAP.boundary.width - RIG.captureRadius);
      expect(rig.y).toBeGreaterThan(MAP.boundary.width + RIG.captureRadius);
      expect(rig.y).toBeLessThan(WORLD_SIZE - MAP.boundary.width - RIG.captureRadius);
    }
  });

  it('have open water around the capture circle on every map, and a solid platform', () => {
    const out = new Float32Array(3);
    for (let seed = 1; seed <= 100; seed++) {
      const m = generateMap(seed);
      RIGS.forEach((rig, i) => {
        // The platform is the i-th reef.
        expect(m.reefX[i]).toBeCloseTo(rig.x, 1);
        expect(m.reefY[i]).toBeCloseTo(rig.y, 1);
        expect(m.reefR[i]).toBe(RIG.platformRadius);
        // Nothing but the platform within the capture circle (a ship can sail all around it).
        for (let k = 0; k < m.islandCount; k++) {
          const d = Math.hypot(m.islandX[k]! - rig.x, m.islandY[k]! - rig.y);
          expect(d).toBeGreaterThan(m.islandR[k]! + RIG.captureRadius);
        }
        for (let k = RIG.count; k < m.reefCount; k++) {
          const d = Math.hypot(m.reefX[k]! - rig.x, m.reefY[k]! - rig.y);
          expect(d).toBeGreaterThan(RIG.captureRadius);
        }
        // A ship (radius 5) can stand at the edge of the circle.
        expect(circleVsWorld(m, rig.x + RIG.captureRadius - 4, rig.y, 5, out)).toBe(false);
        expect(circleVsWorld(m, rig.x, rig.y + RIG.captureRadius - 4, 5, out)).toBe(false);
      });
    }
  });
});

describe('pirate coves', () => {
  it('mirror left to right, so both teams are equally far from every cove', () => {
    expect(PIRATE_COVES).toHaveLength(PIRATE_GARRISONS.length);
    const [blue, red] = MATCH.carriers;
    for (const cove of PIRATE_COVES) {
      // The mirror image of a cove is as far from the red carrier as the cove is from the blue one.
      expect(Math.hypot(WORLD_SIZE - cove.x - red!.x, cove.y - red!.y)).toBeCloseTo(
        Math.hypot(cove.x - blue!.x, cove.y - blue!.y),
        6,
      );
      // The mirror image of a cove is a cove too.
      expect(
        PIRATE_COVES.some(
          (o) => Math.abs(o.x - (WORLD_SIZE - cove.x)) < 1e-9 && Math.abs(o.y - cove.y) < 1e-9,
        ),
      ).toBe(true);
    }
  });

  it('are open water on every map and far from the carriers', () => {
    const out = new Float32Array(3);
    for (let seed = 1; seed <= 100; seed++) {
      const m = generateMap(seed);
      for (const cove of PIRATE_COVES) {
        expect(circleVsWorld(m, cove.x, cove.y, PIRATE.coveRadius * 0.8, out)).toBe(false);
        for (const b of MATCH.carriers) {
          expect(Math.hypot(cove.x - b.x, cove.y - b.y)).toBeGreaterThan(PIRATE.carrierAvoid * 2);
        }
      }
    }
  });
});

describe('rock channel', () => {
  const out = new Float32Array(3);
  const rocks = channelRocks();
  const west = CHANNEL.x - CHANNEL.length / 2;
  const east = CHANNEL.x + CHANNEL.length / 2;

  it('is part of every map: its rocks are the reefs right after the oil rig platforms', () => {
    for (const seed of [1, 7, 1337]) {
      const m = generateMap(seed);
      rocks.forEach((rock, i) => {
        expect(m.reefX[RIG.count + i]).toBeCloseTo(rock.x, 3);
        expect(m.reefY[RIG.count + i]).toBeCloseTo(rock.y, 3);
        expect(m.reefR[RIG.count + i]).toBeCloseTo(rock.r, 3);
      });
    }
  });

  it('has solid walls: nothing crosses it between the ends, ships and shots alike', () => {
    const m = generateMap(1337);
    for (let x = west + 3; x <= east - 3; x += 1.5) {
      // From well north of the channel to well south of it, across the lane and both walls.
      expect(segmentVsWorld(m, x, CHANNEL.y - 90, x, CHANNEL.y + 90)).toBeGreaterThanOrEqual(0);
      expect(segmentVsWorld(m, x, CHANNEL.y + 90, x, CHANNEL.y - 90)).toBeGreaterThanOrEqual(0);
    }
  });

  it('keeps the lane open from end to end, wide enough for a sizeable ship', () => {
    const m = generateMap(1337);
    for (const p of channelSpots(400)) {
      expect(circleVsWorld(m, p.x, p.y, CHANNEL.gap / 2 - 1, out)).toBe(false);
    }
    // The rocks leave both ends open: a ship can sail in from the west and the east.
    expect(circleVsWorld(m, west - 6, CHANNEL.y, 5, out)).toBe(false);
    expect(circleVsWorld(m, east + 6, CHANNEL.y, 5, out)).toBe(false);
  });

  it('floats every gold banknote in open water in the middle of the lane, mirrored left to right', () => {
    const spots = channelSpots(ECONOMY.pickups.gold.count);
    expect(spots).toHaveLength(ECONOMY.pickups.gold.count);
    const m = generateMap(1337);
    spots.forEach((p, k) => {
      expect(circleVsWorld(m, p.x, p.y, 6, out)).toBe(false);
      const twin = spots[spots.length - 1 - k]!;
      expect(twin.x).toBeCloseTo(WORLD_SIZE - p.x, 1);
      expect(twin.y).toBeCloseTo(p.y, 1);
      expect(channelDistance(p.x, p.y)).toBeLessThan(3);
    });
  });

  it('has no island or reef near it, and stays clear of the rigs, coves, carriers and the center, on every map', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const m = generateMap(seed);
      for (const rock of rocks) {
        for (let i = 0; i < m.islandCount; i++) {
          const gap = Math.hypot(m.islandX[i]! - rock.x, m.islandY[i]! - rock.y) - m.islandR[i]! - rock.r;
          expect(gap).toBeGreaterThanOrEqual(CHANNEL.clearance - 5);
        }
        for (let k = RIG.count + rocks.length; k < m.reefCount; k++) {
          const gap = Math.hypot(m.reefX[k]! - rock.x, m.reefY[k]! - rock.y) - m.reefR[k]! - rock.r;
          expect(gap).toBeGreaterThanOrEqual(CHANNEL.clearance - 5);
        }
      }
    }
    for (const rock of rocks) {
      for (const rig of RIGS) {
        expect(Math.hypot(rock.x - rig.x, rock.y - rig.y)).toBeGreaterThan(RIG.captureRadius + RIG.clearance + rock.r);
      }
      for (const cove of PIRATE_COVES) {
        expect(Math.hypot(rock.x - cove.x, rock.y - cove.y)).toBeGreaterThan(PIRATE.coveRadius + rock.r);
      }
      for (const b of MATCH.carriers) {
        expect(Math.hypot(rock.x - b.x, rock.y - b.y)).toBeGreaterThan(MAP.baseClear + rock.r);
      }
      expect(Math.hypot(rock.x - WORLD_CENTER, rock.y - WORLD_CENTER)).toBeGreaterThan(MAP.spawnClear + rock.r);
      expect(channelDistance(rock.x, rock.y)).toBeLessThanOrEqual(CHANNEL_REACH);
    }
  });
});

describe('line of fire', () => {
  // Two reefs with a 2-unit gap between them: a thin line slips through, a shot with some width does not.
  const gap: WorldMap = {
    seed: 0,
    islandCount: 0,
    islandType: new Uint8Array(0),
    islandX: new Float32Array(0),
    islandY: new Float32Array(0),
    islandR: new Float32Array(0),
    vertStart: Uint16Array.of(0),
    verts: new Float32Array(0),
    reefCount: 2,
    reefX: Float32Array.of(100, 100),
    reefY: Float32Array.of(95, 105),
    reefR: Float32Array.of(4, 4),
  };

  it('a thin line passes between two rocks, a line of fire does not', () => {
    expect(segmentVsWorld(gap, 0, 100, 200, 100)).toBe(-1);
    expect(lineOfFire(gap, 0, 100, 200, 100, 2)).toBe(false);
  });

  it('is clear in open water and when the rocks are far from the line', () => {
    expect(lineOfFire(gap, 0, 50, 200, 50, 2)).toBe(true);
    expect(lineOfFire(gap, 0, 100, 40, 100, 2)).toBe(true);
    expect(lineOfFire(gap, 0, 0, 0, 0, 2)).toBe(true);
  });
});
