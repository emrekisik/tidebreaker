export const WORLD_SIZE = 2400;
export const WORLD_CENTER = WORLD_SIZE / 2;

/** Map generation and world-edge settings (GAME_DESIGN.md §4). Distances are world units. */
export const MAP = {
  /** Island counts by type (flat = plain obstacle islands). */
  counts: { port: 3, fort: 3, treasure: 3, flat: 5 },
  /** Island size: base radius and number of polygon corners. */
  radius: { min: 18, max: 45 },
  corners: { min: 12, max: 18 },
  /** Shape wobble: amplitudes of the 2nd/3rd/5th radial harmonics and per-corner jitter. */
  wobble: { h2: 0.18, h3: 0.12, h5: 0.07, jitter: 0.05, minRadiusFrac: 0.55 },
  /** Islands keep this far from the world edge (edge of the island, not the center). */
  edgeMargin: 160,
  /** Minimum free water between two islands. */
  islandGap: 90,
  /** Nothing is placed within this distance of the world center (training spawn area). */
  spawnClear: 140,
  /** Placement tries per island before the gap is relaxed (four relaxations of 25%). */
  attempts: 300,
  /** Distance bands from the map center where each island type is placed. */
  zones: {
    fort: { min: 300, max: 740 },
    port: { min: 650, max: 960 },
    treasure: { min: 470, max: 830 },
  },
  /** Reef groups: small round rocks (1-3 per group). */
  reefs: {
    groups: 25,
    perGroup: { min: 1, max: 3 },
    radius: { min: 4, max: 8 },
    /** Free water around reefs: to islands and between groups. */
    islandGap: 30,
    groupGap: 60,
    edgeMargin: 100,
    spread: 10,
  },
  /** Soft wall at the world edge: ships are slowed and pushed back inside this band. */
  boundary: { width: 90, push: 26, damp: 1.6 },
} as const;
