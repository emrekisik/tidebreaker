import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
} from 'three';
import { ISLAND_TYPES, Mulberry32 } from '@tidebreaker/shared';
import type { WorldMap } from '@tidebreaker/shared';
import { WAVE_MAX } from './waves.ts';

/**
 * Cosmetic islands: the collision outline (shared) is dressed with a low-poly terrain (beach,
 * grass, rocky peaks), trees, boulders, huts and a fort. Everything is generated at load from the
 * map seed and the island index (deterministic), merged into one flat-shaded mesh. No downloads.
 */

const SAND = [0xf0d58f, 0xe2c27a] as const;
const GRASS = [0x62b04a, 0x4f9a3f, 0x7cc255] as const;
const ROCK = [0x8e949c, 0x6f757d, 0xa5abb2] as const;
const SNOW = 0xf1f4f7;
const REEF_ROCK = [0x6a7078, 0x858b93, 0x575c64] as const;
const PINE = [0x2f7a3c, 0x3b8c45] as const;
const ROUND = [0x5cb04b, 0x6fc257] as const;
const TRUNK = 0x7a5535;
const WALL = 0xe8d9b8;
const ROOF = [0x9a4a32, 0xb05a3a] as const;
const STONE = [0x8a7059, 0x9a8267] as const;
const FORT_ROOF = 0x6b4a3a;

/** Where the beach slope starts and how wide it is (world units measured inward from the outline). */
const SHORE_WIDTH = 1.5;
const BEACH_END = 3;
const SEA_FLOOR = -1.2;
const BEACH_TOP = 0.45;

// ---------- deterministic noise (integer hashing, no Math.random)

function hash2(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise in 0..1. */
function noise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

function smooth(a: number, b: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// ---------- triangle soup with one color per face

class Soup {
  readonly pos: number[] = [];
  readonly col: number[] = [];
  private readonly c = new Color();

  tri(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    cx: number,
    cy: number,
    cz: number,
    hex: number,
    shade: number,
  ): void {
    this.c.setHex(hex).multiplyScalar(shade);
    this.pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    for (let i = 0; i < 3; i++) this.col.push(this.c.r, this.c.g, this.c.b);
  }

  /** A quad a-b-c-d (12 numbers) as two triangles. */
  quad(p: readonly number[], hex: number, shade: number): void {
    this.tri(p[0]!, p[1]!, p[2]!, p[3]!, p[4]!, p[5]!, p[6]!, p[7]!, p[8]!, hex, shade);
    this.tri(p[0]!, p[1]!, p[2]!, p[6]!, p[7]!, p[8]!, p[9]!, p[10]!, p[11]!, hex, shade);
  }
}

// ---------- small solids

const T = (1 + Math.sqrt(5)) / 2;
const ICO_V: readonly (readonly [number, number, number])[] = (
  [
    [-1, T, 0],
    [1, T, 0],
    [-1, -T, 0],
    [1, -T, 0],
    [0, -1, T],
    [0, 1, T],
    [0, -1, -T],
    [0, 1, -T],
    [T, 0, -1],
    [T, 0, 1],
    [-T, 0, -1],
    [-T, 0, 1],
  ] as const
).map(([x, y, z]) => {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l] as const;
});
const ICO_F: readonly (readonly [number, number, number])[] = [
  [0, 11, 5],
  [0, 5, 1],
  [0, 1, 7],
  [0, 7, 10],
  [0, 10, 11],
  [1, 5, 9],
  [5, 11, 4],
  [11, 10, 2],
  [10, 7, 6],
  [7, 1, 8],
  [3, 9, 4],
  [3, 4, 2],
  [3, 2, 6],
  [3, 6, 8],
  [3, 8, 9],
  [4, 9, 5],
  [2, 4, 11],
  [6, 2, 10],
  [8, 6, 7],
  [9, 8, 1],
];

/** A lumpy blob (low-poly boulder or tree crown): jittered icosahedron, squashed vertically. */
function blob(
  soup: Soup,
  rng: Mulberry32,
  x: number,
  y: number,
  z: number,
  rx: number,
  ry: number,
  rz: number,
  lump: number,
  colors: readonly number[],
): void {
  const v = ICO_V.map(([a, b, c]) => {
    const k = 1 + (rng.next() - 0.5) * 2 * lump;
    return [x + a * rx * k, y + b * ry * k, z + c * rz * k] as const;
  });
  for (const [i, j, k] of ICO_F) {
    const a = v[i]!;
    const b = v[j]!;
    const c = v[k]!;
    const hex = colors[Math.floor(rng.next() * colors.length)]!;
    soup.tri(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], hex, 0.88 + rng.next() * 0.24);
  }
}

