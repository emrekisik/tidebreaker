import { ECONOMY, SHIP_IDS, STAT_COUNT, TIER_SHIPS, statCap, statCost } from '@tidebreaker/shared';
import type { StatsMsg } from '@tidebreaker/shared';
import { t } from '../i18n/index.ts';
import type { MessageKey } from '../i18n/index.ts';

const STAT_KEYS: MessageKey[] = [
  'stat.speed',
  'stat.reload',
  'stat.turn',
  'stat.shield',
  'stat.regen',
  'stat.damage',
];

/** Largest upgrade cap of any tier: the number of dots every button shows. */
const PIP_COUNT = 8;

const SVG = (body: string): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

/** One icon per upgrade (same order as `STAT`): speed, reload, turn, shield, repair, damage. */
const STAT_ICONS: readonly string[] = [
  SVG('<path d="M9 5l11 7-11 7z" fill="currentColor"/><path d="M2 8h4M1 12h5M2 16h4"/>'),
  SVG('<path d="M20 11a8 8 0 0 0-14-4M4 13a8 8 0 0 0 14 4"/><path d="M20 4v6h-6M4 20v-6h6"/>'),
  SVG('<path d="M5 12a7 7 0 1 0 3-5.7"/><path d="M4 3v5h5"/>'),
  SVG('<path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z" fill="currentColor"/>'),
  SVG(
    '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.1L3 17.7 6.3 21l6.3-6.3a4 4 0 0 0 5.1-5.4l-2.6 2.6-2.4-.6-.6-2.4z" fill="currentColor"/>',
  ),
  SVG(
    '<path d="M12 1l2.5 7L22 6l-5 6 5 6-7.5-2L12 23l-2.5-7L2 18l5-6-5-6 7.5 2z" fill="currentColor"/>',
  ),
];

const STAR = SVG(
  '<path d="M12 2l3 6.5 7 .9-5.1 4.8 1.3 7L12 17.8 5.8 21.2l1.3-7L2 9.4l7-.9z" fill="currentColor"/>',
);
/** A banknote: the game's money is paper money, never coins. */
const NOTE = SVG(
  '<rect x="2" y="6" width="20" height="12" rx="1.5" fill="currentColor" fill-opacity=".25"/><circle cx="12" cy="12" r="3"/><path d="M5.5 9.5v.01M18.5 14.5v.01"/>',
);

