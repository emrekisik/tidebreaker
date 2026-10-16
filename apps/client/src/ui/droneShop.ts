import { DRONE, DRONE_TYPES } from '@tidebreaker/shared';
import { t } from '../i18n/index.ts';
import type { MessageKey } from '../i18n/index.ts';
import cashIcon from './icons/cash.svg?raw';
import droneIcon from './icons/drone.svg?raw';

/** The icon without its fixed pixel size, so CSS can size it. */
function ico(svg: string): string {
  return svg.replace(/ width="\d+" height="\d+"/, '');
}

/**
 * The drone shop: a small window that opens while the player is at their own carrier. One button per
 * drone type (keys 7 and 8, or a click) with its price; the server decides whether the purchase is
 * allowed (money, place, limit).
 */
export class DroneShop {
  private readonly root = document.getElementById('drone-shop') as HTMLElement;
  private readonly count = document.createElement('span');
  private readonly buttons: HTMLButtonElement[] = [];
  private visible = false;
  private cash = 0;
  private drones = 0;

  constructor(private readonly onBuy: (type: number) => void) {
    const head = document.createElement('div');
    head.className = 'ds-head';
    const title = document.createElement('span');
    title.textContent = t('drone.title');
    this.count.className = 'ds-count';
    head.append(title, this.count);
    this.root.append(head);
    DRONE_TYPES.forEach((type, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ds-btn';
      const key = document.createElement('span');
      key.className = 'ds-key';
      key.textContent = String(7 + i);
      const icon = document.createElement('span');
      icon.className = 'ds-ico';
      icon.innerHTML = ico(droneIcon);
      const name = document.createElement('span');
      const title = document.createElement('span');
      title.className = 'ds-name';
      title.textContent = t(`drone.${type.id}` as MessageKey);
      const desc = document.createElement('span');
      desc.className = 'ds-desc';
      desc.textContent = t(`drone.${type.id}.desc` as MessageKey);
      name.append(title, desc);
      const price = document.createElement('span');
      price.className = 'ds-price';
      const coin = document.createElement('span');
      coin.className = 'ico';
      coin.innerHTML = ico(cashIcon);
      price.append(coin, document.createTextNode(String(type.price)));
      b.append(key, icon, name, price);
      // Mouse clicks must not reach the game (they would fire the guns).
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      b.addEventListener('click', () => this.onBuy(i));
      this.root.append(b);
      this.buttons.push(b);
    });
    this.refresh();
  }

  /** Opens or closes the window (call every frame; it only touches the page on a change). */
  show(on: boolean): void {
    if (on === this.visible) return;
    this.visible = on;
    this.root.classList.toggle('hidden', !on);
  }

  /** The player's money and number of drones changed. */
  setStats(cash: number, drones: number): void {
    this.cash = cash;
    this.drones = drones;
    this.refresh();
  }

  /** Keyboard shortcut for drone type `i` (key 7 = 0, key 8 = 1); only works while the shop is open. */
  press(i: number): void {
    const b = this.buttons[i];
    if (this.visible && b && !b.disabled) this.onBuy(i);
  }

  private refresh(): void {
    const full = this.drones >= DRONE.perPlayer;
    this.count.textContent = full
      ? `${t('drone.count')} ${this.drones}/${DRONE.perPlayer} · ${t('drone.full')}`
      : `${t('drone.count')} ${this.drones}/${DRONE.perPlayer}`;
    DRONE_TYPES.forEach((type, i) => {
      this.buttons[i]!.disabled = full || this.cash < type.price;
    });
  }
}