/** A cone (tree layer) standing on y. */
function cone(
  soup: Soup,
  rng: Mulberry32,
  x: number,
  y: number,
  z: number,
  r: number,
  h: number,
  sides: number,
  colors: readonly number[],
): void {
  const hex = colors[Math.floor(rng.next() * colors.length)]!;
  for (let k = 0; k < sides; k++) {
    const a0 = (k / sides) * Math.PI * 2;
    const a1 = ((k + 1) / sides) * Math.PI * 2;
    soup.tri(
      x + Math.cos(a0) * r,
      y,
      z + Math.sin(a0) * r,
      x + Math.cos(a1) * r,
      y,
      z + Math.sin(a1) * r,
      x,
      y + h,
      z,
      hex,
      0.85 + 0.3 * (0.5 + 0.5 * Math.cos(a0 - 0.8)),
    );
  }
}

/** An upright box rotated by `yaw` about its center (no bottom face). */
function box(
  soup: Soup,
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  yaw: number,
  hex: number,
): void {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const corner = (dx: number, dz: number, dy: number): [number, number, number] => [
    x + (dx * c - dz * s) * sx * 0.5,
    y + dy * sy,
    z + (dx * s + dz * c) * sz * 0.5,
  ];
  const b = [corner(-1, -1, 0), corner(1, -1, 0), corner(1, 1, 0), corner(-1, 1, 0)];
  const t = [corner(-1, -1, 1), corner(1, -1, 1), corner(1, 1, 1), corner(-1, 1, 1)];
  const shades = [0.8, 0.95, 0.72, 0.88];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    soup.quad([...b[i]!, ...b[j]!, ...t[j]!, ...t[i]!], hex, shades[i]!);
  }
  soup.quad([...t[0]!, ...t[1]!, ...t[2]!, ...t[3]!], hex, 1.05);
}

/** A gable roof over a footprint, rotated by `yaw`. */
function roof(
  soup: Soup,
  x: number,
  y: number,
  z: number,
  sx: number,
  sz: number,
  h: number,
  yaw: number,
  hex: number,
): void {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const p = (dx: number, dz: number, dy: number): [number, number, number] => [
    x + (dx * c - dz * s) * sx * 0.55,
    y + dy,
    z + (dx * s + dz * c) * sz * 0.55,
  ];
  const a = p(-1, -1, 0);
  const b = p(1, -1, 0);
  const cc = p(1, 1, 0);
  const d = p(-1, 1, 0);
  const r0 = p(-1, 0, h);
  const r1 = p(1, 0, h);
  soup.quad([...a, ...b, ...r1, ...r0], hex, 0.9);
  soup.quad([...cc, ...d, ...r0, ...r1], hex, 1.1);
  soup.tri(a[0], a[1], a[2], d[0], d[1], d[2], r0[0], r0[1], r0[2], hex, 0.8);
  soup.tri(b[0], b[1], b[2], cc[0], cc[1], cc[2], r1[0], r1[1], r1[2], hex, 0.8);
}

// ---------- island terrain

const ANGLES = 64;

interface Peak {
  x: number;
  z: number;
  rho: number;
  h: number;
}

class Terrain {
  readonly cx: number;
  readonly cz: number;
  readonly R: number;
  readonly type: string;
  readonly seed: number;
  /** Distance from the center to the outline, sampled around the island. */
  private readonly edge = new Float32Array(ANGLES);
  readonly peaks: Peak[] = [];
  flat: { x: number; z: number; rho: number; h: number } | null = null;
  maxHeight = 0;

