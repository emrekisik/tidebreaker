import { MINE, MISSILE } from '@tidebreaker/shared';
import { t } from '../i18n/index.ts';
import lockSvg from './icons/lock.svg?raw';
import mineIcon from './icons/mine.svg?raw';
import missileIcon from './icons/missile.svg?raw';
import { tone } from './sound.ts';

/** Where a ship is on the screen: center in pixels and half its size, for the reticle. */
export interface LockProjector {
  /** Writes x, y and half size (pixels) of entity `id` into `out`; false when it is off the screen or gone. */
  project(id: number, out: Float32Array): boolean;
}

/** Scale of the reticle when the lock starts (it shrinks to 1 on the ship as the lock builds). */
const START_SCALE = 1.5;
/** How long the "punch" when the lock completes lasts, and how big it gets. */
const PUNCH_SEC = 0.25;
const PUNCH_SIZE = 0.2;
/** How long the reticle takes to fade away (after a hit or a lost lock). */
const FADE_SEC = 0.35;
/** A completed lock that the server never launched is dropped after this long. */
const WAIT_LAUNCH_SEC = 1.5;
/** Seconds between the beeps while locking. */
const BEEP_EVERY = 0.5;
/** The reticle's smallest size (pixels), so small ships get a usable one. */
const MIN_BOX = 56;

type Phase = 'locking' | 'locked' | 'flight' | 'fade';

interface Reticle {
  el: HTMLElement;
  svg: SVGElement;
  text: HTMLElement;
  phase: Phase;
  /** Entity id of the ship it sits on. */
  target: number;
  /** Id of the missile it follows (flight), 0 while still locking. */
  shot: number;
  /** Seconds in the current phase. */
  time: number;
  /** Beeps already played in the locking phase. */
  beeps: number;
  /** Scale and size it had when the fade began. */
  fadeScale: number;
  fadeX: number;
  fadeY: number;
  fadeBox: number;
  inUse: boolean;
}

/**
 * The lock-on reticle of the guided missile, drawn over the target ship: open corner brackets only
 * while the lock builds (amber, shrinking from a bigger size onto the ship, with a beep every half
 * second), then a punch, red, four outer ticks and a long tone when it is complete, and it stays on
 * the ship (red) as long as the missile flies; it fades when the missile ends or the lock is lost.
 * Also the warning for a ship that a missile is chasing.
 */
export class MissileLock {
  private readonly layer: HTMLElement;
  private readonly warning: HTMLElement;
  private readonly pool: Reticle[] = [];
  private readonly where = new Float32Array(3);
  /** Shot ids of missiles that are chasing the player's own ship. */
  private readonly incoming: number[] = [];
  private warnBeepLeft = 0;

  /** `onLost` is called when the target leaves the screen while locking (the server must drop the lock too). */
  constructor(
    layer: HTMLElement,
    warning: HTMLElement,
    private readonly onLost: () => void,
  ) {
    this.layer = layer;
    this.warning = warning;
    for (let i = 0; i < 5; i++) this.pool.push(this.make());
  }

  private make(): Reticle {
    const el = document.createElement('div');
    el.className = 'lock hidden';
    el.innerHTML = lockSvg;
    const text = document.createElement('div');
    text.className = 'lock-text';
    el.append(text);
    this.layer.append(el);
    return {
      el,
      svg: el.querySelector('svg') as SVGElement,
      text,
      phase: 'locking',
      target: 0,
      shot: 0,
      time: 0,
      beeps: 0,
      fadeScale: 1,
      fadeX: 0,
      fadeY: 0,
      fadeBox: MIN_BOX,
      inUse: false,
    };
  }

  /** The reticle that is building or has completed a lock that no missile has left for yet. */
  private pending(): Reticle | undefined {
    for (const r of this.pool) if (r.inUse && (r.phase === 'locking' || r.phase === 'locked')) return r;
    return undefined;
  }

