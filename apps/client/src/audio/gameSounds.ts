import { ANNOUNCE, WEAPONS, WEAPON_IDS } from '@tidebreaker/shared';
import type { StatsMsg } from '@tidebreaker/shared';
import { audio } from './engine.ts';
import type { SoundId } from './engine.ts';

/** What a shot sounds like, by weapon: the sound, its pitch and its loudness. */
const SHOT: Readonly<Record<string, readonly [SoundId, number, number]>> = {
  machine_gun: ['mg', 1, 1],
  carrier_gun: ['mg', 0.72, 1.1],
  drone_gun: ['mg', 1.35, 0.5],
  cannon_t3: ['cannon', 1.1, 0.95],
  cannon_t4: ['cannon', 1, 1],
  cannon_t5: ['cannon', 0.9, 1.1],
  pirate_cannon_s: ['cannon', 1.25, 0.75],
  pirate_cannon_m: ['cannon', 1.12, 0.85],
  pirate_cannon_l: ['cannon', 1.02, 0.95],
  rocket: ['rocket_launch', 1, 1],
  carrier_rocket: ['rocket_launch', 0.8, 1.1],
  drone_rocket: ['rocket_launch', 1.3, 0.7],
  missile: ['missile_launch', 1, 1],
  cruiser_rocket: ['heavy_launch', 1, 1.1],
};

/** The chance that a bullet hit plays the rare hit sound. */
const RARE_HIT = 0.12;

/** How loud a shot falling into the water is, by the weapon's visual. */
const SPLASH_GAIN = { shell: 1, rocket: 1.2, missile: 1.3, heavy: 1.5 } as const;

/**
 * The sounds of the game events, in one place: the UI layer calls these with what the game told it
 * (positions are world coordinates; `own` marks what the player did or what happened to the player).
 */
export const sfx = {
  shot(weaponIdx: number, x: number, y: number, own: boolean): void {
    const entry = SHOT[WEAPON_IDS[weaponIdx] ?? ''];
    if (!entry) return;
    audio.play(entry[0], { x, y, own, pitch: entry[1], gain: entry[2] * (own ? 0.9 : 1) });
  },

  hit(x: number, y: number, damage: number, involvesPlayer: boolean, weaponIdx: number): void {
    const gain = Math.max(0.5, Math.min(1.3, 0.5 + damage / 40)) * (involvesPlayer ? 1.25 : 1);
    const visual = WEAPONS[WEAPON_IDS[weaponIdx]!].visual;
    // (One bullet hit in a few has its own recorded sound, so the often-heard hit does not wear out.)
    const id = visual === 'bullet' ? (Math.random() < RARE_HIT ? 'hit_hull_mg' : 'hit_hull') : visual === 'shell' ? 'hit_cannon' : 'hit_missile';
    audio.play(id, { x, y, gain });
  },

  splash(x: number, y: number, weaponIdx: number): void {
    const visual = WEAPONS[WEAPON_IDS[weaponIdx]!].visual;
    // (Bullets falling into the water are silent.)
    if (visual === 'bullet') return;
    audio.play(visual === 'shell' ? 'splash' : 'splash_big', { x, y, gain: SPLASH_GAIN[visual] });
  },

  blocked(x: number, y: number): void {
    audio.play('hit_rock', { x, y });
  },

  shore(x: number, y: number, impact: number): void {
    audio.play('shore', { x, y, gain: Math.min(1.2, 0.3 + impact * 0.07) });
  },

  collision(x: number, y: number, impact: number, involvesPlayer: boolean): void {
    audio.play('bump', { x, y, gain: Math.min(1.3, 0.35 + impact * 0.08) * (involvesPlayer ? 1.2 : 1) });
  },

  /** A barrel or mine blast (`radius` 15 is a barrel), or a splash weapon's. */
  blast(x: number, y: number, radius: number): void {
    const size = Math.max(0.5, Math.min(1.5, radius / 15));
    // (A recorded blast has no size: a bigger one is lower and louder.)
    audio.play('explosion', { x, y, size, pitch: 1.3 - 0.3 * size, gain: 0.7 + 0.3 * size });
  },

  intercept(x: number, y: number, missile: boolean): void {
    audio.play('intercept', { x, y });
    if (missile) audio.play('explosion', { x, y, size: 0.5 });
  },

  /** A ship (`length` of its hull) or a drone went down. */
  sunk(x: number, y: number, length: number, flying: boolean): void {
    if (flying) audio.play('drone_die', { x, y });
    else audio.play('sink', { x, y, size: Math.max(0.6, Math.min(2.5, length / 12)) });
  },

  /** A ship changed class somewhere; `near` when it is the player's own. */
  tierUp(x: number, y: number, near: boolean): void {
    audio.play('tier_up', { x, y, own: near, gain: near ? 1 : 0.5 });
  },

  emote(x: number, y: number, own: boolean): void {
    audio.play('emote', { x, y, own, gain: own ? 0.8 : 0.6 });
  },

  /** `gold`: a gold banknote from the rock channel (brighter and a little louder). */
  pickup(gold = false): void {
    audio.play('pickup', gold ? { own: true, pitch: 1.45, gain: 1.2 } : { own: true });
  },

  /** Something the player tried did not work (no missiles, no mines...). */
  deny(): void {
    audio.play('ui_deny', { own: true });
  },

  scored(): void {
    audio.play('kill_ping', { own: true });
  },

  died(): void {
    audio.play('you_died', { own: true });
  },

  appeared(): void {
    audio.play('spawn', { own: true });
  },

  matchEnded(won: boolean): void {
    audio.play(won ? 'win' : 'lose', { own: true });
  },

  /** A room-wide announcement (`ANNOUNCE.*`) about `team`'s doing; `mine`: it is the player's team. */
  announce(kind: number, mine: boolean): void {
    if (!mine) return;
    if (kind === ANNOUNCE.RIG_CAPTURED) audio.play('rig_capture', { own: true });
    else if (kind === ANNOUNCE.RIG_LOST) audio.play('rig_lost', { own: true });
    else if (kind === ANNOUNCE.CARRIER_REPAIRED) audio.play('repair', { own: true });
    else if (kind === ANNOUNCE.GUNS_UPGRADED) audio.play('upgrade', { own: true });
  },

  /** The player's own rank went up. */
  rankUp(): void {
    audio.play('tier_ready', { own: true, gain: 0.9 });
  },

  click(): void {
    audio.play('ui_click', { own: true });
  },

  /** The player's own numbers changed: a purchase, an upgrade, or being able to move up a class. */
  stats(m: StatsMsg): void {
    const p = prev;
    if (p) {
      const levels = m.levels.reduce((a, b) => a + b, 0);
      if (m.tier === p.tier && levels > p.levels) audio.play('upgrade', { own: true });
      else if (m.drones > p.drones || m.missiles > p.missiles || m.mines > p.mines || m.baseGuns > p.baseGuns) {
        audio.play('buy', { own: true });
      }
      if (m.canTierUp && !p.canTierUp) audio.play('tier_ready', { own: true });
    }
    prev = {
      tier: m.tier,
      levels: m.levels.reduce((a, b) => a + b, 0),
      drones: m.drones,
      missiles: m.missiles,
      mines: m.mines,
      baseGuns: m.baseGuns,
      canTierUp: m.canTierUp,
    };
  },

  /** A new match or a new connection: the next stats message is a starting point, not a change. */
  forgetStats(): void {
    prev = null;
  },
};

let prev: {
  tier: number;
  levels: number;
  drones: number;
  missiles: number;
  mines: number;
  baseGuns: number;
  canTierUp: boolean;
} | null = null;