  constructor(map: WorldMap, i: number, rng: Mulberry32) {
    this.cx = map.islandX[i]!;
    this.cz = map.islandY[i]!;
    this.R = map.islandR[i]!;
    this.type = ISLAND_TYPES[map.islandType[i]!]!;
    this.seed = Math.floor(rng.next() * 1e9);
    const s = map.vertStart[i]!;
    const n = map.vertStart[i + 1]! - s;
    for (let a = 0; a < ANGLES; a++) {
      const th = (a / ANGLES) * Math.PI * 2;
      const dx = Math.cos(th);
      const dz = Math.sin(th);
      // Ray from the center against every outline edge; the outline is star-shaped.
      let best = Infinity;
      for (let k = 0; k < n; k++) {
        const ax = map.verts[(s + k) * 2]! - this.cx;
        const ay = map.verts[(s + k) * 2 + 1]! - this.cz;
        const bx = map.verts[(s + ((k + 1) % n)) * 2]! - this.cx;
        const by = map.verts[(s + ((k + 1) % n)) * 2 + 1]! - this.cz;
        const ex = bx - ax;
        const ey = by - ay;
        const den = dx * ey - dz * ex;
        if (Math.abs(den) < 1e-9) continue;
        const t = (ax * ey - ay * ex) / den;
        const u = (ax * dz - ay * dx) / den;
        if (t > 0 && u >= 0 && u <= 1) best = Math.min(best, t);
      }
      this.edge[a] = best === Infinity ? this.R : best;
    }

    // Hills: where the rocky peaks are. Ports and treasure islands are gentler, forts flat on top.
    const R = this.R;
    const gentle =
      this.type === 'treasure'
        ? 0.55
        : this.type === 'port'
          ? 0.75
          : this.type === 'flat'
            ? 1
            : 0.6;
    const count = R >= 26 && rng.next() < 0.7 ? 2 : 1;
    for (let k = 0; k < count; k++) {
      const ang = rng.next() * Math.PI * 2;
      const dist = (this.type === 'fort' ? 0.55 + rng.next() * 0.15 : 0.1 + rng.next() * 0.4) * R;
      const h = (4 + R * 0.2 + rng.next() * 3) * gentle * (this.type === 'fort' ? 0.7 : 1);
      this.peaks.push({
        x: this.cx + Math.cos(ang) * dist,
        z: this.cz + Math.sin(ang) * dist,
        rho: R * (0.24 + rng.next() * 0.12),
        h,
      });
    }
    if (this.type === 'fort') this.flat = { x: this.cx, z: this.cz, rho: R * 0.42, h: 1.5 };
    // Highest point (for the rock and snow lines).
    for (let k = 0; k < 400; k++) {
      const a = rng.next() * Math.PI * 2;
      const r = Math.sqrt(rng.next()) * R * 0.8;
      this.maxHeight = Math.max(
        this.maxHeight,
        this.height(this.cx + Math.cos(a) * r, this.cz + Math.sin(a) * r),
      );
    }
  }

  /** Outline radius toward angle `th`. */
  edgeAt(th: number): number {
    const t = (((th / (Math.PI * 2)) % 1) + 1) % 1;
    const f = t * ANGLES;
    const i = Math.floor(f);
    const a = this.edge[i % ANGLES]!;
    const b = this.edge[(i + 1) % ANGLES]!;
    return a + (b - a) * (f - i);
  }

  /** Distance inward from the outline (negative outside). */
  inland(x: number, z: number): number {
    const dx = x - this.cx;
    const dz = z - this.cz;
    return this.edgeAt(Math.atan2(dz, dx)) - Math.hypot(dx, dz);
  }

  height(x: number, z: number): number {
    const s = this.inland(x, z);
    if (s <= 0) return SEA_FLOOR;
    const shore = SEA_FLOOR + (BEACH_TOP - SEA_FLOOR) * smooth(0, SHORE_WIDTH, s);
    const plateau =
      0.3 * smooth(SHORE_WIDTH, 7, s) +
      0.3 * (noise(x * 0.13, z * 0.13, this.seed) - 0.5) * smooth(SHORE_WIDTH, 5, s);
    let hills = 0;
    for (const p of this.peaks) {
      const d = Math.hypot(x - p.x, z - p.z) / p.rho;
      hills += p.h * Math.exp(-d * d);
    }
    // Jagged peaks: the higher, the rougher.
    const rough = noise(x * 0.34, z * 0.34, this.seed + 7);
    hills *= 0.62 + 0.76 * rough;
    hills += hills > 1.8 ? (noise(x * 0.8, z * 0.8, this.seed + 3) - 0.5) * 2 : 0;
    let y = shore + plateau + Math.max(0, hills) * smooth(3, 8, s);
    if (this.flat) {
      const w =
        1 -
        smooth(
          this.flat.rho * 0.7,
          this.flat.rho * 1.15,
          Math.hypot(x - this.flat.x, z - this.flat.z),
        );
      y += (this.flat.h - y) * w;
    }
    return y;
  }
}