function el(tag: string, cls: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/**
 * The progress UI: the ship info panel (class, lives, score, money), the "class up" button (key
 * T) and the six upgrade buttons (keys 1-6 as well). The server decides everything; this only
 * shows what it last said and sends requests.
 */
export class ProgressHud {
  private readonly root = document.getElementById('progress') as HTMLElement;
  private readonly upgrades = document.getElementById('upgrades') as HTMLElement;
  private readonly info = document.getElementById('p-info') as HTMLElement;
  private readonly stats = document.getElementById('p-stats') as HTMLElement;
  private readonly tierBtn = document.getElementById('p-tier') as HTMLButtonElement;
  private readonly buttons: HTMLButtonElement[] = [];
  private readonly pips: HTMLElement[][] = [];
  private readonly costNums: HTMLElement[] = [];
  private readonly nameText = document.createTextNode('');
  private readonly livesEl = el('span', 'pi-lives');
  private readonly needEl = el('span', 'label pi-need');
  private readonly scoreEl = document.createElement('b');
  private readonly cashEl = document.createElement('b');
  private readonly tierShip = el('span', 'ti-ship');
  private readonly tierText = el('span', 'ti-text');
  private last: StatsMsg | null = null;

  constructor(
    private readonly onUpgrade: (stat: number) => void,
    private readonly onTierUp: () => void,
  ) {
    // Ship info: label and class name on the left, score and money on the right.
    const ship = el('div', 'pi-ship');
    const label = el('div', 'label pi-label');
    label.append(el('span', '', t('progress.shipInfo')), this.needEl);
    const name = el('div', 'pi-name');
    name.append(this.nameText, this.livesEl);
    ship.append(label, name);
    const stats = el('div', 'pi-stats');
    stats.append(
      this.stat('score', STAR, t('progress.score'), this.scoreEl),
      this.stat('cash', NOTE, t('progress.cash'), this.cashEl),
    );
    this.info.append(ship, stats);

    for (let i = 0; i < STAT_COUNT; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'p-btn panel';
      const title = el('span', 'p-title');
      title.append(
        el('span', 'p-key', String(i + 1)),
        document.createTextNode(`-${t(STAT_KEYS[i]!)}`),
      );
      const cost = el('span', 'p-cost');
      cost.insertAdjacentHTML('beforeend', NOTE);
      const costNum = el('span', '');
      cost.append(costNum);
      const icon = el('span', 'p-icon');
      icon.innerHTML = STAT_ICONS[i]!;
      const pips = el('span', 'p-pips');
      const dots: HTMLElement[] = [];
      for (let k = 0; k < PIP_COUNT; k++) {
        const dot = el('span', 'pip');
        pips.append(dot);
        dots.push(dot);
      }
      b.append(title, cost, icon, pips);
      // Mouse clicks must not reach the game (they would fire the guns).
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      b.addEventListener('click', () => this.onUpgrade(i));
      this.stats.append(b);
      this.buttons.push(b);
      this.pips.push(dots);
      this.costNums.push(costNum);
    }

    this.tierBtn.append(this.tierShip, this.tierText, el('span', 'ti-arrow', '▲'));
    this.tierBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.tierBtn.addEventListener('click', () => this.onTierUp());
  }

  private stat(cls: string, icon: string, label: string, value: HTMLElement): HTMLElement {
    const row = el('div', `pi-stat ${cls}`);
    row.insertAdjacentHTML('beforeend', icon);
    row.append(document.createTextNode(`${label}:`), value);
    return row;
  }

  show(on: boolean): void {
    this.root.classList.toggle('hidden', !on);
    this.upgrades.classList.toggle('hidden', !on);
  }

  /** The player's own progress changed. */
  update(m: StatsMsg): void {
    const shipId = SHIP_IDS[m.shipId];
    this.nameText.data = shipId ? t(`ship.${shipId}` as MessageKey) : '';
    this.livesEl.textContent = '♥'.repeat(Math.max(0, m.lives));
    const next = ECONOMY.tierScore[m.tier + 1];
    this.needEl.textContent =
      next === undefined ? `· ${t('progress.max')}` : `· ${t('progress.tierNeed')} ${next}`;
    this.scoreEl.textContent = String(m.score);
    this.cashEl.textContent = String(m.cash);

    const cap = statCap(m.tier);
    for (let i = 0; i < STAT_COUNT; i++) {
      const level = m.levels[i]!;
      const maxed = level >= cap;
      const cost = statCost(level);
      const dots = this.pips[i]!;
      for (let k = 0; k < PIP_COUNT; k++) {
        dots[k]!.className = k < level ? 'pip on' : k < cap ? 'pip open' : 'pip';
      }
      this.costNums[i]!.textContent = maxed ? 'MAX' : String(cost);
      this.buttons[i]!.disabled = maxed || m.cash < cost;
      this.buttons[i]!.classList.toggle('maxed', maxed);
    }

    this.tierBtn.classList.toggle('hidden', !m.canTierUp);
    const nextShip = TIER_SHIPS[m.tier + 1];
    if (nextShip) {
      const url = `${import.meta.env.BASE_URL}icons/ships/side/white/${nextShip}.png`;
      this.tierShip.style.setProperty('--icon', `url(${url})`);
    }
    this.tierText.textContent = `${t('progress.tierUp')} (T)`;
    this.last = m;
  }

  /** Keyboard shortcut for stat `i` (0-5); respects what the buttons allow. */
  pressStat(i: number): void {
    if (this.buttons[i] && !this.buttons[i]!.disabled) this.onUpgrade(i);
  }

  pressTierUp(): void {
    if (this.last?.canTierUp) this.onTierUp();
  }
}
