import { ECONOMY, STAT, STAT_COUNT, TIER_SHIPS, statCap, statCost } from '@tidebreaker/shared';
import type { StatsMsg } from '@tidebreaker/shared';
import { t } from '../i18n/index.ts';
import type { MessageKey } from '../i18n/index.ts';
import agilityIcon from './icons/agility.svg?raw';
import ammunitionIcon from './icons/ammunition.svg?raw';
import cashIcon from './icons/cash.svg?raw';
import damageIcon from './icons/damage.svg?raw';
import repairIcon from './icons/repair.svg?raw';
import shieldIcon from './icons/shield.svg?raw';
import speedIcon from './icons/speed.svg?raw';

/** Largest upgrade cap of any tier: the number of pips every button shows. */
const PIP_COUNT = 8;

/** The bar of upgrades, left to right (keys 1-6): which stat, its name, color and icon. */
const TILES: readonly { stat: number; name: MessageKey; color: string; icon: string }[] = [
  { stat: STAT.SHIELD, name: 'stat.shield', color: 'var(--c-shield)', icon: shieldIcon },
  { stat: STAT.RELOAD, name: 'stat.reload', color: 'var(--c-reload)', icon: ammunitionIcon },
  { stat: STAT.DAMAGE, name: 'stat.damage', color: 'var(--c-damage)', icon: damageIcon },
  { stat: STAT.SPEED, name: 'stat.speed', color: 'var(--c-speed)', icon: speedIcon },
  { stat: STAT.TURN, name: 'stat.turn', color: 'var(--c-turn)', icon: agilityIcon },
  { stat: STAT.REGEN, name: 'stat.regen', color: 'var(--c-repair)', icon: repairIcon },
];

const ARROW_UP =
  '<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M10 1.8 2.6 10.2c-.6.7-.1 1.5.7 1.5h3.4v2.4c0 .5.4.9.8.9h5c.5 0 .8-.4.8-.9v-2.4h3.4c.9 0 1.3-.8.7-1.5z"/></svg>';

/** An imported icon without its fixed pixel size, so CSS can size it. */
function ico(svg: string): string {
  return svg.replace(/ width="\d+" height="\d+"/, '');
}