/** Tints a face by what it is: sand, grass, bare rock or snow. */
function faceColor(t: Terrain, x: number, z: number, y: number, ny: number): number {
  const s = t.inland(x, z);
  const sandWidth = t.type === 'treasure' ? 6 : BEACH_END;
  if (s < sandWidth) return SAND[noise(x * 0.5, z * 0.5, t.seed + 11) < 0.5 ? 0 : 1]!;
  const rockLine = t.maxHeight * 0.5;
  const n = noise(x * 0.4, z * 0.4, t.seed + 5);
  if (t.maxHeight > 6.5 && y > t.maxHeight * 0.86) return SNOW;
  if (ny < 0.8 || y > rockLine + (n - 0.5) * 1.6) {
    return ROCK[n < 0.33 ? 0 : n < 0.66 ? 1 : 2]!;
  }
  return GRASS[n < 0.4 ? 0 : n < 0.75 ? 1 : 2]!;
}

function addTerrain(soup: Soup, t: Terrain, rng: Mulberry32): void {
  const R = t.R;
  const N = 42;
  // Ring distances as fractions of the outline radius: fine near the shore, coarser inland.
  const f: number[] = [1, 1 - 1.5 / R, 1 - 3.4 / R];
  while (f[f.length - 1]! > 0.13) f.push(f[f.length - 1]! * 0.82);
  f.push(0);
  const J = f.length;
  // Vertex grid with a little jitter (shared by neighbouring faces) so the mesh is not regular.
  const vx: number[][] = [];
  const vz: number[][] = [];
  const vy: number[][] = [];
  for (let j = 0; j < J; j++) {
    vx.push([]);
    vz.push([]);
    vy.push([]);
    for (let k = 0; k < N; k++) {
      let ang = (k / N) * Math.PI * 2;
      let fr = f[j]!;
      if (j > 0 && j < J - 1) {
        ang += (rng.next() - 0.5) * 0.7 * ((Math.PI * 2) / N);
        fr *= 1 + (rng.next() - 0.5) * 0.12;
      }
      const r = j === J - 1 ? 0 : fr * t.edgeAt(ang);
      const x = t.cx + Math.cos(ang) * r;
      const z = t.cz + Math.sin(ang) * r;
      vx[j]!.push(x);
      vz[j]!.push(z);
      vy[j]!.push(t.height(x, z));
    }
  }
  const emit = (a: [number, number], b: [number, number], c: [number, number]): void => {
    const [ja, ka] = a;
    const [jb, kb] = b;
    const [jc, kc] = c;
    const ax = vx[ja]![ka]!;
    const ay = vy[ja]![ka]!;
    const az = vz[ja]![ka]!;
    const bx = vx[jb]![kb]!;
    const by = vy[jb]![kb]!;
    const bz = vz[jb]![kb]!;
    const cx = vx[jc]![kc]!;
    const cy = vy[jc]![kc]!;
    const cz = vz[jc]![kc]!;
    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const wx = cx - ax;
    const wy = cy - ay;
    const wz = cz - az;
    const nx = uy * wz - uz * wy;
    const ny = uz * wx - ux * wz;
    const nz = ux * wy - uy * wx;
    const up = Math.abs(ny) / (Math.hypot(nx, ny, nz) || 1);
    const hex = faceColor(t, (ax + bx + cx) / 3, (az + bz + cz) / 3, (ay + by + cy) / 3, up);
    soup.tri(ax, ay, az, bx, by, bz, cx, cy, cz, hex, 0.9 + rng.next() * 0.2);
  };
  for (let j = 0; j < J - 1; j++) {
    for (let k = 0; k < N; k++) {
      const k2 = (k + 1) % N;
      if (j === J - 2) {
        emit([j, k], [j, k2], [j + 1, k]);
      } else if ((j + k) % 2 === 0) {
        emit([j, k], [j, k2], [j + 1, k2]);
        emit([j, k], [j + 1, k2], [j + 1, k]);
      } else {
        emit([j, k], [j, k2], [j + 1, k]);
        emit([j, k2], [j + 1, k2], [j + 1, k]);
      }
    }
  }
}

