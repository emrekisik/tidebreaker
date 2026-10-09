import { describe, expect, it } from 'vitest';
import { MATCH } from '../config/match.ts';
import { MAP, WORLD_CENTER, WORLD_SIZE } from '../config/world.ts';
import { generateMap } from './generate.ts';
import { mapHash } from './hash.ts';
import { circleVsWorld, pointInIsland, segmentVsWorld } from './query.ts';
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
      for (let k = 0; k < m.reefCount; k++) {
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
const PINNED: Record<number, number> = { 1: 1074919811, 1337: 2790357553, 987654: 263690995 };

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
