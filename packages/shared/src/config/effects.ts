/**
 * Cosmetic effect settings (client only, but all tunables live in config; see CLAUDE.md rule 9).
 * Colors are sRGB hex. Sizes are world units, times are seconds.
 */
export const FX = {
  /** How long a ship turns white when it takes damage. */
  hitFlashSec: 0.05,
  /** Particle pool sizes; the oldest particle is recycled when a pool is full. */
  capacity: { puff: 1500, fire: 700, spark: 800, tracer: 600, glow: 500, debris: 200, foam: 1000 },
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
    shellTail: 0xffe27a,
    dust: 0xd8c89a,
    dustDark: 0x8d8366,
    shellGlow: 0xffd24a,
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
  rocketArc: { start: 1.1, a: 17, b: 17.8, pitchBoost: 1.6 },

  /** Trails behind the other projectile kinds (the rocket one is `rocketTrail`). */
  bulletTrail: { everySec: 0.02, life: 0.1, size: 0.09 },
  shellTrail: { everySec: 0.01, life: 0.13, streak: 0.3 },
  /** Yellowish glow of compressed air at the nose of a shell. */
  shellNose: { size: 0.32, life: 0.06 },
  /** Soft yellow halo around a flying shell (like the rocket's exhaust glow, but yellow). */
  shellGlow: { size: 2.6, endSize: 1.6, life: 0.07, alpha: 0.4, chance: 0.4 },

  /** Ship-to-ship collisions; counts scale with the closing speed. */
  collision: { sparksBase: 8, sparksPerSpeed: 0.8, sparksMax: 30, chips: 5, splashAbove: 6 },

  /** Sparks when a shot hits a ship. */
  impact: {
    sparks: 11,
    shieldSparks: 7,
    speed: 13,
    life: 0.5,
    chips: 4,
    flash: 2.4,
    fireball: 2.3,
    /** Shield hit flash: start and end size (scaled by the weapon). */
    shieldFlash: [1.1, 1.8],
  },
  /** Impact size multiplier by projectile visual (counts, sizes and speeds scale with it). */
  impactScale: { bullet: 1, shell: 2.4, rocket: 3.4 },

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

  /**
   * Ship wake (stamped into the foam map as scattered blobs, so it looks ragged, not geometric).
   * Positions are fractions of the ship length from its center (+ = bow); widths are fractions of
   * the hull width; strengths are 0..1.
   */
  wake: {
    sternAt: 0.46,
    /** Trail strength at low speed (scales up to 1 at top speed), width of the core, and spread of the ragged blobs. */
    trailMin: 0.3,
    trailWidth: 0.5,
    blobSpread: 1.1,
    /** Meters of travel between scattered blobs (one trail blob each). */
    blobSpacing: 0.5,
    bowAt: 0.5,
    bowMin: 0.5,
    /** Below this fraction of vMax there is no bow wave. */
    bowMinSpeed: 0.3,
    /** Short foam fringe hugging each side of the bow (continuous, so it does not flicker). */
    fringeLength: 0.3,
    fringeStrength: 0.65,
  },

  /**
   * Where the hull meets the water, stamped into the foam map every frame (so it follows the waves
   * and the hull outline instead of a flat disc). Widths are fractions of the hull half-width.
   */
  hull: {
    /** Foam fringe hugging the hull: reach beyond the hull and strength (0..1, foam shows from ~0.3). */
    foamWidth: 1.35,
    foamStrength: 0.55,
    /** Foam reaches full strength at this fraction of top speed (1 / gain); none when standing still. */
    foamSpeedGain: 4,
    /** Soft shadow: reach beyond the hull, strength (0..1) and how dark the water gets at full strength. */
    shadowWidth: 1.7,
    shadowStrength: 1,
    shadowDarken: 0.5,
  },
} as const;

export type MuzzleKind = keyof typeof FX.muzzle;