/** Trees, huts, a fort and boulders on top of the terrain. */
function addProps(soup: Soup, t: Terrain, rng: Mulberry32): void {
  const R = t.R;
  const taken: { x: number; z: number; r: number }[] = [];
  const free = (x: number, z: number, r: number): boolean => {
    for (const o of taken) if (Math.hypot(x - o.x, z - o.z) < o.r + r) return false;
    return true;
  };
  const slopeAt = (x: number, z: number): number => {
    const e = 0.8;
    const gx = (t.height(x + e, z) - t.height(x - e, z)) / (2 * e);
    const gz = (t.height(x, z + e) - t.height(x, z - e)) / (2 * e);
    return Math.hypot(gx, gz);
  };
  const spot = (
    minInland: number,
    maxSlope: number,
    maxY: number,
  ): { x: number; z: number; y: number } | null => {
    for (let a = 0; a < 40; a++) {
      const ang = rng.next() * Math.PI * 2;
      const r = Math.sqrt(rng.next()) * t.edgeAt(ang) * 0.95;
      const x = t.cx + Math.cos(ang) * r;
      const z = t.cz + Math.sin(ang) * r;
      if (t.inland(x, z) < minInland) continue;
      const y = t.height(x, z);
      if (y > maxY || slopeAt(x, z) > maxSlope) continue;
      return { x, z, y };
    }
    return null;
  };
  const rockLine = t.maxHeight * 0.5;

  if (t.type === 'fort') {
    // Courtyard walls with four corner towers and a keep, on the flattened top.
    const side = Math.min(R * 0.62, 15);
    const y = t.flat!.h;
    const half = side / 2;
    const wallH = 1.3;
    box(soup, t.cx, y, t.cz - half, side, wallH, 0.7, 0, STONE[0]);
    box(soup, t.cx, y, t.cz + half, side, wallH, 0.7, 0, STONE[0]);
    box(soup, t.cx - half, y, t.cz, 0.7, wallH, side, 0, STONE[1]);
    box(soup, t.cx + half, y, t.cz, 0.7, wallH, side, 0, STONE[1]);
    for (const [dx, dz] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const) {
      const tx = t.cx + dx * half;
      const tz = t.cz + dz * half;
      box(soup, tx, y, tz, 2.1, 2.6, 2.1, 0, STONE[1]);
      roof(soup, tx, y + 2.6, tz, 2.4, 2.4, 1.1, 0, FORT_ROOF);
    }
    box(soup, t.cx, y, t.cz, side * 0.3, 2.4, side * 0.3, 0.2, STONE[0]);
    roof(soup, t.cx, y + 2.4, t.cz, side * 0.34, side * 0.34, 1.3, 0.2, FORT_ROOF);
    taken.push({ x: t.cx, z: t.cz, r: half * 1.5 });
  }

  if (t.type === 'port') {
    // A little town: huts clustered around one stretch of coast.
    const face = rng.next() * Math.PI * 2;
    const huts = Math.min(11, 4 + Math.floor(R / 5));
    for (let n = 0, tries = 0; n < huts && tries < 120; tries++) {
      const ang = face + (rng.next() - 0.5) * 1.5;
      const r = t.edgeAt(ang) - (3.6 + rng.next() * Math.min(9, R * 0.35));
      const x = t.cx + Math.cos(ang) * r;
      const z = t.cz + Math.sin(ang) * r;
      const y = t.height(x, z);
      if (y > rockLine || slopeAt(x, z) > 0.35 || !free(x, z, 1.7)) continue;
      const yaw = ang + Math.PI / 2 + (rng.next() - 0.5) * 0.5;
      const w = 1.5 + rng.next() * 0.5;
      box(soup, x, y, z, w, 1.1, 1.3, yaw, WALL);
      roof(soup, x, y + 1.1, z, w + 0.2, 1.4, 0.8, yaw, ROOF[Math.floor(rng.next() * 2)]!);
      taken.push({ x, z, r: 1.5 });
      n++;
    }
  }

  // Trees on the grassy ground.
  const density = t.type === 'treasure' ? 0.02 : t.type === 'fort' ? 0.04 : 0.065;
  const trees = Math.min(130, Math.round(R * R * density));
  for (let n = 0, tries = 0; n < trees && tries < trees * 10; tries++) {
    const p = spot(BEACH_END + 1, 0.55, rockLine * 1.05);
    if (!p || !free(p.x, p.z, 1)) continue;
    taken.push({ x: p.x, z: p.z, r: 0.95 });
    const k = 1 + rng.next() * 0.7;
    if (rng.next() < 0.5) {
      // Pine: trunk and two stacked cones.
      box(soup, p.x, p.y, p.z, 0.3, 0.6 * k, 0.3, 0, TRUNK);
      cone(soup, rng, p.x, p.y + 0.4 * k, p.z, 1.0 * k, 1.9 * k, 6, PINE);
      cone(soup, rng, p.x, p.y + 1.4 * k, p.z, 0.72 * k, 1.5 * k, 6, PINE);
    } else {
      // Round tree: trunk and a lumpy crown.
      box(soup, p.x, p.y, p.z, 0.32, 0.9 * k, 0.32, 0, TRUNK);
      blob(soup, rng, p.x, p.y + 1.55 * k, p.z, 1.0 * k, 0.9 * k, 1.0 * k, 0.15, ROUND);
    }
    n++;
  }

  // Boulders on the beach and on rocky ground.
  const rocks = Math.max(6, Math.round(R / 2));
  for (let n = 0; n < rocks; n++) {
    const onBeach = rng.next() < 0.45;
    const p = onBeach ? spot(0.4, 1, 1) : spot(BEACH_END, 3, 99);
    if (!p) continue;
    const k = 0.45 + rng.next() * 0.8;
    blob(soup, rng, p.x, p.y + 0.15 * k, p.z, k * 1.1, k * 0.75, k, 0.25, ROCK);
  }
  // Jagged rock spires on the heights, like the sea stacks in the references.
  const spires = Math.round(R / 8);
  for (let n = 0; n < spires; n++) {
    const p = spot(BEACH_END, 3, 99);
    if (!p || p.y < rockLine * 0.7) continue;
    const k = 0.8 + rng.next() * 1.1;
    cone(soup, rng, p.x, p.y - 0.3, p.z, 1.1 * k, (2.6 + rng.next() * 2.4) * k, 5, ROCK);
    cone(
      soup,
      rng,
      p.x + 0.9 * k,
      p.y - 0.3,
      p.z + 0.4 * k,
      0.7 * k,
      (1.6 + rng.next() * 1.4) * k,
      5,
      ROCK,
    );
  }
}

