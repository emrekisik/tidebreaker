import type { Gen } from './gen.ts';

/** Which volume group a sound belongs to (each has its own level in the mix). */
export type Bus = 'weapon' | 'impact' | 'ui' | 'ambient';

export interface SoundDef {
  bus: Bus;
  /** How many of it may play at once (the rest are dropped). */
  max: number;
  /** Name for the sound test page, and its group. */
  label: string;
  group: 'Weapons' | 'Impacts' | 'Interface' | 'Game events';
  /** Level of this sound against the others (1 = as it comes out of its recipe; big booms are trimmed down). */
  trim?: number;
  /** Draws the sound; returns how long it lasts (seconds). */
  run: (g: Gen) => number;
}

const max2 = (a: number, b: number): number => (a > b ? a : b);

/** A rising or falling run of notes (Hz), `step` seconds apart. */
function notes(g: Gen, type: OscillatorType, freqs: readonly number[], step: number, len: number, vol: number, wet = 0): number {
  let end = 0;
  freqs.forEach((f, i) => {
    end = max2(end, g.tone(type, f, f, len, vol, { at: i * step, wet }));
  });
  return end;
}

/**
 * Every sound of the game, synthesized (no sound files): each recipe has an arcade and a real flavor
 * (`g.pick(arcade, real)`). Files can replace any of them (see engine.ts). Levels here are relative; the
 * engine mixes the groups.
 */
