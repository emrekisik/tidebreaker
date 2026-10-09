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

/** Colors by island type: [grass low, grass high, rock top]. Sand is shared. */
const PALETTE: Record<string, readonly [number, number, number]> = {
  port: [0x6f9a52, 0x5f8a48, 0x9aa0a8],
  fort: [0x5b7f43, 0x4b6e3c, 0x6b7078],
  treasure: [0x78a850, 0x68984a, 0xb5a98a],
  flat: [0x4f9a46, 0x3f8a3c, 0x8a9199],
};
const SAND_WET = 0xc2ac72;
const SAND = 0xead48f;
const REEF_ROCK = [0x5b6068, 0x7a8088] as const;

/** Builds flat-shaded triangles into plain arrays, one color per face. */
class Soup {
  readonly pos: number[] = [];
  readonly col: number[] = [];
  private readonly c = new Color();

  face(
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
}

interface Ring {
  /** Corner positions (x, z pairs) and height. */
  xz: number[];
  y: number;
  hex: number;
}

/** Joins two rings of equal corner count with quads (two triangles each), upward-facing. */
function strip(soup: Soup, lower: Ring, upper: Ring, rng: Mulberry32): void {
  const n = lower.xz.length / 2;
  for (let k = 0; k < n; k++) {
    const j = (k + 1) % n;
    const ax = lower.xz[k * 2]!;
    const az = lower.xz[k * 2 + 1]!;
    const bx = lower.xz[j * 2]!;
    const bz = lower.xz[j * 2 + 1]!;
    const cx = upper.xz[j * 2]!;
    const cz = upper.xz[j * 2 + 1]!;
    const dx = upper.xz[k * 2]!;
    const dz = upper.xz[k * 2 + 1]!;
    const shade = 0.88 + rng.next() * 0.24;
    // Counter-clockwise seen from outside: lower k -> lower j -> upper j, then upper j -> upper k.
    soup.face(ax, lower.y, az, bx, lower.y, bz, cx, upper.y, cz, upper.hex, shade);
    soup.face(ax, lower.y, az, cx, upper.y, cz, dx, upper.y, dz, upper.hex, shade * 0.97);
  }
}

/** Corner positions of an island scaled about its center, with a little deterministic wobble. */
function scaled(
  map: WorldMap,
  i: number,
  scale: number,
  wobble: number,
  rng: Mulberry32,
): number[] {
  const s = map.vertStart[i]!;
  const n = map.vertStart[i + 1]! - s;
  const cx = map.islandX[i]!;
  const cy = map.islandY[i]!;
  const out: number[] = [];
  for (let k = 0; k < n; k++) {
    const f = scale * (1 + (rng.next() - 0.5) * wobble);
    out.push(cx + (map.verts[(s + k) * 2]! - cx) * f, cy + (map.verts[(s + k) * 2 + 1]! - cy) * f);
  }
  return out;
}

/** An island: sand beach, grassy slopes and a rocky top, built from the collision outline. */
function addIsland(soup: Soup, map: WorldMap, i: number): void {
  const rng = new Mulberry32(0x15a4d + i * 7919);
  const type = ISLAND_TYPES[map.islandType[i]!]!;
  const [grassLow, grassHigh, rock] = PALETTE[type]!;
  const R = map.islandR[i]!;
  const h = 2.2 + R * 0.07;
  const s = map.vertStart[i]!;
  const n = map.vertStart[i + 1]! - s;
  // Ring corner positions must correspond: the same corner index, scaled with its own wobble.
  const ring = (scale: number, wobble: number, y: number, hex: number): Ring => ({
    xz: scaled(map, i, scale, wobble, rng),
    y: y + (rng.next() - 0.5) * 0.3,
    hex,
  });
  const base = { xz: scaled(map, i, 1, 0, rng), y: -1.2, hex: SAND_WET };
  // Offsets in world units (not fractions), so the waterline sits ~0.5 unit inside the outline
  // on small and large islands alike; the foam band starts inside the waterline.
  const beach = ring(1 - 2.2 / R, 0.01, 0.4, SAND);
  const lower = ring(Math.min(0.9, 1 - 9 / R), 0.05, 0.9 + h * 0.12, grassLow);
  const mid = ring(0.62, 0.1, h * 0.55, grassHigh);
  const top = ring(0.36, 0.14, h, new Color(grassHigh).lerp(new Color(rock), 0.45).getHex());
  strip(soup, base, beach, rng);
  strip(soup, beach, lower, rng);
  strip(soup, lower, mid, rng);
  strip(soup, mid, top, rng);
  // Cap: a fan from the center.
  const cx = map.islandX[i]!;
  const cz = map.islandY[i]!;
  const cy = h * 1.04;
  for (let k = 0; k < n; k++) {
    const j = (k + 1) % n;
    soup.face(
      cx,
      cy,
      cz,
      top.xz[j * 2]!,
      top.y,
      top.xz[j * 2 + 1]!,
      top.xz[k * 2]!,
      top.y,
      top.xz[k * 2 + 1]!,
      rock,
      0.92 + rng.next() * 0.16,
    );
  }
}

/** A reef: a small low-poly rock. */
function addReef(soup: Soup, map: WorldMap, i: number): void {
  const rng = new Mulberry32(0x7ee1 + i * 104729);
  const x = map.reefX[i]!;
  const z = map.reefY[i]!;
  const r = map.reefR[i]!;
  const n = 7;
  const ringAt = (scale: number, y: number, hex: number): Ring => {
    const xz: number[] = [];
    for (let k = 0; k < n; k++) {
      const a = ((k + (rng.next() - 0.5) * 0.4) / n) * Math.PI * 2;
      const f = scale * (0.85 + rng.next() * 0.3);
      xz.push(x + Math.cos(a) * r * f, z + Math.sin(a) * r * f);
    }
    return { xz, y, hex };
  };
  const base = ringAt(1, -1, REEF_ROCK[0]);
  const mid = ringAt(0.8, 0.5, REEF_ROCK[0]);
  const top = ringAt(0.45, 0.9 + r * 0.12, REEF_ROCK[1]);
  strip(soup, base, mid, rng);
  strip(soup, mid, top, rng);
  const cy = 1.1 + r * 0.12;
  for (let k = 0; k < n; k++) {
    const j = (k + 1) % n;
    soup.face(
      x,
      cy,
      z,
      top.xz[j * 2]!,
      top.y,
      top.xz[j * 2 + 1]!,
      top.xz[k * 2]!,
      top.y,
      top.xz[k * 2 + 1]!,
      REEF_ROCK[1],
      1,
    );
  }
}

/** Translucent bands around a polygon (foam at the waterline, pale shallows further out). */
function addShore(
  pos: number[],
  col: number[],
  outline: readonly number[],
  cx: number,
  cz: number,
): void {
  const n = outline.length / 2;
  const foamY = WAVE_MAX + 0.12;
  const bands = [
    // [inner offset, outer offset, y, rgb, inner alpha, outer alpha]
    [-1.8, 3, foamY, [1, 1, 1], 0.95, 0],
    [0, 15, foamY - 0.05, [0.45, 0.88, 0.9], 0.38, 0],
  ] as const;
  const out = (k: number, offset: number): [number, number] => {
    const px = outline[k * 2]!;
    const pz = outline[k * 2 + 1]!;
    const dx = px - cx;
    const dz = pz - cz;
    const len = Math.hypot(dx, dz) || 1;
    return [px + (dx / len) * offset, pz + (dz / len) * offset];
  };
  for (const [o0, o1, y, rgb, a0, a1] of bands) {
    for (let k = 0; k < n; k++) {
      const j = (k + 1) % n;
      const [x0, z0] = out(k, o0);
      const [x1, z1] = out(j, o0);
      const [x2, z2] = out(j, o1);
      const [x3, z3] = out(k, o1);
      pos.push(x0, y, z0, x1, y, z1, x2, y, z2, x0, y, z0, x2, y, z2, x3, y, z3);
      const inner = [rgb[0], rgb[1], rgb[2], a0];
      const outer = [rgb[0], rgb[1], rgb[2], a1];
      col.push(...inner, ...inner, ...outer, ...inner, ...outer, ...outer);
    }
  }
}

/**
 * The generated islands and reefs as two meshes (two draw calls in total): flat-shaded land with
 * vertex colors, and translucent shore foam / shallows laid on the water around it.
 */
export class IslandView {
  readonly land: Mesh;
  readonly shore: Mesh;
  private readonly shoreMat: MeshBasicMaterial;