  /** True while a lock is being built (a second press of the lock key cancels it). */
  get locking(): boolean {
    return this.pending() !== undefined;
  }

  /** The player starts locking onto ship `target`. */
  begin(target: number): void {
    this.cancel();
    const r = this.pool.find((x) => !x.inUse) ?? this.pool[0]!;
    r.inUse = true;
    r.phase = 'locking';
    r.target = target;
    r.shot = 0;
    r.time = 0;
    r.beeps = 0;
    r.el.classList.remove('hidden', 'red');
    r.text.textContent = t('lock.locking');
    r.el.style.opacity = '1';
  }

  /** The lock was canceled or lost: the reticle fades away. */
  cancel(): void {
    const r = this.pending();
    if (r) this.startFade(r);
  }

  /** The missile left for ship `target` (shot id `shot`): the reticle stays on the ship as it flies. */
  launched(shot: number, target: number): void {
    let r = this.pending();
    if (!r) {
      r = this.pool.find((x) => !x.inUse) ?? this.pool[0]!;
      r.inUse = true;
      r.el.classList.remove('hidden');
    }
    if (r.phase === 'locking') {
      // (The server was quicker than the clock here: the lock is complete now.)
      tone(1900, 0.5, 0.05, 'square');
      r.time = 0;
    }
    r.phase = 'flight';
    r.target = target;
    r.shot = shot;
    r.el.classList.add('red');
    r.text.textContent = t('lock.locked');
    r.el.style.opacity = '1';
  }

  /** The missile with this shot id is gone (hit, lost, or ran out): its reticle fades. */
  ended(shot: number): void {
    for (const r of this.pool) if (r.inUse && r.phase === 'flight' && r.shot === shot) this.startFade(r);
    const at = this.incoming.indexOf(shot);
    if (at >= 0) this.incoming.splice(at, 1);
  }

  /** A missile is chasing the player's own ship. */
  warn(shot: number): void {
    if (this.incoming.indexOf(shot) < 0) this.incoming.push(shot);
    this.warnBeepLeft = 0;
  }

  /** Everything off (the player was sunk or the match restarted). */
  reset(): void {
    for (const r of this.pool) this.release(r);
    this.incoming.length = 0;
    this.warning.classList.add('hidden');
  }

  private startFade(r: Reticle): void {
    r.phase = 'fade';
    r.time = 0;
  }

  private release(r: Reticle): void {
    r.inUse = false;
    r.el.classList.add('hidden');
  }

  /** Per frame: positions, sizes, colors and the beeps. */
  update(dtSec: number, projector: LockProjector): void {
    const out = this.where;
    for (const r of this.pool) {
      if (!r.inUse) continue;
      r.time += dtSec;
      if (r.phase === 'fade') {
        const p = r.time / FADE_SEC;
        if (p >= 1) {
          this.release(r);
          continue;
        }
        // Spreads a little and fades out where it was.
        this.place(r, r.fadeX, r.fadeY, r.fadeBox, r.fadeScale * (1 + 0.4 * p), 1 - p);
        continue;
      }
      if (!projector.project(r.target, out)) {
        if (r.phase === 'flight') {
          r.el.style.opacity = '0';
        } else {
          // The target left the screen (or sank): the lock is lost.
          this.startFade(r);
          this.onLost();
        }
        continue;
      }
      const box = Math.max(MIN_BOX, out[2]! * 2);
      let scale = 1;
      let alpha = 1;
      if (r.phase === 'locking') {
        const p = Math.min(1, r.time / MISSILE.lockSec);
        scale = START_SCALE + (1 - START_SCALE) * p;
        alpha = 0.7 + 0.3 * Math.abs(Math.sin(r.time * Math.PI * 4));
        while (r.beeps * BEEP_EVERY <= r.time && r.beeps * BEEP_EVERY < MISSILE.lockSec) {
          tone(1250, 0.07, 0.04, 'square');
          r.beeps++;
        }
        if (r.time >= MISSILE.lockSec) {
          r.phase = 'locked';
          r.time = 0;
          r.el.classList.add('red');
          r.text.textContent = t('lock.locked');
          tone(1900, 0.5, 0.05, 'square');
        }
      } else if (r.phase === 'locked' || r.phase === 'flight') {
        // The punch when the lock is complete: a quick bounce, then it sits on the ship.
        if (r.time < PUNCH_SEC) scale = 1 + PUNCH_SIZE * Math.sin((r.time / PUNCH_SEC) * Math.PI);
        if (r.phase === 'locked' && r.time > WAIT_LAUNCH_SEC) {
          this.startFade(r);
          continue;
        }
        // (A tracked reticle gets its place back after it was hidden off the screen.)
        r.el.style.opacity = '1';
      }
      r.fadeX = out[0]!;
      r.fadeY = out[1]!;
      r.fadeBox = box;
      r.fadeScale = scale;
      this.place(r, out[0]!, out[1]!, box, scale, alpha);
    }
    this.updateWarning(dtSec);
  }

