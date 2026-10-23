export const WORLD_SIZE = 1100;
export const WORLD_CENTER = WORLD_SIZE / 2;

/**
 * The rock channel (GAME_DESIGN.md §4.7): two walls of rocks with a narrow lane of water between them, north of the
 * map center and the same distance from both teams. Gold banknotes float in the lane (`ECONOMY.pickups.gold`). The
 * walls are round obstacles like reefs, so they stop ships and shots; nothing else is generated near them.
 */
export const CHANNEL = {
  /** Middle of the channel; it runs west to east. */
  x: WORLD_CENTER,
  y: WORLD_CENTER - 140,
  /** End to end. */
  length: 170,
  /** Clear water between the two walls. */
  gap: 14,
  /** The lane arches this far north in the middle (its ends are on the line y). */
  bow: 18,
  /**
   * The rocks of a wall: radius range, distance between neighbors along the lane (they overlap, so the wall is
   * solid), and how far a rock may sit farther out than the lane's edge (a ragged wall).
   */
  rock: { min: 7, max: 9, spacing: 9, ragged: 1.5 },
  /** No island or reef is generated closer than this to a wall. */
  clearance: 28,
} as const;

/** Map generation and world-edge settings (GAME_DESIGN.md §4). Distances are world units. */
export const MAP = {
  /** Island counts by type (flat = plain obstacle islands). */
  counts: { port: 3, fort: 3, treasure: 4, flat: 12 },
  /** Island base radius (smaller minimums for plain islands; ports and forts need room for buildings). */
  radius: { min: 12, max: 30, port: 18, fort: 20 },
  corners: { min: 12, max: 18 },
  /** Shape wobble: amplitudes of the 2nd/3rd/5th radial harmonics and per-corner jitter. */
  wobble: { h2: 0.18, h3: 0.12, h5: 0.07, jitter: 0.05, minRadiusFrac: 0.55 },
  /** Islands keep this far from the world edge (edge of the island, not the center). */
  edgeMargin: 75,
  /** Minimum free water between two islands. */
  islandGap: 45,
  /** Nothing is placed within this distance of a team carrier (its spawn area and approach). */
  baseClear: 100,
  /** Nothing is placed within this distance of the world center (training spawn area). */
  spawnClear: 80,
  /** Placement tries per island before the gap is relaxed (four relaxations of 25%). */
  attempts: 300,
  /** Risk regions by distance from the center: inner (pirate waters), middle, outer (safe). */
  regions: { inner: 200, outer: 375 },
  /** Distance bands from the map center where each island type is placed. */
  zones: {
    fort: { min: 125, max: 330 },
    port: { min: 290, max: 430 },
    treasure: { min: 205, max: 365 },
  },
  /** Reef groups: small round rocks (1-3 per group). */
  reefs: {
    groups: 45,
    perGroup: { min: 1, max: 3 },
    radius: { min: 4, max: 8 },
    /** Free water around reefs: to islands and between groups. */
    islandGap: 16,
    groupGap: 32,
    edgeMargin: 55,
    spread: 10,
  },
  /** Soft wall at the world edge: ships are slowed and pushed back inside this band. */
  boundary: { width: 60, push: 26, damp: 1.6 },
} as const;
