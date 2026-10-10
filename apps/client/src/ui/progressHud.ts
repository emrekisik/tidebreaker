import { ECONOMY, SHIP_IDS, STAT_COUNT, statCap, statCost } from '@tidebreaker/shared';
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

/**
 * The progress strip at the bottom of the screen: score and money, the six upgrade buttons (keys
 * 1-6 as well) and the "class up" button (key T). The server decides everything; this only shows
 * what it last said and sends requests.
 */
export class ProgressHud {
  private readonly root = document.getElementById('progress') as HTMLElement;
  private readonly info = document.getElementById('p-info') as HTMLElement;
  private readonly stats = document.getElementById('p-stats') as HTMLElement;
  private readonly tierBtn = document.getElementById('p-tier') as HTMLButtonElement;
  private readonly buttons: HTMLButtonElement[] = [];
  private readonly pips: HTMLElement[] = [];
  private readonly costs: HTMLElement[] = [];
  private last: StatsMsg | null = null;

  constructor(
    private readonly onUpgrade: (stat: number) => void,
    private readonly onTierUp: () => void,
  ) {
    for (let i = 0; i < STAT_COUNT; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'p-btn';
      const key = document.createElement('span');
      key.className = 'p-key';
      key.textContent = String(i + 1);
      const name = document.createElement('span');
      name.className = 'p-name';
      name.textContent = t(STAT_KEYS[i]!);
      const pips = document.createElement('span');
      pips.className = 'p-pips';
      const cost = document.createElement('span');
      cost.className = 'p-cost';
      b.append(key, name, pips, cost);
      // Mouse clicks must not reach the game (they would fire the guns).
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      b.addEventListener('click', () => this.onUpgrade(i));
      this.stats.append(b);
      this.buttons.push(b);
      this.pips.push(pips);
      this.costs.push(cost);
    }
    this.tierBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.tierBtn.addEventListener('click', () => this.onTierUp());
  }

  show(on: boolean): void {
    this.root.classList.toggle('hidden', !on);
  }

  /** The player's own progress changed. */
  update(m: StatsMsg): void {
    const shipId = SHIP_IDS[m.shipId];
    const className = shipId ? t(`ship.${shipId}` as MessageKey) : '';
    const next = ECONOMY.tierScore[m.tier + 1];
    const need = next === undefined ? t('progress.max') : `${t('progress.tierNeed')} ${next}`;
    const lives = '♥'.repeat(Math.max(0, m.lives));
    this.info.textContent = `${className} ${lives} · ${t('progress.score')} ${m.score} · ${t('progress.cash')} ${m.cash} · ${need}`;
    const cap = statCap(m.tier);
    for (let i = 0; i < STAT_COUNT; i++) {
      const level = m.levels[i]!;
      const maxed = level >= cap;
      const cost = statCost(level);
      this.pips[i]!.textContent = '▮'.repeat(level) + '▯'.repeat(Math.max(0, cap - level));
      this.costs[i]!.textContent = maxed ? '—' : String(cost);
      this.buttons[i]!.disabled = maxed || m.cash < cost;
    }
    this.tierBtn.classList.toggle('hidden', !m.canTierUp);
    this.tierBtn.textContent = `${t('progress.tierUp')} (T)`;
    this.last = m;
  }

  /** Keyboard shortcut for stat `i` (0-4); respects what the buttons allow. */
  pressStat(i: number): void {
    if (this.buttons[i] && !this.buttons[i]!.disabled) this.onUpgrade(i);
  }

  pressTierUp(): void {
    if (this.last?.canTierUp) this.onTierUp();
  }
}