export const SOUNDS = {
  // ---- weapons
  mg: {
    bus: 'weapon',
    max: 5,
    label: 'Machine gun shot',
    group: 'Weapons',
    run: (g) => {
      if (g.arcade) {
        g.tone('square', 1100, 420, 0.06, 0.18);
        return g.noise(0.04, 0.16, { type: 'highpass', f0: 3000 });
      }
      g.noise(0.07, 0.34, { type: 'bandpass', f0: 2200, f1: 900, q: 0.9 });
      return g.tone('sine', 150, 70, 0.07, 0.3, { wet: 0.15 });
    },
  },
  cannon: {
    trim: 0.9,
    bus: 'weapon',
    max: 4,
    label: 'Cannon shot',
    group: 'Weapons',
    run: (g) => {
      if (g.arcade) {
        g.tone('sine', 170, 42, 0.32, 0.7);
        g.tone('square', 400, 120, 0.09, 0.16);
        return g.noise(0.28, 0.5, { type: 'lowpass', f0: 2200, f1: 200 });
      }
      g.tone('sine', 95, 34, 0.5, 0.7, { wet: 0.4 });
      return g.noise(0.6, 0.65, { type: 'lowpass', f0: 2800, f1: 130, wet: 0.5 });
    },
  },
  rocket_launch: {
    bus: 'weapon',
    max: 3,
    label: 'Rocket launch',
    group: 'Weapons',
    run: (g) => {
      g.noise(0.55, 0.45, { type: 'bandpass', f0: 350, f1: g.pick(2600, 1800), q: 1.1, attack: 0.04, wet: 0.2 });
      if (g.arcade) g.tone('sawtooth', 260, 900, 0.4, 0.14, { attack: 0.05 });
      return g.tone('sine', 110, 60, 0.5, 0.35);
    },
  },
  heavy_launch: {
    trim: 0.75,
    bus: 'weapon',
    max: 2,
    label: 'Cruiser heavy rocket launch',
    group: 'Weapons',
    run: (g) => {
      g.noise(1.0, 0.6, { type: 'lowpass', f0: 3200, f1: 110, wet: 0.5 });
      g.noise(0.9, 0.35, { type: 'bandpass', f0: 250, f1: 1800, q: 1.2, attack: 0.1 });
      if (g.arcade) g.tone('sawtooth', 160, 700, 0.7, 0.12, { attack: 0.1 });
      return g.tone('sine', 75, 28, 0.9, 0.7, { wet: 0.4 });
    },
  },
  missile_launch: {
    bus: 'weapon',
    max: 2,
    label: 'Guided missile launch',
    group: 'Weapons',
    run: (g) => {
      g.tone('sawtooth', 220, g.pick(1800, 1200), 0.55, 0.15, { attack: 0.03 });
      g.tone('triangle', 440, g.pick(3200, 2000), 0.5, 0.1, { attack: 0.05 });
      return g.noise(0.6, 0.35, { type: 'bandpass', f0: 600, f1: 3500, q: 1, attack: 0.05, wet: 0.2 });
    },
  },
  mine_lay: {
    bus: 'weapon',
    max: 3,
    label: 'Laying a mine',
    group: 'Weapons',
    run: (g) => {
      g.tone('sine', g.pick(420, 300), 140, 0.14, 0.3);
      return g.noise(0.22, 0.28, { type: 'bandpass', f0: 1400, f1: 400, q: 0.8 });
    },
  },
  // ---- impacts and explosions
  hit_hull: {
    bus: 'impact',
    max: 5,
    label: 'Shot hits a hull',
    group: 'Impacts',
    run: (g) => {
      if (g.arcade) {
        g.tone('square', 240, 100, 0.09, 0.18);
        return g.noise(0.09, 0.3, { type: 'bandpass', f0: 1300, f1: 600 });
      }
      g.tone('sine', 150, 70, 0.14, 0.4);
      g.tone('sine', 1900, 1700, 0.12, 0.06);
      return g.noise(0.14, 0.4, { type: 'lowpass', f0: 2400, f1: 400, wet: 0.1 });
    },
  },
  hit_hull_mg: {
    bus: 'impact',
    max: 5,
    label: 'Machine gun burst hits a hull (rare variant)',
    group: 'Impacts',
    run: (g) => {
      if (g.arcade) {
        g.tone('square', 240, 100, 0.09, 0.18);
        return g.noise(0.09, 0.3, { type: 'bandpass', f0: 1300, f1: 600 });
      }
      g.tone('sine', 150, 70, 0.14, 0.4);
      g.tone('sine', 1900, 1700, 0.12, 0.06);
      return g.noise(0.14, 0.4, { type: 'lowpass', f0: 2400, f1: 400, wet: 0.1 });
    },
  },
  hit_cannon: {
    bus: 'impact',
    max: 4,
    label: 'Shell hits a hull',
    group: 'Impacts',
    run: (g) => {
      if (g.arcade) {
        g.tone('square', 180, 70, 0.12, 0.2);
        return g.noise(0.14, 0.34, { type: 'bandpass', f0: 1000, f1: 450 });
      }
      g.tone('sine', 110, 50, 0.22, 0.5);
      g.tone('sine', 1400, 1100, 0.14, 0.06);
      return g.noise(0.22, 0.45, { type: 'lowpass', f0: 2000, f1: 300, wet: 0.2 });
    },
  },
  hit_missile: {
    bus: 'impact',
    max: 3,
    label: 'Rocket or missile hits a hull',
    group: 'Impacts',
    run: (g) => {
      g.tone('sine', 100, 34, 0.4, 0.6, { wet: 0.2 });
      if (g.arcade) g.tone('square', 260, 80, 0.12, 0.14);
      return g.noise(0.4, 0.55, { type: 'lowpass', f0: 2600, f1: 140, wet: 0.2 });
    },
  },
  hit_rock: {
    bus: 'impact',
    max: 3,
    label: 'Shot hits land',
    group: 'Impacts',
    run: (g) => {
      g.tone('sine', 110, 60, 0.12, 0.3);
      return g.noise(0.16, 0.4, { type: 'lowpass', f0: g.pick(1500, 900), f1: 250 });
    },
  },
  splash: {
    bus: 'impact',
    max: 4,
    label: 'Shot falls into the water',
    group: 'Impacts',
    run: (g) => {
      if (g.arcade) g.tone('sine', 650, 200, 0.13, 0.18, { at: 0.02 });
      return g.noise(g.pick(0.35, 0.55), 0.35, { type: 'bandpass', f0: 1500, f1: 350, q: 0.7, attack: 0.01, wet: 0.2 });
    },
  },
  splash_big: {
    bus: 'impact',
    max: 3,
    label: 'Rocket or missile falls into the water',
    group: 'Impacts',
    run: (g) => {
      if (g.arcade) g.tone('sine', 520, 140, 0.2, 0.22, { at: 0.02 });
      g.tone('sine', 90, 45, 0.3, 0.3);
      return g.noise(g.pick(0.55, 0.8), 0.45, { type: 'bandpass', f0: 1200, f1: 250, q: 0.7, attack: 0.012, wet: 0.3 });
    },
  },
  intercept: {
    bus: 'impact',
    max: 3,
    label: 'Shot hits a missile or mine',
    group: 'Impacts',
    run: (g) => {
      g.tone('square', 1700, 500, 0.07, g.pick(0.12, 0.06));
      return g.noise(0.08, 0.3, { type: 'highpass', f0: 3200 });
    },
  },
  explosion: {
    trim: 0.72,
    bus: 'impact',
    max: 3,
    label: 'Explosion (barrel, mine, rocket splash)',
    group: 'Impacts',
    run: (g) => {
      const s = g.size;
      g.tone('sine', 120 / Math.sqrt(s), 28, 0.5 + 0.4 * s, 0.75, { wet: 0.3 });
      if (g.arcade) g.tone('square', 300, 70, 0.15, 0.14);
      return g.noise(0.5 + 0.6 * s, 0.7, { type: 'lowpass', f0: 3200, f1: 110, wet: g.pick(0.15, 0.5) });
    },
  },
  sink: {
    trim: 0.62,
    bus: 'impact',
    max: 3,
    label: 'A ship goes down',
    group: 'Impacts',
    run: (g) => {
      const s = g.size;
      g.tone('sine', 95, 24, 1.1 + 0.5 * s, 0.8, { wet: 0.4 });
      g.noise(0.9 + 0.6 * s, 0.8, { type: 'lowpass', f0: 2600, f1: 90, wet: g.pick(0.2, 0.6) });
      // The hull groaning and the bubbles after it.
      g.tone('sawtooth', 90, 38, 1.2, g.pick(0.1, 0.07), { at: 0.2 });
      let end = 0;
      for (let i = 0; i < 4; i++) {
        end = max2(end, g.tone('sine', 300 + g.rnd() * 500, 120, 0.09, 0.06, { at: 0.7 + i * 0.16 + g.rnd() * 0.06 }));
      }
      return max2(end, 1.6 + 0.5 * s);
    },
  },
  bump: {
    trim: 0.9,
    bus: 'impact',
    max: 3,
    label: 'Ships collide',
    group: 'Impacts',
    run: (g) => {
      g.tone('sine', 105, 45, 0.22, 0.7);
      g.noise(0.2, 0.4, { type: 'lowpass', f0: 800, f1: 150 });
      return g.tone('square', 190, 80, 0.06, g.pick(0.12, 0.04));
    },
  },
  shore: {
    bus: 'impact',
    max: 2,
    label: 'Ship scrapes the shore',
    group: 'Impacts',
    run: (g) => g.noise(0.35, 0.35, { type: 'bandpass', f0: 500, f1: 220, q: 1.4 }),
  },
  drone_die: {
    bus: 'impact',
    max: 3,
    label: 'A drone is shot down',
    group: 'Impacts',
    run: (g) => {
      g.tone('sawtooth', 900, 120, 0.35, 0.14);
      return g.noise(0.3, 0.4, { type: 'bandpass', f0: 2500, f1: 300, q: 0.7 });
    },
  },
  // ---- interface
  ui_click: {
    bus: 'ui',
    max: 3,
    label: 'Click',
    group: 'Interface',
    run: (g) => g.tone('sine', 1500, 1100, 0.04, 0.25),
  },
  ui_deny: {
    bus: 'ui',
    max: 2,
    label: 'Not allowed',
    group: 'Interface',
    run: (g) => {
      g.tone('square', 230, 180, 0.09, 0.14);
      return g.tone('square', 190, 140, 0.11, 0.14, { at: 0.11 });
    },
  },
  upgrade: {
    bus: 'ui',
    max: 2,
    label: 'Upgrade bought',
    group: 'Interface',
    run: (g) => notes(g, g.pick('triangle', 'sine'), [523, 659, 784], 0.065, 0.12, 0.22),
  },
  buy: {
    bus: 'ui',
    max: 2,
    label: 'Bought at the base shop',
    group: 'Interface',
    run: (g) => {
      g.noise(0.05, 0.12, { type: 'highpass', f0: 5000 });
      return notes(g, 'sine', [1568, 2093], 0.07, 0.14, 0.2);
    },
  },
  pickup: {
    bus: 'ui',
    max: 3,
    label: 'Money picked up',
    group: 'Interface',
    run: (g) => {
      if (g.arcade) return notes(g, 'sine', [988, 1319], 0.07, 0.11, 0.22);
      g.noise(0.12, 0.18, { type: 'bandpass', f0: 3500, f1: 6000, q: 1.5 });
      return notes(g, 'sine', [1319, 1760], 0.05, 0.1, 0.12);
    },
  },
  kill_ping: {
    bus: 'ui',
    max: 2,
    label: 'You scored a kill',
    group: 'Interface',
    run: (g) => {
      g.tone('triangle', 1318, 1760, 0.14, 0.24);
      return g.tone('sine', 2637, 2637, 0.2, 0.1, { at: 0.05 });
    },
  },
  tier_ready: {
    bus: 'ui',
    max: 1,
    label: 'You can move up a class',
    group: 'Interface',
    run: (g) => g.tone('sine', 1047, 1047, 0.45, 0.25, { attack: 0.01, wet: 0.2 }),
  },
  tier_up: {
    bus: 'ui',
    max: 2,
    label: 'Class up',
    group: 'Interface',
    run: (g) => {
      g.tone('sine', 130, 260, 0.4, 0.3);
      return notes(g, g.pick('sawtooth', 'triangle'), [392, 523, 659, 784], 0.09, 0.28, g.pick(0.11, 0.2), 0.25);
    },
  },
  emote: {
    bus: 'ui',
    max: 4,
    label: 'Emote pop',
    group: 'Interface',
    run: (g) => g.tone('sine', 480, 920, 0.09, 0.22),
  },
  lock_beep: {
    bus: 'ui',
    max: 2,
    label: 'Lock-on beep',
    group: 'Interface',
    run: (g) => g.tone('square', 1250, 1250, 0.07, 0.13),
  },
  lock_done: {
    bus: 'ui',
    max: 1,
    label: 'Lock-on complete',
    group: 'Interface',
    run: (g) => {
      g.tone('square', 1900, 1900, 0.5, 0.12, { attack: 0.005 });
      return g.tone('sine', 950, 950, 0.5, 0.12);
    },
  },
  missile_warning: {
    bus: 'ui',
    max: 1,
    label: 'Missile incoming warning',
    group: 'Interface',
    run: (g) => g.tone('sawtooth', 880, 880, 0.13, 0.16),
  },
  // ---- game events
  rig_capture: {
    bus: 'ui',
    max: 2,
    label: 'Your team takes a rig',
    group: 'Game events',
    run: (g) => notes(g, 'triangle', [523, 659, 880], 0.1, 0.22, 0.22, 0.25),
  },
  rig_lost: {
    bus: 'ui',
    max: 2,
    label: 'Your team loses a rig',
    group: 'Game events',
    run: (g) => notes(g, 'triangle', [440, 330], 0.14, 0.26, 0.22, 0.25),
  },
  repair: {
    bus: 'ui',
    max: 2,
    label: 'Carrier repaired',
    group: 'Game events',
    run: (g) => {
      let end = 0;
      for (let i = 0; i < 3; i++) {
        end = max2(end, g.noise(0.04, 0.3, { type: 'highpass', f0: 2500, at: i * 0.07 }));
        end = max2(end, g.tone('sine', 700 + i * 120, 700 + i * 120, 0.06, 0.13, { at: i * 0.07 }));
      }
      return end;
    },
  },
  you_died: {
    trim: 0.85,
    bus: 'ui',
    max: 1,
    label: 'Your ship went down',
    group: 'Game events',
    run: (g) => {
      g.tone('sawtooth', 440, 110, 0.9, g.pick(0.14, 0.1), { wet: 0.3 });
      g.tone('sine', 90, 35, 0.8, 0.5);
      return g.noise(0.7, 0.35, { type: 'lowpass', f0: 1600, f1: 120, wet: 0.3 });
    },
  },
  spawn: {
    bus: 'ui',
    max: 1,
    label: 'You (re)appear',
    group: 'Game events',
    run: (g) => {
      g.tone('sine', 300, 1300, 0.55, 0.18, { attack: 0.15, wet: 0.3 });
      return g.tone('triangle', 600, 2600, 0.5, 0.06, { attack: 0.15 });
    },
  },
  win: {
    bus: 'ui',
    max: 1,
    label: 'Your team wins',
    group: 'Game events',
    run: (g) => notes(g, g.pick('triangle', 'sine'), [523, 659, 784, 1047, 784, 1047], 0.13, 0.32, 0.22, 0.3),
  },
  lose: {
    bus: 'ui',
    max: 1,
    label: 'Your team loses',
    group: 'Game events',
    run: (g) => notes(g, 'triangle', [392, 330, 262, 196], 0.18, 0.4, 0.2, 0.3),
  },
} as const satisfies Record<string, SoundDef>;

export type SoundId = keyof typeof SOUNDS;
