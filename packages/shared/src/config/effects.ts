/**
 * Cosmetic effect settings (client only, but all tunables live in config; see CLAUDE.md rule 9).
 * Colors are sRGB hex. Sizes are world units, times are seconds.
 */
export const FX = {
  /** How long a ship turns white when it takes damage. */
  hitFlashSec: 0.05,
  /** Particle pool sizes; the oldest particle is recycled when a pool is full. */
  capacity: { puff: 1500, fire: 700, spark: 800, debris: 200, foam: 1000 },
  gravity: 16,
  /** Smoke drifts with the wind (world x/z units per second). */
  wind: { x: 0.9, z: -0.5 },
  /** Foam sits just above the highest wave crest. */
  foamLift: 0.14,

  colors: {
    white: 0xffffff,
    flash: 0xfff0b8,
    fireHot: 0xffe08a,
    fire: 0xff7a1f,
    fireDeep: 0xa82208,
    glow: 0xff6a1a,
    ember: 0xff9a3c,
    smokeLight: 0xcfd5da,
    smokeMid: 0x8d949b,
    smokeDark: 0x2b2d31,
    foam: 0xffffff,
    spray: 0xcfeeff,
    shieldSpark: 0x9ff8ff,
    shieldFlash: 0xe8ffff,
    shieldDeep: 0x3fd6ea,
    hitSpark: 0xffc65a,
    debrisA: 0x626972,
    debrisB: 0x2e3238,
    debrisC: 0x8a5a3c,
  },

  /** Muzzle flash and smoke by projectile visual. */
  muzzle: {
    bullet: { flash: 0.5, flashLife: 0.05, sparks: 2, smoke: 0.45, smokeCount: 1, smokeLife: 0.6 },
    shell: { flash: 1.7, flashLife: 0.09, sparks: 7, smoke: 1.5, smokeCount: 3, smokeLife: 1.3 },
    rocket: { flash: 1.2, flashLife: 0.08, sparks: 5, smoke: 1.9, smokeCount: 4, smokeLife: 1.5 },
  },

  /** Smoke trail behind rockets in flight. */
  rocketTrail: { everySec: 0.02, startSize: 0.35, endSize: 1.2, life: 0.9 },
  /**
   * Rockets lob gently: height = start + a*u - b*u^2 over the flight fraction u (0..1), so they
   * climb a little and then drop toward the target. Purely visual; hits stay 2D.
   */
  rocketArc: { start: 1.1, a: 7, b: 7.8, pitchBoost: 1.6 },

  /** Trails behind the other projectile kinds (the rocket one is `rocketTrail`). */
  bulletTrail: { everySec: 0.02, life: 0.1, size: 0.09 },
  shellTrail: { everySec: 0.01, life: 0.13, streak: 0.15 },
  /** Yellowish glow of compressed air at the nose of a shell. */
  shellNose: { size: 0.32, life: 0.06 },

  /** Ship-to-ship collisions; counts scale with the closing speed. */
  collision: { sparksBase: 8, sparksPerSpeed: 0.8, sparksMax: 30, chips: 5, splashAbove: 6 },

  /** Sparks when a shot hits a ship. */
  impact: { sparks: 10, shieldSparks: 12, speed: 11, life: 0.4, chips: 3 },

  /** Water splash where a shot lands. Scaled by the weapon (see splashScale). */
  splash: { foam: 3, spray: 8, life: 1.2 },
  splashScale: { bullet: 0.45, shell: 1, rocket: 1.2 },

  /** Damage states by remaining hull fraction. */
  damage: {
    smokeBelow: 0.66,
    fireBelow: 0.33,
    /** Puffs per second per 10 units of ship length. */
    smokeRate: 3.2,
    fireRate: 11,
    smokeLife: 1.8,
  },

  /** What a sinking ship throws out. Counts scale with ship length via `sizeScale`. */
  explosion: { fire: 12, smoke: 16, sparks: 26, debris: 12, ring: 3 },
  sinkingSmokeRate: 16,
  sinkingFireRate: 18,

  /** Foam trail behind moving ships. */
  wake: {
    spacing: 0.7,
    life: 3,
    startSize: 0.9,
    endSize: 3.4,
    alpha: 0.95,
    /** Sideways speed of the two V arms. */
    armSpeed: 1.4,
    bowSpacing: 1,
    bowLife: 0.9,
    /** Below this fraction of vMax the bow wave is not drawn. */
    bowMinSpeed: 0.35,
  },
} as const;

export type MuzzleKind = keyof typeof FX.muzzle;