/** A reef: a jagged boulder with a few smaller ones around it (matches the collision circle). */
function addReef(soup: Soup, map: WorldMap, i: number): void {
  const rng = new Mulberry32(0x7ee1 + i * 104729);
  const x = map.reefX[i]!;
  const z = map.reefY[i]!;
  const r = map.reefR[i]!;
  blob(soup, rng, x, 0.2, z, r * 0.9, 1.3 + r * 0.22, r * 0.9, 0.25, REEF_ROCK);
  for (let k = 0; k < 3; k++) {
    const a = rng.next() * Math.PI * 2;
    const d = r * (0.55 + rng.next() * 0.3);
    const s = r * (0.28 + rng.next() * 0.2);
    blob(soup, rng, x + Math.cos(a) * d, 0, z + Math.sin(a) * d, s, s * 1.1, s, 0.3, REEF_ROCK);
  }
}

// ---------- shore foam and shallows

interface ShoreBand {
  /** Offsets from the outline (world units) and an extra wobble amplitude on the outer edge. */
  inner: number;
  outer: number;
  wobble: number;
  y: number;
  rgb: readonly [number, number, number];
  a0: number;
  a1: number;
}

function addShore(
  pos: number[],
  col: number[],
  radiusAt: (theta: number) => number,
  cx: number,
  cz: number,
  seed: number,
): void {
  const foamY = WAVE_MAX + 0.12;
  // Widest first, foam last, so they blend in that order.
  const bands: ShoreBand[] = [
    { inner: 0, outer: 17, wobble: 11, y: foamY - 0.1, rgb: [0.4, 0.88, 0.92], a0: 0.3, a1: 0 },
    { inner: 0, outer: 8, wobble: 6, y: foamY - 0.05, rgb: [0.3, 0.85, 0.88], a0: 0.6, a1: 0 },
    { inner: -1.8, outer: 2.6, wobble: 1.2, y: foamY, rgb: [1, 1, 1], a0: 0.95, a1: 0 },
  ];
  const n = 56;
  for (const b of bands) {
    const at = (k: number, outerEdge: boolean): [number, number] => {
      const th = (k / n) * Math.PI * 2;
      let off = b.inner;
      if (outerEdge) {
        const wob = (noise(Math.cos(th) * 2.2 + 9, Math.sin(th) * 2.2 + 9, seed) - 0.5) * 2;
        off = b.outer + wob * b.wobble;
      }
      const r = radiusAt(th) + off;
      return [cx + Math.cos(th) * r, cz + Math.sin(th) * r];
    };
    for (let k = 0; k < n; k++) {
      const [x0, z0] = at(k, false);
      const [x1, z1] = at(k + 1, false);
      const [x2, z2] = at(k + 1, true);
      const [x3, z3] = at(k, true);
      pos.push(x0, b.y, z0, x1, b.y, z1, x2, b.y, z2, x0, b.y, z0, x2, b.y, z2, x3, b.y, z3);
      const i = [...b.rgb, b.a0];
      const o = [...b.rgb, b.a1];
      col.push(...i, ...i, ...o, ...i, ...o, ...o);
    }
  }
}

