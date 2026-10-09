/** Island kinds (GAME_DESIGN.md §4.3). Their gameplay arrives in later phases; today they only differ by look. */
export const ISLAND_TYPES = ['port', 'fort', 'treasure', 'flat'] as const;
export type IslandType = (typeof ISLAND_TYPES)[number];

/**
 * The generated map as flat typed arrays (no per-query allocation). Island outlines are
 * counter-clockwise polygons around their center; corners are quantized to 1/16 unit, so the
 * map is identical on server and client even if their `sin`/`cos` differ in the last bit.
 */
export interface WorldMap {
  seed: number;
  islandCount: number;
  /** Index into ISLAND_TYPES. */
  islandType: Uint8Array;
  /** Island center and bounding radius. */
  islandX: Float32Array;
  islandY: Float32Array;
  islandR: Float32Array;
  /** Corners of island i are verts[2 * vertStart[i] .. 2 * vertStart[i + 1]) as (x, y) pairs. */
  vertStart: Uint16Array;
  verts: Float32Array;
  reefCount: number;
  reefX: Float32Array;
  reefY: Float32Array;
  reefR: Float32Array;
}
