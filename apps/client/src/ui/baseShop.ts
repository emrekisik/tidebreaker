import {
  BASE,
  BASE_ITEM,
  DRONE,
  MISSILE,
  MINE,
  DRONE_TYPES,
  gunsCost,
  gunsDamageMul,
  gunsReloadMul,
} from '@tidebreaker/shared';
import { t } from '../i18n/index.ts';
import type { MessageKey } from '../i18n/index.ts';
import cashIcon from './icons/cash.svg?raw';
import damageIcon from './icons/damage.svg?raw';
import droneIcon from './icons/drone.svg?raw';
import uavIcon from './icons/uav.svg?raw';
import mineIcon from './icons/mine.svg?raw';
import missileIcon from './icons/missile.svg?raw';
import repairIcon from './icons/repair.svg?raw';

/** The icon without its fixed pixel size, so CSS can size it. */
function ico(svg: string): string {
  return svg.replace(/ width="\d+" height="\d+"/, '');
}

/** One row of the shop: a button with a key, an icon, a name with a line of explanation, and a price. */
interface Row {
  button: HTMLButtonElement;
  desc: HTMLElement;
  price: HTMLElement;
}

/**
 * The base shop: a window that opens while the player's ship is at their own carrier, bottom left
 * above the radar. Six rows (keys 7, 8, 9, 0, E and R, or a click): the two drone types, mending the
 * carrier, better carrier guns, the guided missile and the sea mine. The server decides whether a purchase is allowed; this only
 * shows what is possible and sends the request.
 */
export class BaseShop {
  private readonly root = document.getElementById('base-shop') as HTMLElement;
  private readonly count = document.createElement('span');
  private readonly rows: Row[] = [];
  private visible = false;
  /** The ship is in range of its carrier (the shop can be opened). */
  private near = false;
  /** The player opened the shop (it is only shown while in range). */
  private opened = false;
  /** The shop opened or closed. */
  onToggle: ((open: boolean) => void) | null = null;
  private cash = 0;
  private drones = 0;
  private gunLevel = 0;
  private missiles = 0;
  private mines = 0;
  /** The class of the player's ship (index, 0 = T1). */
  private tier = 0;
  /** The own carrier's hull (0..1). */
  private carrierHull = 1;

  /** `onBuy(item, arg)`: item 0 = a drone (`arg` = its type), 1 = mend the carrier, 2 = better guns. */
  constructor(private readonly onBuy: (item: number, arg: number) => void) {
    const head = document.createElement('div');
    head.className = 'ds-head';
    const title = document.createElement('span');
    title.textContent = t('base.title');
    this.count.className = 'ds-count';
    head.append(title, this.count);
    this.root.append(head);

    DRONE_TYPES.forEach((type, i) => {
      this.addRow(
        String(7 + i),
        // The FPV drone is a quadcopter; the combat drone is a fixed-wing unmanned aircraft.
        i === 0 ? droneIcon : uavIcon,
        t(`drone.${type.id}` as MessageKey),
        t(`drone.${type.id}.desc` as MessageKey),
        () => this.onBuy(0, i),
      );
    });
    this.addRow('9', repairIcon, t('base.repair'), '', () => this.onBuy(1, BASE_ITEM.REPAIR));
    this.addRow('0', damageIcon, t('base.guns'), '', () => this.onBuy(2, BASE_ITEM.GUNS));
    this.addRow('E', missileIcon, t('base.missile'), '', () => this.onBuy(2, BASE_ITEM.MISSILE));
    this.addRow('R', mineIcon, t('base.mine'), '', () => this.onBuy(2, BASE_ITEM.MINE));
    this.refresh();
  }

  private addRow(key: string, icon: string, name: string, desc: string, click: () => void): void {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ds-btn';
    const k = document.createElement('span');
    k.className = 'ds-key';
    k.textContent = key;
    const ic = document.createElement('span');
    ic.className = 'ds-ico';
    ic.innerHTML = ico(icon);
    const text = document.createElement('span');
    const title = document.createElement('span');
    title.className = 'ds-name';
    title.textContent = name;
    const d = document.createElement('span');
    d.className = 'ds-desc';
    d.textContent = desc;
    text.append(title, d);
    const price = document.createElement('span');
    price.className = 'ds-price';
    b.append(k, ic, text, price);
    // Mouse clicks must not reach the game (they would fire the guns).
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    b.addEventListener('click', click);
    this.root.append(b);
    this.rows.push({ button: b, desc: d, price });
  }

