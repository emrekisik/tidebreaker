import { t } from '../i18n/index.ts';
import shopIcon from './icons/shop.svg?raw';

/**
 * The "shop" button over the player's own carrier: it appears when the ship is close enough to buy and opens the base
 * shop (the shop itself no longer opens by itself). Placed over the game every frame.
 */
export class ShopButton {
  private readonly button = document.createElement('button');
  private shown = false;
  private x = -1e9;
  private y = -1e9;

  constructor(root: HTMLElement, onClick: () => void) {
    this.button.type = 'button';
    this.button.className = 'shop-btn';
    this.button.style.display = 'none';
    const ico = document.createElement('span');
    ico.className = 'sbtn-ico';
    ico.innerHTML = shopIcon.replace(/ width="\d+" height="\d+"/, '');
    const label = document.createElement('span');
    label.textContent = t('base.openShop');
    const key = document.createElement('kbd');
    key.textContent = 'B';
    this.button.append(ico, label, key);
    // A mouse press must not reach the game (it would fire the guns).
    this.button.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.button.addEventListener('click', () => {
      this.button.blur();
      onClick();
    });
    root.append(this.button);
  }

  /** Every frame: `visible` is whether the ship is in range; (x, y) the screen spot above the carrier (pixels). */
  update(visible: boolean, x: number, y: number): void {
    if (visible !== this.shown) {
      this.shown = visible;
      this.button.style.display = visible ? '' : 'none';
    }
    if (!visible) return;
    const px = Math.round(x);
    const py = Math.round(y);
    if (px !== this.x || py !== this.y) {
      this.x = px;
      this.y = py;
      this.button.style.transform = `translate3d(${px}px, ${py}px, 0) translate(-50%, -50%)`;
    }
  }

  /** The shop is open: the button reads "close". */
  setOpen(open: boolean): void {
    this.button.classList.toggle('open', open);
    (this.button.children[1] as HTMLElement).textContent = t(open ? 'base.closeShop' : 'base.openShop');
  }
}
