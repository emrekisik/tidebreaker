import type { WorldMap } from './types.ts';

/** True when (x, y) lies inside island `i` (even-odd rule). */
export function pointInIsland(map: WorldMap, i: number, x: number, y: number): boolean {
  const s = map.vertStart[i]!;
  const n = map.vertStart[i + 1]! - s;
  const v = map.verts;
  let inside = false;
  let bx = v[(s + n - 1) * 2]!;
  let by = v[(s + n - 1) * 2 + 1]!;
  for (let k = 0; k < n; k++) {
    const ax = v[(s + k) * 2]!;
    const ay = v[(s + k) * 2 + 1]!;
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
    bx = ax;
    by = ay;
  }
  return inside;
}

/**
 * Finds the deepest overlap between a circle and the islands/reefs. On a hit, writes the push-out
 * direction (unit vector from the obstacle toward the circle) and the overlap depth into
 * `out[0..2]` = (nx, ny, depth) and returns true. Allocation-free.
 */
export function circleVsWorld(
  map: WorldMap,
  x: number,
  y: number,
  r: number,
  out: Float32Array,
): boolean {
  let best = 0;
  const v = map.verts;
  for (let i = 0; i < map.islandCount; i++) {
    const dx = x - map.islandX[i]!;
    const dy = y - map.islandY[i]!;
    const reach = map.islandR[i]! + r;
    if (dx * dx + dy * dy > reach * reach) continue;
    const s = map.vertStart[i]!;
    const n = map.vertStart[i + 1]! - s;
    let minD2 = Infinity;
    let cxp = 0;
    let cyp = 0;
    let bx = v[(s + n - 1) * 2]!;
    let by = v[(s + n - 1) * 2 + 1]!;
    for (let k = 0; k < n; k++) {
      const ax = v[(s + k) * 2]!;
      const ay = v[(s + k) * 2 + 1]!;
      // Closest point on edge b -> a.
      const ex = ax - bx;
      const ey = ay - by;
      const len2 = ex * ex + ey * ey;
      let t = len2 > 0 ? ((x - bx) * ex + (y - by) * ey) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = bx + ex * t;
      const py = by + ey * t;
      const d2 = (x - px) * (x - px) + (y - py) * (y - py);
      if (d2 < minD2) {
        minD2 = d2;
        cxp = px;
        cyp = py;
      }
      bx = ax;
      by = ay;
    }
    const d = Math.sqrt(minD2);
    const inside = pointInIsland(map, i, x, y);
    let depth: number;
    let nx: number;
    let ny: number;
    if (inside) {
      depth = d + r;
      // Push out through the nearest edge.
      nx = d > 1e-6 ? (cxp - x) / d : dx;
      ny = d > 1e-6 ? (cyp - y) / d : dy;
    } else if (d < r) {
      depth = r - d;
      nx = d > 1e-6 ? (x - cxp) / d : dx;
      ny = d > 1e-6 ? (y - cyp) / d : dy;
    } else {
      continue;
    }
    if (depth > best) {
      const len = Math.sqrt(nx * nx + ny * ny) || 1;
      best = depth;
      out[0] = nx / len;
      out[1] = ny / len;
      out[2] = depth;
    }
  }
  for (let i = 0; i < map.reefCount; i++) {
    const dx = x - map.reefX[i]!;
    const dy = y - map.reefY[i]!;
    const reach = map.reefR[i]! + r;
    const d2 = dx * dx + dy * dy;
    if (d2 >= reach * reach) continue;
    const d = Math.sqrt(d2);
    const depth = reach - d;
    if (depth > best) {
      best = depth;
      out[0] = d > 1e-6 ? dx / d : 1;
      out[1] = d > 1e-6 ? dy / d : 0;
      out[2] = depth;
    }
  }
  return best > 0;
}

/**
 * First point where the segment (x0, y0) -> (x1, y1) enters an island or reef, as a fraction
 * 0..1 of the segment, or -1 when it stays in open water. A segment that starts inside an
 * island reports 0. Swept test, so fast projectiles cannot tunnel through a thin coast.
 */
export function segmentVsWorld(
  map: WorldMap,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  let best = 2;
  const v = map.verts;
  for (let i = 0; i < map.islandCount; i++) {
    // Reject by the bounding circle: distance from the island center to the segment.
    const ox = map.islandX[i]! - x0;
    const oy = map.islandY[i]! - y0;
    let t0 = len2 > 0 ? (ox * dx + oy * dy) / len2 : 0;
    t0 = t0 < 0 ? 0 : t0 > 1 ? 1 : t0;
    const qx = ox - dx * t0;
    const qy = oy - dy * t0;
    const br = map.islandR[i]!;
    if (qx * qx + qy * qy > br * br) continue;
    if (pointInIsland(map, i, x0, y0)) return 0;
    const s = map.vertStart[i]!;
    const n = map.vertStart[i + 1]! - s;
    let bx = v[(s + n - 1) * 2]!;
    let by = v[(s + n - 1) * 2 + 1]!;
    for (let k = 0; k < n; k++) {
      const ax = v[(s + k) * 2]!;
      const ay = v[(s + k) * 2 + 1]!;
      // Solve x0 + t d = b + u e for t, u in [0, 1].
      const ex = ax - bx;
      const ey = ay - by;
      const den = dx * ey - dy * ex;
      if (den !== 0) {
        const t = ((bx - x0) * ey - (by - y0) * ex) / den;
        const u = ((bx - x0) * dy - (by - y0) * dx) / den;
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1 && t < best) best = t;
      }
      bx = ax;
      by = ay;
    }
  }
  for (let i = 0; i < map.reefCount; i++) {
    const ox = x0 - map.reefX[i]!;
    const oy = y0 - map.reefY[i]!;
    const r = map.reefR[i]!;
    const c = ox * ox + oy * oy - r * r;
    if (c <= 0) return 0;
    if (len2 === 0) continue;
    const b = 2 * (ox * dx + oy * dy);
    const disc = b * b - 4 * len2 * c;
    if (disc < 0) continue;
    const t = (-b - Math.sqrt(disc)) / (2 * len2);
    if (t >= 0 && t <= 1 && t < best) best = t;
  }
  return best <= 1 ? best : -1;
}