function el(tag: string, cls: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/**
 * The player's progress UI: lives, money and XP (in the top-left panel), the row of six upgrade
 * tiles (keys 1-6) and the class offer (key T) with the card of the next ship. The server decides
 * everything; this only shows what it last said and sends requests.
 */
export class ProgressHud {
  private readonly root = document.getElementById('progress') as HTMLElement;
  private readonly upgrades = document.getElementById('upgrades') as HTMLElement;
  private readonly stats = document.getElementById('p-stats') as HTMLElement;
  private readonly cards = document.getElementById('p-cards') as HTMLElement;
  private readonly tierBtn = document.getElementById('p-tier') as HTMLButtonElement;
  private readonly lives = document.getElementById('hud-lives') as HTMLElement;
  private readonly cash = document.getElementById('hud-cash') as HTMLElement;
  private readonly xp = document.getElementById('hud-xp') as HTMLElement;
  private readonly lv = document.getElementById('hud-lv') as HTMLElement;
  private readonly xpFill = document.getElementById('hud-xpfill') as HTMLElement;
  private readonly levels: HTMLElement[] = [];
  private readonly buttons: HTMLButtonElement[] = [];
  private readonly pips: HTMLElement[][] = [];
  private readonly costNums: HTMLElement[] = [];
  private cardFor = '';
  private visible = false;
  private offered = false;
  private last: StatsMsg | null = null;

  constructor(
    private readonly onUpgrade: (stat: number) => void,
    private readonly onTierUp: () => void,
  ) {
    (document.getElementById('hud-cash-ico') as HTMLElement).innerHTML = ico(cashIcon);

    for (let i = 0; i < STAT_COUNT; i++) {
      const tile = TILES[i]!;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'p-btn';
      b.style.setProperty('--c', tile.color);
      const icon = el('span', 'p-ico ico');
      icon.innerHTML = ico(tile.icon);
      const cost = el('span', 'p-cost');
      const costNum = el('span', '');
      const costIcon = el('span', 'ico');
      costIcon.innerHTML = ico(cashIcon);
      cost.append(costNum, costIcon);
      const pips = el('span', 'p-pips');
      const dots: HTMLElement[] = [];
      for (let k = 0; k < PIP_COUNT; k++) {
        const dot = el('span', 'pip');
        pips.append(dot);
        dots.push(dot);
      }
      const level = el('span', 'p-lv');
      b.append(
        el('span', 'p-key', String(i + 1)),
        icon,
        el('span', 'p-title', t(tile.name)),
        cost,
        level,
        pips,
      );
      this.levels.push(level);
      // Mouse clicks must not reach the game (they would fire the guns).
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      b.addEventListener('click', () => this.onUpgrade(tile.stat));
      this.stats.append(b);
      this.buttons.push(b);
      this.pips.push(dots);
      this.costNums.push(costNum);
    }

    for (const target of [this.tierBtn, this.cards]) {
      target.addEventListener('pointerdown', (e) => e.stopPropagation());
      target.addEventListener('click', () => this.onTierUp());
    }
    const arrowLeft = el('span', 'ico');
    arrowLeft.innerHTML = ARROW_UP;
    const arrowRight = el('span', 'ico');
    arrowRight.innerHTML = ARROW_UP;
    this.tierBtn.append(arrowLeft, el('span', 'ti-text'), arrowRight);
  }

  show(on: boolean): void {
    this.visible = on;
    this.upgrades.classList.toggle('hidden', !on);
    this.refreshOffer();
  }

  private refreshOffer(): void {
    this.root.classList.toggle('hidden', !(this.visible && this.offered));
  }

  /** The card of the next class (its top-down picture and name). */
  private showCard(shipId: string): void {
    if (shipId === this.cardFor) return;
    this.cardFor = shipId;
    const card = el('div', 'up-card panel');
    const img = document.createElement('img');
    img.alt = '';
    img.src = `${import.meta.env.BASE_URL}icons/ships/card/${shipId}.png`;
    const pic = el('div', 'uc-img');
    pic.append(img);
    const name = el('div', 'uc-name');
    // ("T3 Corvette" -> "Corvette": the class number is not needed on the card.)
    name.append(
      el('span', 'uc-key', 'T'),
      el('span', '', t(`ship.${shipId}` as MessageKey).replace(/^T\d\s*/, '')),
    );
    card.append(pic, name);
    this.cards.replaceChildren(card);
  }

  /** The player's own progress changed. */
  update(m: StatsMsg): void {
    this.lives.textContent = String(Math.max(0, m.lives));
    this.cash.textContent = String(m.cash);
    const next = ECONOMY.tierScore[m.tier + 1];
    // XP shows the score and what the next class needs; the bar fills between the two.
    const base = ECONOMY.tierScore[m.tier] ?? 0;
    this.xp.textContent =
      next === undefined ? `${t('hud.xp')} ${m.score}` : `${t('hud.xp')} ${m.score} / ${next}`;
    const frac = next === undefined ? 1 : (m.score - base) / Math.max(1, next - base);
    this.lv.textContent = `${t('hud.level')} ${m.tier + 1}`;
    this.xpFill.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
    this.xp.title = next === undefined ? t('progress.max') : `${t('progress.tierNeed')} ${next}`;

    const cap = statCap(m.tier);
    for (let i = 0; i < STAT_COUNT; i++) {
      const stat = TILES[i]!.stat;
      const level = m.levels[stat]!;
      const maxed = level >= cap;
      const cost = statCost(level);
      const dots = this.pips[i]!;
      for (let k = 0; k < PIP_COUNT; k++) {
        dots[k]!.className = k < level ? 'pip on' : k < cap ? 'pip open' : 'pip';
      }
      this.costNums[i]!.textContent = maxed ? 'MAX' : String(cost);
      const b = this.buttons[i]!;
      b.disabled = maxed || m.cash < cost;
      b.classList.toggle('maxed', maxed);
      b.classList.toggle('poor', !maxed && m.cash < cost);
      this.levels[i]!.textContent = String(level);
    }
    // Nothing to buy (too poor, or everything maxed): the upgrade row tucks itself away.
    const compact = this.buttons.every((b) => b.disabled);
    this.upgrades.classList.toggle('compact', compact);
    this.root.classList.toggle('compact', compact);

    const nextShip = TIER_SHIPS[m.tier + 1];
    this.offered = m.canTierUp && nextShip !== undefined;
    if (nextShip) this.showCard(nextShip);
    (this.tierBtn.querySelector('.ti-text') as HTMLElement).textContent = t('progress.tierUp');
    this.refreshOffer();
    this.last = m;
  }

  /** Keyboard shortcut for the tile in slot `i` (0-5, left to right); respects what it allows. */
  pressStat(i: number): void {
    if (this.buttons[i] && !this.buttons[i]!.disabled) this.onUpgrade(TILES[i]!.stat);
  }

  pressTierUp(): void {
    if (this.last?.canTierUp) this.onTierUp();
  }
}
