/**
 * Cosmetic effect settings (client only, but all tunables live in config; see CLAUDE.md rule 9).
 * Colors are sRGB hex. Sizes are world units, times are seconds.
 */
export const FX = {
  /** Particle pool sizes; the oldest particle is recycled when a pool is full. */
  capacity: { puff: 1200, spark: 700, debris: 160, foam: 1000 },
  gravity: 16,
  /** Smoke drifts with the wind (world x/z units per second). */
  wind: { x: 0.9, z: -0.5 },
  /** Foam sits just above the highest wave crest. */
  foamLift: 0.14,

  colors: {
    flash: 0xfff0b8,
    fireHot: 0xffe08a,
    fire: 0xff7a1f,
    ember: 0xff9a3c,
    smokeLight: 0xcfd5da,
    smokeMid: 0x8d949b,
    smokeDark: 0x2b2d31,
    foam: 0xffffff,
    spray: 0xcfeeff,
    shieldSpark: 0x6fd8ff,
    hitSpark: 0xffc65a,
    debrisA: 0x626972,
    debrisB: 0x2e3238,
    debrisC: 0x8a5a3c,
  },

  /** Muzzle flash and smoke by projectile visual. */
  muzzle: {
    bullet: { flash: 0.5, flashLife: 0.05, smoke: 0.45, smokeCount: 1, smokeLife: 0.6 },
    shell: { flash: 1.7, flashLife: 0.09, smoke: 1.5, smokeCount: 3, smokeLife: 1.3 },
    rocket: { flash: 1.2, flashLife: 0.08, smoke: 1.9, smokeCount: 4, smokeLife: 1.5 },
  },

  /** Smoke trail behind rockets in flight. */
  rocketTrail: { everySec: 0.03, startSize: 0.35, endSize: 1.2, life: 0.9 },

  /** Sparks when a shot hits a ship. */
  impact: { sparks: 9, shieldSparks: 11, speed: 8, life: 0.45 },

  /** Water splash where a shot lands. Scaled by the weapon (see splashScale). */
  splash: { foam: 3, spray: 8, life: 1.2 },
  splashScale: { bullet: 0.45, shell: 1, rocket: 1.2 },

  /** Damage states by remaining hull fraction. */
  damage: {
    smokeBelow: 0.66,
    fireBelow: 0.33,
    /** Puffs per second per 10 units of ship length. */
    smokeRate: 2.5,
    fireRate: 5,
    smokeLife: 1.8,
  },

  /** What a sinking ship throws out. Counts scale with ship length via `sizeScale`. */
  explosion: { fire: 12, smoke: 16, sparks: 26, debris: 12, ring: 3 },
  sinkingSmokeRate: 24,
  sinkingFireRate: 10,

  /** Foam trail behind moving ships. */
  wake: {
    spacing: 0.9,
    life: 2.4,
    startSize: 0.55,
    endSize: 2.3,
    alpha: 0.55,
    /** Sideways speed of the two V arms. */
    armSpeed: 1.2,
    bowSpacing: 1.4,
    bowLife: 0.7,
    /** Below this fraction of vMax the bow wave is not drawn. */
    bowMinSpeed: 0.35,
  },
} as const;

export type MuzzleKind = keyof typeof FX.muzzle;