  private place(r: Reticle, x: number, y: number, box: number, scale: number, alpha: number): void {
    r.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    r.svg.style.transform = `scale(${((box * scale) / 100).toFixed(3)})`;
    r.text.style.top = `${(box * scale * 0.5 + 16).toFixed(1)}px`;
    r.el.style.opacity = alpha.toFixed(2);
  }

  /** The warning text and the alarm beeps while a missile is chasing the player. */
  private updateWarning(dtSec: number): void {
    const on = this.incoming.length > 0;
    this.warning.classList.toggle('hidden', !on);
    if (!on) return;
    this.warnBeepLeft -= dtSec;
    if (this.warnBeepLeft <= 0) {
      this.warnBeepLeft = 0.45;
      tone(880, 0.12, 0.05, 'sawtooth');
    }
  }
}

/** The missile and mine stock on the screen: icon, how many are on board and the key that uses them. */
export class MissileBadge {
  private readonly count = document.createElement('b');
  private readonly mineCount = document.createElement('b');
  private readonly note = document.createElement('span');
  private noteLeft = 0;

  constructor(private readonly root: HTMLElement) {
    const strip = (svg: string): string => svg.replace(/ width="\d+" height="\d+"/, '');
    const icon = document.createElement('span');
    icon.className = 'mb-ico';
    icon.innerHTML = strip(missileIcon);
    const key = document.createElement('span');
    key.className = 'mb-key';
    key.textContent = 'Q';
    this.count.className = 'mb-count';
    const mineIc = document.createElement('span');
    mineIc.className = 'mb-ico mine';
    mineIc.innerHTML = strip(mineIcon);
    const mineKey = document.createElement('span');
    mineKey.className = 'mb-key';
    mineKey.textContent = 'F';
    this.mineCount.className = 'mb-count';
    this.note.className = 'mb-note';
    root.append(icon, this.count, key, mineIc, this.mineCount, mineKey, this.note);
  }

  /** Shows the stock (only for ships that may carry missiles and mines). */
  set(missiles: number, mines: number, canCarry: boolean): void {
    this.root.classList.toggle('hidden', !canCarry);
    this.root.classList.toggle('empty', missiles === 0 && mines === 0);
    this.count.textContent = `${missiles}/${MISSILE.maxStock}`;
    this.mineCount.textContent = `${mines}/${MINE.maxStock}`;
  }

  /** A short message next to the badge (why the lock did not start, why no mine was laid). */
  flash(text: string): void {
    this.note.textContent = text;
    this.root.classList.add('noting');
    this.noteLeft = 1.6;
  }

  update(dtSec: number): void {
    if (this.noteLeft <= 0) return;
    this.noteLeft -= dtSec;
    if (this.noteLeft <= 0) this.root.classList.remove('noting');
  }
}
