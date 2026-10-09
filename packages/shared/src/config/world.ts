export const WORLD_SIZE = 1500;
export const WORLD_CENTER = WORLD_SIZE / 2;

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
  edgeMargin: 100,
  /** Minimum free water between two islands. */
  islandGap: 55,
  /** Nothing is placed within this distance of the world center (training spawn area). */
  spawnClear: 90,
  /** Placement tries per island before the gap is relaxed (four relaxations of 25%). */
  attempts: 300,
  /** Risk regions by distance from the center: inner (pirate waters), middle, outer (safe). */
  regions: { inner: 270, outer: 510 },
  /** Distance bands from the map center where each island type is placed. */
  zones: {
    fort: { min: 170, max: 450 },
    port: { min: 400, max: 590 },
    treasure: { min: 280, max: 500 },
  },
  /** Reef groups: small round rocks (1-3 per group). */
  reefs: {
    groups: 45,
    perGroup: { min: 1, max: 3 },
    radius: { min: 4, max: 8 },
    /** Free water around reefs: to islands and between groups. */
    islandGap: 20,
    groupGap: 40,
    edgeMargin: 70,
    spread: 10,
  },
  /** Soft wall at the world edge: ships are slowed and pushed back inside this band. */
  boundary: { width: 70, push: 26, damp: 1.6 },
} as const;