  constructor(map: WorldMap) {
    const soup = new Soup();
    for (let i = 0; i < map.islandCount; i++) addIsland(soup, map, i);
    for (let i = 0; i < map.reefCount; i++) addReef(soup, map, i);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(soup.pos, 3));
    geo.setAttribute('color', new Float32BufferAttribute(soup.col, 3));
    geo.computeVertexNormals();
    this.land = new Mesh(geo, new MeshLambertMaterial({ vertexColors: true, side: DoubleSide }));
    this.land.frustumCulled = false;

    const pos: number[] = [];
    const col: number[] = [];
    for (let i = 0; i < map.islandCount; i++) {
      const s = map.vertStart[i]!;
      const e = map.vertStart[i + 1]!;
      addShore(
        pos,
        col,
        Array.from(map.verts.subarray(s * 2, e * 2)),
        map.islandX[i]!,
        map.islandY[i]!,
      );
    }
    for (let i = 0; i < map.reefCount; i++) {
      const ring: number[] = [];
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        ring.push(
          map.reefX[i]! + Math.cos(a) * map.reefR[i]! * 0.95,
          map.reefY[i]! + Math.sin(a) * map.reefR[i]! * 0.95,
        );
      }
      addShore(pos, col, ring, map.reefX[i]!, map.reefY[i]!);
    }
    const sgeo = new BufferGeometry();
    sgeo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    sgeo.setAttribute('color', new Float32BufferAttribute(col, 4));
    this.shoreMat = new MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    });
    this.shore = new Mesh(sgeo, this.shoreMat);
    this.shore.frustumCulled = false;
    this.shore.renderOrder = 1;
  }

  /** The foam at the waterline breathes a little. */
  update(timeSec: number): void {
    this.shoreMat.opacity = 0.85 + 0.15 * Math.sin(timeSec * 1.3);
  }
}
