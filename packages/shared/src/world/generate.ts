import { MAP, WORLD_CENTER, WORLD_SIZE } from '../config/world.ts';
import { Mulberry32 } from '../math/rng.ts';
import { ISLAND_TYPES } from './types.ts';
import type { IslandType, WorldMap } from './types.ts';

const TAU = Math.PI * 2;
const Q = 16;

/** Quantizes to 1/16 unit (see WorldMap). */
function quant(v: number): number {
  return Math.round(v * Q) / Q;
}

interface Island {
  type: number;
  x: number;
  y: number;
  /** Bounding radius around (x, y). */
  r: number;
  verts: number[];
}

/**
 * Builds an irregular island outline around the origin: evenly spaced angles with a little
 * jitter and a radius made of a few random harmonics. Star-shaped, so it never self-intersects.
 * Returns the corners as (x, y) pairs plus the bounding radius.
 */
function outline(rng: Mulberry32, minRadius: number): { pts: number[]; bound: number } {
  const W = MAP.wobble;
  const rnd = (a: number, b: number): number => a + (b - a) * rng.next();
  const base = rnd(minRadius, MAP.radius.max);
  const n = MAP.corners.min + Math.floor(rng.next() * (MAP.corners.max - MAP.corners.min + 1));
  const p2 = rnd(0, TAU);
  const p3 = rnd(0, TAU);
  const p5 = rnd(0, TAU);
  const a2 = rnd(0.4, 1) * W.h2;
  const a3 = rnd(0.4, 1) * W.h3;
  const a5 = rnd(0.4, 1) * W.h5;
  const pts: number[] = [];
  let bound = 0;
  for (let i = 0; i < n; i++) {
    const ang = ((i + rnd(-0.3, 0.3)) / n) * TAU;
    let f =
      1 +
      a2 * Math.cos(2 * ang + p2) +
      a3 * Math.cos(3 * ang + p3) +
      a5 * Math.cos(5 * ang + p5) +
      rnd(-W.jitter, W.jitter);
    f = Math.max(W.minRadiusFrac, f);
    const r = base * f;
    pts.push(Math.cos(ang) * r, Math.sin(ang) * r);
    bound = Math.max(bound, r);
  }
  return { pts, bound };
}

/**
 * Generates the world from a seed (GAME_DESIGN.md §4.3). Deterministic: only the seeded PRNG is
 * used, and every coordinate is quantized. Allocation here is fine; it runs once per map.
 */
