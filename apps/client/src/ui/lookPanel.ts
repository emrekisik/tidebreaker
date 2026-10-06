import { t } from '../i18n/index.ts';
import type { MessageKey } from '../i18n/index.ts';

/** Everything the "Look" test panel can change. Colors are sRGB hex numbers. */
export interface Look {
  oceanDeep: number;
  oceanShallow: number;
  blue: number;
  red: number;
  ringBlue: number;
  ringRed: number;
  boost: number;
  glow: number;
  outline: boolean;
}

export const DEFAULT_LOOK: Look = {
  oceanDeep: 0x031a33,
  oceanShallow: 0x0b4f86,
  blue: 0x7ad6ff,
  red: 0xff6b78,
  ringBlue: 0x23b4ff,
  ringRed: 0xff2a45,
  boost: 2.6,
  glow: 0.3,
  outline: false,
};

const STORAGE_KEY = 'tidebreaker.look';

const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

function load(): Look {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_LOOK, ...(JSON.parse(raw) as Partial<Look>) };
  } catch {
    // Storage can be unavailable (private mode); the defaults are fine.
  }
  return { ...DEFAULT_LOOK };
}

type ColorKey = 'oceanDeep' | 'oceanShallow' | 'blue' | 'red' | 'ringBlue' | 'ringRed';

const COLOR_ROWS: ReadonlyArray<{ key: ColorKey; label: MessageKey }> = [
  { key: 'oceanDeep', label: 'look.oceanDeep' },
  { key: 'oceanShallow', label: 'look.oceanShallow' },
  { key: 'blue', label: 'look.blue' },
  { key: 'red', label: 'look.red' },
  { key: 'ringBlue', label: 'look.ringBlue' },
  { key: 'ringRed', label: 'look.ringRed' },
];

/**
 * Test panel with color pickers (ocean, team paint, rings), brightness/glow sliders and an outline
 * switch. Values are applied live, remembered in this browser, and printed as hex codes so they
 * can be copied into the config.
 */
export class LookPanel {
  private look: Look = load();
  private readonly apply: (look: Look) => void;
  private readonly readout: HTMLTextAreaElement;
  private readonly inputs = new Map<string, HTMLInputElement>();

  constructor(container: HTMLElement, apply: (look: Look) => void) {
    this.apply = apply;

    const head = document.createElement('div');
    head.className = 'head';
    head.textContent = t('look.title');
    const body = document.createElement('div');
    body.className = 'body';
    head.addEventListener('click', () => body.classList.toggle('collapsed'));
    container.append(head, body);

    for (const row of COLOR_ROWS) {
      const input = document.createElement('input');
      input.type = 'color';
      input.value = hex(this.look[row.key]);
      input.addEventListener('input', () => {
        this.look[row.key] = parseInt(input.value.slice(1), 16);
        this.changed();
      });
      this.inputs.set(row.key, input);
      body.appendChild(this.line(t(row.label), input));
    }

    body.appendChild(this.slider('look.boost', 'boost', 0.5, 4, 0.05));
    body.appendChild(this.slider('look.glow', 'glow', 0, 1, 0.02));

    const outline = document.createElement('input');
    outline.type = 'checkbox';
    outline.checked = this.look.outline;
    outline.addEventListener('change', () => {
      this.look.outline = outline.checked;
      this.changed();
    });
    this.inputs.set('outline', outline);
    body.appendChild(this.line(t('look.outline'), outline));

    const buttons = document.createElement('div');
    buttons.className = 'buttons';
    const reset = document.createElement('button');
    reset.textContent = t('look.reset');
    reset.addEventListener('click', () => this.reset());
    const copy = document.createElement('button');
    copy.textContent = t('look.copy');
    copy.addEventListener('click', () => void this.copy(copy));
    buttons.append(reset, copy);
    body.appendChild(buttons);

    this.readout = document.createElement('textarea');
    this.readout.readOnly = true;
    body.appendChild(this.readout);

    this.changed();
  }

  private line(label: string, control: HTMLElement): HTMLElement {
    const row = document.createElement('label');
    row.className = 'line';
    const text = document.createElement('span');
    text.textContent = label;
    row.append(text, control);
    return row;
  }

  private slider(
    label: MessageKey,
    key: 'boost' | 'glow',
    min: number,
    max: number,
    step: number,
  ): HTMLElement {
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(this.look[key]);
    input.addEventListener('input', () => {
      this.look[key] = Number(input.value);
      this.changed();
    });
    this.inputs.set(key, input);
    return this.line(t(label), input);
  }

  private changed(): void {
    this.apply(this.look);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.look));
    } catch {
      // Not remembering is fine.
    }
    this.readout.value = this.text();
  }

  private reset(): void {
    this.look = { ...DEFAULT_LOOK };
    for (const row of COLOR_ROWS) this.inputs.get(row.key)!.value = hex(this.look[row.key]);
    this.inputs.get('boost')!.value = String(this.look.boost);
    this.inputs.get('glow')!.value = String(this.look.glow);
    this.inputs.get('outline')!.checked = this.look.outline;
    this.changed();
  }

  /** The values as plain text, ready to paste into a chat. */
  private text(): string {
    const l = this.look;
    return [
      `oceanDeep: ${hex(l.oceanDeep)}`,
      `oceanShallow: ${hex(l.oceanShallow)}`,
      `blueTeam: ${hex(l.blue)}`,
      `redTeam: ${hex(l.red)}`,
      `blueRing: ${hex(l.ringBlue)}`,
      `redRing: ${hex(l.ringRed)}`,
      `brightness: ${l.boost.toFixed(2)}`,
      `glow: ${l.glow.toFixed(2)}`,
      `outline: ${l.outline ? 'on' : 'off'}`,
    ].join('\n');
  }

  private async copy(button: HTMLButtonElement): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.text());
      const old = button.textContent;
      button.textContent = t('look.copied');
      setTimeout(() => {
        button.textContent = old;
      }, 1200);
    } catch {
      this.readout.select(); // fall back to manual copy
    }
  }
}
