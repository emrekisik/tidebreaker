import { EMOTE, EMOTE_IDS } from '@tidebreaker/shared';
import type { EmoteId } from '@tidebreaker/shared';
import { t } from '../i18n/index.ts';
import type { MessageKey } from '../i18n/index.ts';

/** The pictures of the emotes (white speech bubbles), by id: `emotes/<id>.svg`. */
const files = import.meta.glob('./emotes/*.svg', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** The svg of an emote without its fixed pixel size, so CSS can size it. */
export function emoteSvg(id: EmoteId): string {
  return (files[`./emotes/${id}.svg`] ?? '').replace(/ width="\d+" height="\d+"/, '');
}

/**
 * Key of each emote while the emote wheel is open (`KeyboardEvent.code`). The wheel swallows every
 * key, so these may be letters the game uses otherwise (A, D, S, W...). C holds the wheel open, so
 * the bubble with a C on it is on V.
 */
export const EMOTE_KEYS: Readonly<Record<EmoteId, string>> = {
  a: 'KeyA',
  b: 'KeyB',
  c: 'KeyV',
  attack: 'KeyK',
  defend: 'KeyD',
  base: 'KeyS',
  help: 'KeyP',
  wait: 'KeyW',
  me: 'KeyI',
  you: 'KeyY',
  thanks: 'KeyT',
  gg: 'KeyG',
  happy: 'KeyH',
  laugh: 'KeyL',
  love: 'KeyO',
  sad: 'KeyU',
  angry: 'KeyR',
  hmm: 'KeyM',
};

/** The order of the bubbles around the wheel, clockwise from the top: calls, requests, social, moods. */
export const EMOTE_ORDER: readonly EmoteId[] = [
  'a',
  'b',
  'c',
  'attack',
  'defend',
  'base',
  'help',
  'wait',
  'me',
  'you',
  'thanks',
  'gg',
  'happy',
  'laugh',
  'love',
  'sad',
  'angry',
  'hmm',
];

/** Radius of the wheel (pixels, before the UI scale) and the dead zone in its middle where nothing is picked. */
const RING = 128;
const DEAD_ZONE = 34;

/**
 * The emote wheel (like a chat wheel in other games): while `C` is held a wheel of all the emotes is
 * drawn around the player's ship; the mouse points at one (the one in that direction is lit up and its
 * name shown), and letting go of `C` shows that emote over the ship. Letting go with the mouse in the
 * middle, or pressing `Esc`, shows nothing. The key written on an emote also picks it at once. While
 * the wheel is open it takes the key presses (the ship's controls ignore the letters).
 */
export class EmoteWheel {
  private readonly root = document.getElementById('emote-wheel') as HTMLElement;
  private readonly slots: HTMLElement[] = [];
  private readonly ball = document.createElement('div');
  private readonly name = document.createElement('div');
  private open = false;
  /** The emote the mouse points at (index into EMOTE_ORDER), or -1. */
  private hover = -1;
  private mouseX = 0;
  private mouseY = 0;
  private centerX = 0;
  private centerY = 0;

  constructor(private readonly onPick: (index: number) => void) {
    const ring = document.createElement('div');
    ring.className = 'ew-ring';
    this.ball.className = 'ew-ball';
    this.name.className = 'ew-name';
    this.root.append(ring, this.ball, this.name);
    const step = (Math.PI * 2) / EMOTE_ORDER.length;
    EMOTE_ORDER.forEach((id, i) => {
      const el = document.createElement('div');
      el.className = 'ew-slot';
      el.innerHTML = emoteSvg(id);
      const key = document.createElement('span');
      key.className = 'ew-key';
      key.textContent = EMOTE_KEYS[id].slice(3);
      el.append(key);
      // Clockwise from the top.
      el.style.left = `${Math.sin(i * step) * RING}px`;
      el.style.top = `${-Math.cos(i * step) * RING}px`;
      this.root.append(el);
      this.slots.push(el);
    });
    window.addEventListener('pointermove', (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
    });
    // Keys: capture phase, ahead of the game's own handlers.
    window.addEventListener('keydown', (e) => this.key(e), true);
    window.addEventListener('blur', () => this.close());
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** `C` went down: the wheel opens (around the ship, see `update`). */
  press(): void {
    if (this.open) return;
    this.open = true;
    this.root.classList.remove('hidden');
    this.hover = -1;
    this.refresh();
  }

  /** `C` came up: the emote the mouse points at is shown; with the mouse in the middle, nothing. */
  release(): void {
    if (!this.open) return;
    const pick = this.hover;
    this.close();
    if (pick >= 0) this.onPick(EMOTE_IDS.indexOf(EMOTE_ORDER[pick]!));
  }

  close(): void {
    this.open = false;
    this.hover = -1;
    this.root.classList.add('hidden');
  }

  /**
   * Every frame while it is open: the wheel follows the ship (`x`, `y` = the ship on the screen, in
   * pixels) and the emote in the mouse's direction is worked out again.
   */
  update(x: number, y: number): void {
    if (!this.open) return;
    this.centerX = x;
    this.centerY = y;
    const k = Number.parseFloat(document.documentElement.style.getPropertyValue('--ui-scale')) || 1;
    this.root.style.left = `${x}px`;
    this.root.style.top = `${y}px`;
    this.root.style.transform = `scale(${k})`;
    const dx = (this.mouseX - this.centerX) / k;
    const dy = (this.mouseY - this.centerY) / k;
    const d = Math.hypot(dx, dy);
    let hover = -1;
    if (d >= DEAD_ZONE) {
      const step = (Math.PI * 2) / EMOTE_ORDER.length;
      // Angle clockwise from the top, 0..2PI.
      const a = (Math.atan2(dx, -dy) + Math.PI * 2) % (Math.PI * 2);
      hover = Math.round(a / step) % EMOTE_ORDER.length;
    }
    // The ball follows the mouse inside the ring (like a stick pointing at the choice).
    const reach = Math.min(d, 46);
    this.ball.style.transform = `translate(${d > 0 ? (dx / d) * reach : 0}px, ${d > 0 ? (dy / d) * reach : 0}px)`;
    if (hover !== this.hover) {
      this.hover = hover;
      this.refresh();
    }
  }

  private refresh(): void {
    this.slots.forEach((el, i) => el.classList.toggle('lit', i === this.hover));
    this.name.textContent = this.hover >= 0 ? t(`emote.${EMOTE_ORDER[this.hover]!}` as MessageKey) : '';
  }

  private key(e: KeyboardEvent): void {
    if (!this.open) return;
    // Everything is for the wheel while it is open (but the browser's own shortcuts stay alone).
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    if (e.repeat || e.code === 'KeyC') return;
    if (e.code === 'Escape') return this.close();
    for (const id of EMOTE_ORDER) {
      if (EMOTE_KEYS[id] === e.code) {
        this.close();
        this.onPick(EMOTE_IDS.indexOf(id));
        return;
      }
    }
  }
}

/**
 * The bubbles over the ships: one per ship (a new emote replaces the old one), popping in, staying
 * `EMOTE.showSec` and fading out. They follow the ship every frame.
 */
export class EmoteBubbles {
  private readonly layer = document.getElementById('emote-layer') as HTMLElement;
  private readonly shown = new Map<number, { el: HTMLElement; untilMs: number }>();

  /** Ship `shipId` shows emote `emoteIndex` (an index of `EMOTE_IDS`). */
  show(shipId: number, emoteIndex: number, nowMs: number): void {
    const id = EMOTE_IDS[emoteIndex];
    if (!id) return;
    this.remove(shipId);
    const el = document.createElement('div');
    el.className = 'emote-bubble';
    el.innerHTML = emoteSvg(id);
    el.style.animationDuration = `${EMOTE.showSec}s`;
    el.style.display = 'none';
    this.layer.append(el);
    this.shown.set(shipId, { el, untilMs: nowMs + EMOTE.showSec * 1000 });
  }

  /**
   * Places every bubble over its ship: `place(id, out)` writes the screen position (pixels) of the
   * point above ship `id` into `out` and returns false when the ship is gone or off screen.
   */
  update(nowMs: number, place: (id: number, out: Float32Array) => boolean): void {
    for (const [id, b] of this.shown) {
      if (nowMs >= b.untilMs) {
        this.remove(id);
        continue;
      }
      if (place(id, this.out)) {
        b.el.style.display = '';
        b.el.style.left = `${this.out[0]!}px`;
        b.el.style.top = `${this.out[1]!}px`;
      } else {
        b.el.style.display = 'none';
      }
    }
  }

  /** Forgets every bubble (a new match). */
  clear(): void {
    for (const id of [...this.shown.keys()]) this.remove(id);
  }

  private readonly out = new Float32Array(2);

  private remove(id: number): void {
    this.shown.get(id)?.el.remove();
    this.shown.delete(id);
  }
}
