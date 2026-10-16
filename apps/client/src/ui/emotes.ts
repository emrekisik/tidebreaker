import { EMOTE, EMOTE_IDS } from '@tidebreaker/shared';
import type { EmoteId } from '@tidebreaker/shared';

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
 * Key of each emote while the emote menu is open (`KeyboardEvent.code`). The menu swallows every
 * key, so these may be letters the game uses otherwise (A, D, S, W...). C opens and closes the menu,
 * so the bubble with a C on it is on V.
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

/** The order of the bubbles in the menu (rows of six): calls, requests, social, moods. */
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

/**
 * The emote menu: opens with `C` over the middle of the screen, a grid of the bubbles. A click or the
 * key written on a bubble sends it; `C`, `Esc` or a click outside closes the menu. While it is open
 * it takes every key press, so the ship's controls do not react to the letters.
 */
export class EmoteMenu {
  private readonly root = document.getElementById('emote-menu') as HTMLElement;
  private open = false;

  constructor(private readonly onPick: (index: number) => void) {
    const panel = document.createElement('div');
    panel.className = 'em-panel panel';
    const grid = document.createElement('div');
    grid.className = 'em-grid';
    for (const id of EMOTE_ORDER) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'em-btn';
      b.innerHTML = emoteSvg(id);
      const key = document.createElement('span');
      key.className = 'em-key';
      key.textContent = EMOTE_KEYS[id].slice(3);
      b.append(key);
      b.addEventListener('click', () => this.pick(id));
      grid.append(b);
    }
    panel.append(grid);
    // A click on the dark area around closes the menu; clicks never reach the game (they would fire).
    panel.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.root.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.close();
    });
    this.root.append(panel);
    // Keys: capture phase, ahead of the game's own handlers.
    window.addEventListener('keydown', (e) => this.key(e), true);
  }

  get isOpen(): boolean {
    return this.open;
  }

  toggle(): void {
    if (this.open) this.close();
    else this.show();
  }

  show(): void {
    this.open = true;
    this.root.classList.remove('hidden');
  }

  close(): void {
    this.open = false;
    this.root.classList.add('hidden');
  }

  private pick(id: EmoteId): void {
    this.close();
    this.onPick(EMOTE_IDS.indexOf(id));
  }

  private key(e: KeyboardEvent): void {
    if (!this.open) return;
    // Everything is for the menu while it is open (but the browser's own shortcuts stay alone).
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    if (e.repeat) return;
    if (e.code === 'Escape' || e.code === 'KeyC') return this.close();
    for (const id of EMOTE_ORDER) {
      if (EMOTE_KEYS[id] === e.code) return this.pick(id);
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