  /** Whether the ship is in range of its own carrier (call every frame). Out of range the shop closes; in range it only opens on request. */
  show(near: boolean): void {
    if (near === this.near) return;
    this.near = near;
    if (!near) this.opened = false;
    this.apply();
  }

  /** The shop button (or its key) was pressed: opens or closes the shop while in range. */
  toggle(): void {
    if (!this.near) return;
    this.opened = !this.opened;
    this.apply();
  }

  /** The ship is in range of its carrier. */
  get inRange(): boolean {
    return this.near;
  }

  private apply(): void {
    const on = this.near && this.opened;
    if (on === this.visible) return;
    this.visible = on;
    this.root.classList.toggle('hidden', !on);
    this.onToggle?.(on);
  }

  /** The player's money, drones and the level of the team's carrier guns changed. */
  setStats(cash: number, drones: number, gunLevel: number, missiles: number, mines: number, tier: number): void {
    this.cash = cash;
    this.drones = drones;
    this.gunLevel = gunLevel;
    this.missiles = missiles;
    this.mines = mines;
    this.tier = tier;
    this.refresh();
  }

  /** The own carrier's hull as a share of full (call every frame; it only redraws on a change). */
  setCarrierHull(frac: number): void {
    const f = Math.round(Math.max(0, Math.min(1, frac)) * 100) / 100;
    if (f === this.carrierHull) return;
    this.carrierHull = f;
    this.refresh();
  }

  /** Keyboard shortcut for row `i` (keys 7, 8, 9, 0, E, R = 0..5); only works while the shop is open. */
  press(i: number): void {
    const row = this.rows[i];
    if (this.visible && row && !row.button.disabled) row.button.click();
  }

  private refresh(): void {
    const full = this.drones >= DRONE.perPlayer;
    this.count.textContent = full
      ? `${t('drone.count')} ${this.drones}/${DRONE.perPlayer} · ${t('drone.full')}`
      : `${t('drone.count')} ${this.drones}/${DRONE.perPlayer}`;
    const coin = `<span class="ico">${ico(cashIcon)}</span>`;
    DRONE_TYPES.forEach((type, i) => {
      const row = this.rows[i]!;
      row.price.innerHTML = `${coin}${type.price}`;
      row.button.disabled = full || this.cash < type.price;
    });

    const repair = this.rows[2]!;
    const hullPct = Math.round(this.carrierHull * 100);
    repair.desc.textContent = `+${Math.round(BASE.repair.pct * 100)}% · ${t('base.carrier')} ${hullPct}%`;
    repair.price.innerHTML = `${coin}${BASE.repair.price}`;
    repair.button.disabled = this.carrierHull >= 1 || this.cash < BASE.repair.price;

    const guns = this.rows[3]!;
    const next = gunsCost(this.gunLevel);
    const maxed = next === Infinity;
    const dmg = Math.round((gunsDamageMul(this.gunLevel + 1) - 1) * 100);
    const rate = Math.round((1 / gunsReloadMul(this.gunLevel + 1) - 1) * 100);
    guns.desc.textContent = maxed
      ? `${t('base.level')} ${this.gunLevel}/${BASE.guns.maxLevel}`
      : `${t('base.level')} ${this.gunLevel}/${BASE.guns.maxLevel} → ${t('base.damage')} +${dmg}% · ${t('base.rate')} +${rate}%`;
    guns.price.innerHTML = maxed ? 'MAX' : `${coin}${next}`;
    guns.button.disabled = maxed || this.cash < next;

    const missile = this.rows[4]!;
    const canCarry = this.tier >= MISSILE.minTier;
    const rackFull = this.missiles >= MISSILE.maxStock;
    missile.desc.textContent = !canCarry
      ? t('base.missile.tier')
      : `${t('base.missile.desc')} · ${this.missiles}/${MISSILE.maxStock}`;
    missile.price.innerHTML = `${coin}${MISSILE.price}`;
    missile.button.disabled = !canCarry || rackFull || this.cash < MISSILE.price;

    const mine = this.rows[5]!;
    mine.desc.textContent = !canCarry
      ? t('base.mine.tier')
      : `${t('base.mine.desc')} · ${this.mines}/${MINE.maxStock}`;
    mine.price.innerHTML = `${coin}${MINE.price}`;
    mine.button.disabled = !canCarry || this.mines >= MINE.maxStock || this.cash < MINE.price;
  }
}
