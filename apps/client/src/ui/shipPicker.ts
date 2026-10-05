import { t } from '../i18n/index.ts';
import { MODEL_SPECS } from '../render/modelSpecs.ts';

/**
 * Test panel: one button per ship model. `onPick` must load the model before swapping, and
 * `getFailure` reports why a model fell back to the placeholder (shown in red under the buttons).
 */
export class ShipPicker {
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private readonly note: HTMLElement;
  private readonly getFailure: (key: string) => string | undefined;

  constructor(
    container: HTMLElement,
    active: string,
    onPick: (key: string) => Promise<void>,
    getFailure: (key: string) => string | undefined,
  ) {
    this.getFailure = getFailure;
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
    this.note = document.createElement('div');
    this.note.className = 'note';
    container.appendChild(this.note);
    this.setActive(active);
  }

  setActive(key: string): void {
    for (const [k, b] of this.buttons) b.classList.toggle('active', k === key);
    const failure = this.getFailure(key);
    this.note.textContent = failure ? `${t('picker.failed')} (${failure})` : '';
  }
}
