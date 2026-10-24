import { onLanguageChange, t } from '../i18n/index.ts';
import type { MessageKey } from '../i18n/index.ts';
import { TOUR_SCENES } from './tourScenes.ts';

const SEEN_KEY = 'tidebreaker.tour';

/** True when this browser has been through the tour (or skipped it) before. */
export function tourSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

function markSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    // Not remembering is fine: the tour is offered once more.
  }
}

/**
 * The how-to-play tour: a short series of cards (goal, controls, money, upgrades, oil rigs, the carrier), each with a
 * little animated picture and a few words. It opens by itself the first time a player presses Play, and from the
 * "How to play" button of the start screen; it can be skipped at any step (Esc) and stepped with the arrow keys.
 */
export class Tour {
  private readonly count = TOUR_SCENES.length;
  private step = 0;
  private done: (() => void) | null = null;
  private readonly keys = (e: KeyboardEvent): void => this.onKey(e);

  constructor(private readonly root: HTMLElement) {
    // Nothing the player clicks on the tour may reach the game underneath.
    root.addEventListener('pointerdown', (e) => e.stopPropagation());
    // A new language while the tour is on screen: the card is drawn again in it.
    onLanguageChange(() => {
      if (this.isOpen) this.render();
    });
  }

  /** Whether the tour is on screen. */
  get isOpen(): boolean {
    return !this.root.classList.contains('hidden');
  }

  /** Opens the tour at its first step; `then` runs when it is finished or skipped. */
  open(then: () => void): void {
    this.done = then;
    this.step = 0;
    this.render();
    this.root.classList.remove('hidden');
    window.addEventListener('keydown', this.keys, true);
  }

  private close(): void {
    this.root.classList.add('hidden');
    window.removeEventListener('keydown', this.keys, true);
    markSeen();
    const then = this.done;
    this.done = null;
    then?.();
  }

  private go(step: number): void {
    if (step < 0) return;
    if (step >= this.count) return this.close();
    this.step = step;
    this.render();
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.isOpen) return;
    // The tour owns the keyboard while it is open (a held key does not run through the steps).
    e.stopPropagation();
    if (e.repeat) return;
    if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      this.go(this.step + 1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      this.go(this.step - 1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
    }
  }

  private button(label: string, cls: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `tr-btn ${cls}`;
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  private render(): void {
    const n = this.step + 1;
    const last = this.step === this.count - 1;
    const key = (part: string): MessageKey => `tour.s${n}.${part}` as MessageKey;

    const card = document.createElement('div');
    card.className = 'tr-card';

    const head = document.createElement('div');
    head.className = 'tr-head';
    head.innerHTML = '<span class="tr-label"></span><span class="tr-count"></span>';
    (head.firstElementChild as HTMLElement).textContent = t('tour.label');
    (head.lastElementChild as HTMLElement).textContent = `${n} / ${this.count}`;

    const body = document.createElement('div');
    body.className = 'tr-body';
    const stage = document.createElement('div');
    stage.className = 'tr-stage';
    const scene = document.createElement('div');
    scene.className = 'tr-scene';
    // (The scenes are made of our own markup and the language files: no player text goes in.)
    scene.innerHTML = TOUR_SCENES[this.step]!();
    stage.append(scene);
    const text = document.createElement('div');
    text.className = 'tr-text';
    const title = document.createElement('h2');
    title.textContent = t(key('title'));
    title.dir = 'auto';
    const para = document.createElement('p');
    para.textContent = t(key('text'));
    para.dir = 'auto';
    text.append(title, para);
    const tip = t(key('tip'));
    if (tip) {
      const p = document.createElement('p');
      p.className = 'tr-tip';
      p.dataset['tag'] = t('tour.note');
      p.textContent = tip;
      p.dir = 'auto';
      text.append(p);
    }
    body.append(stage, text);

    const foot = document.createElement('div');
    foot.className = 'tr-foot';
    const dots = document.createElement('div');
    dots.className = 'tr-dots';
    for (let i = 0; i < this.count; i++) {
      const d = document.createElement('span');
      d.className = i === this.step ? 'tr-dot on' : i < this.step ? 'tr-dot done' : 'tr-dot';
      d.addEventListener('click', () => this.go(i));
      dots.append(d);
    }
    const buttons = document.createElement('div');
    buttons.className = 'tr-buttons';
    const back = this.button(t('tour.back'), '', () => this.go(this.step - 1));
    back.disabled = this.step === 0;
    buttons.append(
      this.button(t('tour.skip'), 'skip', () => this.close()),
      back,
      this.button(last ? t('tour.start') : t('tour.next'), 'primary', () => this.go(this.step + 1)),
    );
    foot.append(dots, buttons);

    card.append(head, body, foot);
    this.root.replaceChildren(card);
  }
}
