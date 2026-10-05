import { MODEL_SPECS } from '../render/modelSpecs.ts';

/** Test panel: one button per ship model. The callback must load the model before swapping. */
export class ShipPicker {
  private readonly buttons = new Map<string, HTMLButtonElement>();

  constructor(container: HTMLElement, active: string, onPick: (key: string) => Promise<void>) {
    for (const key of Object.keys(MODEL_SPECS)) {
      const b = document.createElement('button');
      b.textContent = key;
      b.addEventListener('click', () => {
        b.blur(); // keep Space/Enter from re-triggering the button while playing
        void onPick(key).then(() => this.setActive(key));
      });
      container.appendChild(b);
      this.buttons.set(key, b);
    }
    this.setActive(active);
  }

  setActive(key: string): void {
    for (const [k, b] of this.buttons) b.classList.toggle('active', k === key);
  }
}
