import { SHIP_IDS } from '@tidebreaker/shared';
import type { ShipId } from '@tidebreaker/shared';
import { currentLanguage, saveLanguage, t } from '../i18n/index.ts';
import type { MessageKey } from '../i18n/index.ts';
import { Tour, tourSeen } from './tour.ts';

const NAME_KEY = 'tidebreaker.name';
const SHIP_KEY = 'tidebreaker.ship';

/**
 * Start screen: type a name, pick a class (temporary test option), press Play. The first time a player presses Play
 * the how-to-play tour opens first; the "How to play" button opens it at any time.
 */
export class Menu {
  private readonly root = document.getElementById('menu') as HTMLElement;
  private readonly form = document.getElementById('menu-card') as HTMLFormElement;
  private readonly name = document.getElementById('menu-name') as HTMLInputElement;
  private readonly ship = document.getElementById('menu-ship') as HTMLSelectElement;
  private readonly play = document.getElementById('menu-play') as HTMLButtonElement;
  private readonly note = document.getElementById('menu-note') as HTMLElement;
  private readonly tour = new Tour(document.getElementById('tour') as HTMLElement);

  /** `pickShip`: shows the class choice (test builds only); otherwise everyone starts as T1. */
  constructor(onPlay: (name: string, shipIdx: number) => void, pickShip = false) {
    let savedName = '';
    let savedShip = 'corvette';
    try {
      savedName = localStorage.getItem(NAME_KEY) ?? '';
      savedShip = localStorage.getItem(SHIP_KEY) ?? savedShip;
    } catch {
      // Private mode: the defaults are fine.
    }
    this.name.value = savedName || `${t('menu.captain')}${100 + Math.floor(Math.random() * 900)}`;
    for (let i = 0; i < SHIP_IDS.length; i++) {
      const id: ShipId = SHIP_IDS[i]!;
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = t(`ship.${id}` as MessageKey);
      this.ship.appendChild(o);
    }
    const at = SHIP_IDS.indexOf(savedShip as ShipId);
    this.ship.value = String(at >= 0 ? at : SHIP_IDS.indexOf('corvette'));
    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = this.name.value.trim();
      const idx = pickShip ? Number(this.ship.value) : 0;
      try {
        localStorage.setItem(NAME_KEY, name);
        if (pickShip) localStorage.setItem(SHIP_KEY, SHIP_IDS[idx] ?? '');
      } catch {
        // Not remembering is fine.
      }
      // A first-time player sees the tour before the match starts (nothing happens to the ship meanwhile).
      if (tourSeen()) onPlay(name, idx);
      else this.tour.open(() => onPlay(name, idx));
    });
    document.getElementById('menu-howto')?.addEventListener('click', () => {
      this.tour.open(() => this.name.focus());
    });
    // The language buttons: the choice is remembered and the page reloads so every text follows it.
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('#menu-lang button')) {
      b.classList.toggle('on', b.dataset['lang'] === currentLanguage());
      b.addEventListener('click', () => {
        if (b.dataset['lang'] === currentLanguage()) return;
        saveLanguage(b.dataset['lang'] ?? 'en');
        location.reload();
      });
    }
    // Typing must not steer the ship.
    this.form.addEventListener('keydown', (e) => e.stopPropagation());
    if (!pickShip) {
      this.ship.parentElement?.classList.add('gone');
      this.ship.value = '0';
    }
    this.name.focus();
  }

  /** Shows the connecting state (or clears it). */
  setBusy(busy: boolean): void {
    this.play.disabled = busy;
    this.note.classList.remove('error');
    this.note.textContent = busy ? t('menu.connecting') : '';
  }

  setError(key: MessageKey): void {
    this.play.disabled = false;
    this.note.classList.add('error');
    this.note.textContent = t(key);
  }

  show(): void {
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
    (document.activeElement as HTMLElement | null)?.blur();
  }
}