/**
 * The generated islands and reefs. Each island is its own pair of meshes (land + translucent shore
 * foam), so islands off screen are culled; all reefs share one pair. Only a few islands are ever
 * on screen at once, so this costs a handful of draw calls and saves processing the rest.
 */
export class IslandView {
  /** Everything to add to the scene. */
  readonly objects: Mesh[] = [];
  private readonly shoreMat: MeshBasicMaterial;

  constructor(map: WorldMap) {
    const landMat = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide });
    this.shoreMat = new MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    });
    const add = (soup: Soup, pos: number[], col: number[], cull: boolean): void => {
      const geo = new BufferGeometry();
      geo.setAttribute('position', new Float32BufferAttribute(soup.pos, 3));
      geo.setAttribute('color', new Float32BufferAttribute(soup.col, 3));
      geo.computeVertexNormals();
      const land = new Mesh(geo, landMat);
      land.frustumCulled = cull;
      const sgeo = new BufferGeometry();
      sgeo.setAttribute('position', new Float32BufferAttribute(pos, 3));
      sgeo.setAttribute('color', new Float32BufferAttribute(col, 4));
      const shore = new Mesh(sgeo, this.shoreMat);
      shore.frustumCulled = cull;
      shore.renderOrder = 1;
      this.objects.push(land, shore);
    };
    for (let i = 0; i < map.islandCount; i++) {
      const soup = new Soup();
      const pos: number[] = [];
      const col: number[] = [];
      const rng = new Mulberry32(0x15a4d + i * 7919 + map.seed * 31);
      const t = new Terrain(map, i, rng);
      addTerrain(soup, t, rng);
      addProps(soup, t, rng);
      addShore(pos, col, (th) => t.edgeAt(th), t.cx, t.cz, t.seed);
      add(soup, pos, col, true);
    }
    const soup = new Soup();
    const pos: number[] = [];
    const col: number[] = [];
    for (let i = 0; i < map.reefCount; i++) {
      addReef(soup, map, i);
      const r = map.reefR[i]!;
      addShore(pos, col, () => r * 0.95, map.reefX[i]!, map.reefY[i]!, i * 17 + 1);
    }
    add(soup, pos, col, false);
  }

  /** The foam at the waterline breathes a little. */
  update(timeSec: number): void {
    this.shoreMat.opacity = 0.85 + 0.15 * Math.sin(timeSec * 1.3);
  }
}