export function generateMap(seed: number): WorldMap {
  const rng = new Mulberry32(seed);
  const rnd = (a: number, b: number): number => a + (b - a) * rng.next();
  const islands: Island[] = [];

  /** Tries to place one island; `where` proposes a center. Gives up quietly on a crowded map. */
  function place(type: number, where: () => { x: number; y: number }): void {
    const name = ISLAND_TYPES[type]!;
    const minRadius =
      name === 'port' ? MAP.radius.port : name === 'fort' ? MAP.radius.fort : MAP.radius.min;
    const shape = outline(rng, minRadius);
    for (let relax = 0; relax < 5; relax++) {
      const gap = MAP.islandGap * (1 - relax * 0.25);
      for (let attempt = 0; attempt < MAP.attempts; attempt++) {
        const c = where();
        const cx = quant(c.x);
        const cy = quant(c.y);
        const lo = MAP.edgeMargin + shape.bound;
        const hi = WORLD_SIZE - lo;
        if (cx < lo || cx > hi || cy < lo || cy > hi) continue;
        if (Math.hypot(cx - WORLD_CENTER, cy - WORLD_CENTER) < MAP.spawnClear + shape.bound) {
          continue;
        }
        let ok = true;
        for (const o of islands) {
          if (Math.hypot(cx - o.x, cy - o.y) < shape.bound + o.r + gap) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
        const verts: number[] = [];
        for (let i = 0; i < shape.pts.length; i += 2) {
          verts.push(quant(cx + shape.pts[i]!), quant(cy + shape.pts[i + 1]!));
        }
        islands.push({ type, x: cx, y: cy, r: shape.bound, verts });
        return;
      }
    }
  }

  const polar = (angle: number, dist: number): { x: number; y: number } => ({
    x: WORLD_CENTER + Math.cos(angle) * dist,
    y: WORLD_CENTER + Math.sin(angle) * dist,
  });
  const typeIdx = (t: IslandType): number => ISLAND_TYPES.indexOf(t);
  const Z = MAP.zones;

  // Forts first (inner/middle), then ports (outer/middle, ~120 degrees apart), treasure, flats.
  for (let k = 0; k < MAP.counts.fort; k++) {
    place(typeIdx('fort'), () =>
      polar(
        (k / MAP.counts.fort) * TAU + Math.PI / 3 + rnd(-0.35, 0.35),
        rnd(Z.fort.min, Z.fort.max),
      ),
    );
  }
  for (let k = 0; k < MAP.counts.port; k++) {
    place(typeIdx('port'), () =>
      polar((k / MAP.counts.port) * TAU + 0.2 + rnd(-0.25, 0.25), rnd(Z.port.min, Z.port.max)),
    );
  }
  for (let k = 0; k < MAP.counts.treasure; k++) {
    place(typeIdx('treasure'), () => polar(rnd(0, TAU), rnd(Z.treasure.min, Z.treasure.max)));
  }
  for (let k = 0; k < MAP.counts.flat; k++) {
    place(typeIdx('flat'), () => ({ x: rnd(0, WORLD_SIZE), y: rnd(0, WORLD_SIZE) }));
  }

  // Reef groups in open water.
  const R = MAP.reefs;
  const reefs: { x: number; y: number; r: number }[] = [];
  const centers: { x: number; y: number }[] = [];
  for (let g = 0; g < R.groups; g++) {
    for (let attempt = 0; attempt < MAP.attempts; attempt++) {
      const x = quant(rnd(R.edgeMargin, WORLD_SIZE - R.edgeMargin));
      const y = quant(rnd(R.edgeMargin, WORLD_SIZE - R.edgeMargin));
      if (Math.hypot(x - WORLD_CENTER, y - WORLD_CENTER) < MAP.spawnClear + 30) continue;
      let ok = true;
      for (const o of islands) {
        if (Math.hypot(x - o.x, y - o.y) < o.r + R.islandGap) ok = false;
      }
      for (const c of centers) {
        if (Math.hypot(x - c.x, y - c.y) < R.groupGap) ok = false;
      }
      if (!ok) continue;
      centers.push({ x, y });
      const count = R.perGroup.min + Math.floor(rng.next() * (R.perGroup.max - R.perGroup.min + 1));
      for (let i = 0; i < count; i++) {
        reefs.push({
          x: quant(x + rnd(-R.spread, R.spread)),
          y: quant(y + rnd(-R.spread, R.spread)),
          r: quant(rnd(R.radius.min, R.radius.max)),
        });
      }
      break;
    }
  }

  const total = islands.reduce((sum, o) => sum + o.verts.length / 2, 0);
  const map: WorldMap = {
    seed,
    islandCount: islands.length,
    islandType: new Uint8Array(islands.length),
    islandX: new Float32Array(islands.length),
    islandY: new Float32Array(islands.length),
    islandR: new Float32Array(islands.length),
    vertStart: new Uint16Array(islands.length + 1),
    verts: new Float32Array(total * 2),
    reefCount: reefs.length,
    reefX: new Float32Array(reefs.length),
    reefY: new Float32Array(reefs.length),
    reefR: new Float32Array(reefs.length),
  };
  let at = 0;
  for (let i = 0; i < islands.length; i++) {
    const o = islands[i]!;
    map.islandType[i] = o.type;
    map.islandX[i] = o.x;
    map.islandY[i] = o.y;
    map.islandR[i] = o.r;
    map.vertStart[i] = at;
    map.verts.set(o.verts, at * 2);
    at += o.verts.length / 2;
  }
  map.vertStart[islands.length] = at;
  for (let i = 0; i < reefs.length; i++) {
    map.reefX[i] = reefs[i]!.x;
    map.reefY[i] = reefs[i]!.y;
    map.reefR[i] = reefs[i]!.r;
  }
  return map;
}
