import { ISLAND_COLLISION } from '../config/collision.ts';
import type { ShipDef } from '../config/ships.ts';
import { MAP, WORLD_SIZE } from '../config/world.ts';
import { circleVsWorld } from '../world/query.ts';
import type { WorldMap } from '../world/types.ts';
import type { ShipState } from './types.ts';

/** Receives hard hits of a ship against an island or reef. */
export interface IslandSink {
  onIslandHit(
    shipId: number,
    /** Contact point. */
    x: number,
    y: number,
    /** Speed into the obstacle along the contact normal (world units/s). */
    impact: number,
  ): void;
}

const hit = new Float32Array(3);

/**
 * Keeps a ship out of islands and reefs (GAME_DESIGN.md §4.3, §5.2). Every hit circle of the hull
 * is pushed out along the contact normal; the speed into the obstacle is removed and the rest
 * slides along it, slowed a little each tick. No damage. A few passes resolve corners where two
 * hull circles touch different edges.
 */
export function collideIslands(
  map: WorldMap,
  s: ShipState,
  def: ShipDef,
  shipId: number,
  sink: IslandSink,
): void {
  let worst = 0;
  let contactX = 0;
  let contactY = 0;
  for (let pass = 0; pass < 3; pass++) {
    let touched = false;
    const c = Math.cos(s.heading);
    const sn = Math.sin(s.heading);
    for (let k = 0; k < def.hitCircles.length; k++) {
      const circle = def.hitCircles[k]!;
      const cx = s.x + c * circle.offset;
      const cy = s.y + sn * circle.offset;
      if (!circleVsWorld(map, cx, cy, circle.radius, hit)) continue;
      touched = true;
      const nx = hit[0]!;
      const ny = hit[1]!;
      const push = hit[2]! + ISLAND_COLLISION.slop;
      s.x += nx * push;
      s.y += ny * push;
      let vx = c * s.speed + s.kx;
      let vy = sn * s.speed + s.ky;
      const vn = vx * nx + vy * ny;
      if (vn < 0) {
        vx -= vn * nx;
        vy -= vn * ny;
        vx *= ISLAND_COLLISION.tangentKeep;
        vy *= ISLAND_COLLISION.tangentKeep;
        s.speed = vx * c + vy * sn;
        s.kx = vx - s.speed * c;
        s.ky = vy - s.speed * sn;
        if (-vn > worst) {
          worst = -vn;
          contactX = cx - nx * circle.radius;
          contactY = cy - ny * circle.radius;
        }
      }
    }
    if (!touched) break;
  }
  if (worst > ISLAND_COLLISION.eventSpeed) sink.onIslandHit(shipId, contactX, contactY, worst);
}

/**
 * How deep (0..1) a point is inside the soft wall at the world edge: 0 in open water, 1 at the
 * very edge. The client also uses it for the storm vignette.
 */
export function boundaryDepth(x: number, y: number): number {
  const w = MAP.boundary.width;
  const d = Math.min(x, y, WORLD_SIZE - x, WORLD_SIZE - y);
  return d >= w ? 0 : d <= 0 ? 1 : 1 - d / w;
}

/**
 * Soft world edge (GAME_DESIGN.md §4.1): inside the boundary band a ship slows down and is pushed
 * back toward open water; the very edge is a hard clamp.
 */
export function applyWorldBounds(s: ShipState, dt: number): void {
  const B = MAP.boundary;
  const edge = (d: number): number => (d >= B.width ? 0 : 1 - Math.max(0, d) / B.width);
  const pl = edge(s.x);
  const pr = edge(WORLD_SIZE - s.x);
  const pt = edge(s.y);
  const pb = edge(WORLD_SIZE - s.y);
  const deepest = Math.max(pl, pr, pt, pb);
  if (deepest > 0) {
    s.kx += (pl - pr) * B.push * dt;
    s.ky += (pt - pb) * B.push * dt;
    s.speed *= Math.exp(-B.damp * deepest * dt);
  }
  if (s.x < 0) {
    s.x = 0;
    if (s.kx < 0) s.kx = 0;
  } else if (s.x > WORLD_SIZE) {
    s.x = WORLD_SIZE;
    if (s.kx > 0) s.kx = 0;
  }
  if (s.y < 0) {
    s.y = 0;
    if (s.ky < 0) s.ky = 0;
  } else if (s.y > WORLD_SIZE) {
    s.y = WORLD_SIZE;
    if (s.ky > 0) s.ky = 0;
  }
}
