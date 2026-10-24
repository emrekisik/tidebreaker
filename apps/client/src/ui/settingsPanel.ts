import { audio } from '../audio/engine.ts';
import { LANGUAGES, currentLanguage, onLanguageChange, saveLanguage, setLanguage, setText, setTitle, t } from '../i18n/index.ts';
import type { MessageKey } from '../i18n/index.ts';

const GEAR =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3h3.4l.5 2.4c.5.2 1 .5 1.5.9l2.3-.8 1.7 2.9-1.8 1.6c.1.5.1 1.1 0 1.6l1.8 1.6-1.7 2.9-2.3-.8c-.5.4-1 .7-1.5.9l-.5 2.4h-3.4l-.5-2.4c-.5-.2-1-.5-1.5-.9l-2.3.8-1.7-2.9 1.8-1.6a5 5 0 0 1 0-1.6L4.8 8.4l1.7-2.9 2.3.8c.5-.4 1-.7 1.5-.9L10.3 3z"/><circle cx="12" cy="12" r="2.6"/></svg>';

const OPACITY_KEY = 'tidebreaker.hudOpacity';
/** The slider's middle is the default look; the panels' opacity is multiplied by 0.2 (left) ... 1.8 (right). */
const OPACITY_DEFAULT = 50;

function applyOpacity(value: number): void {
  document.documentElement.style.setProperty('--hud-alpha', String(0.2 + (1.6 * value) / 100));
}

function savedOpacity(): number {
  try {
    const v = Number(localStorage.getItem(OPACITY_KEY));
    if (localStorage.getItem(OPACITY_KEY) !== null && Number.isFinite(v)) return Math.max(0, Math.min(100, v));
  } catch {
    // No saved choice: the default.
  }
  return OPACITY_DEFAULT;
}

/** The keys of the game, as [what to press (letters as they are, words as a text key), text key]. */
const KEYS: readonly (readonly [string, MessageKey])[] = [
  ['W  A  S  D', 'keys.move'],
  ['keys.chip.mouse', 'keys.aim'],
  ['keys.chip.left', 'keys.fire'],
  ['keys.chip.right', 'keys.auto'],
  ['keys.chip.space', 'keys.gas'],
  ['keys.chip.wheel', 'keys.zoom'],
  ['1 – 6', 'keys.upgrade'],
  ['T  Y', 'keys.tier'],
  ['B', 'keys.shop'],
  ['Q', 'keys.missile'],
  ['F', 'keys.mine'],
  ['C', 'keys.emote'],
  ['M', 'keys.map'],
  ['Tab', 'keys.score'],
  ['Esc', 'keys.settings'],
];

/**
 * The settings of a running match: a gear button in the top right corner that opens a plain panel with the sound
 * (volume, sea and engine), the look (panel opacity, language) and the list of keys, and a way back to the how-to-play tour. The match goes on
 * while it is open (there is no pause in a multiplayer game). The panel and the start screen's sound control follow
 * each other through the audio engine.
 */
export class SettingsPanel {
  private readonly button = document.getElementById('settings-btn') as HTMLButtonElement;
  private readonly panel = document.getElementById('settings') as HTMLElement;
  private readonly mute = document.createElement('button');
  private readonly volume = document.createElement('input');
  private readonly volumeNum = document.createElement('span');
  private readonly sea = document.createElement('button');
  private readonly opacity = document.createElement('input');
  private readonly opacityNum = document.createElement('span');
  private readonly tabs: HTMLButtonElement[] = [];
  private readonly pages: HTMLElement[] = [];

  /** `onHowTo`: the player asked for the how-to-play tour. */
  constructor(private readonly onHowTo: () => void) {
    this.button.innerHTML = GEAR;
    setTitle(this.button, 'settings.title');
    this.button.addEventListener('click', () => this.toggle());
    // Nothing clicked here may reach the game (it would fire the guns), and typing must not steer the ship.
    for (const el of [this.button, this.panel]) {
      el.addEventListener('pointerdown', (e) => e.stopPropagation());
      el.addEventListener('keydown', (e) => {
        if (e.code !== 'Escape') e.stopPropagation();
      });
    }
    applyOpacity(savedOpacity());
    this.build();
    audio.subscribe(() => this.refresh());
    // (The on / off words are set here, not marked for translation: they change with the audio state too.)
    onLanguageChange(() => this.refresh());
    this.refresh();
  }

  /** Shown or hidden with the match (the start screen has its own sound control). */
  show(on: boolean): void {
    this.button.classList.toggle('hidden', !on);
    if (!on) this.close();
  }

  get isOpen(): boolean {
    return !this.panel.classList.contains('hidden');
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  open(): void {
    this.panel.classList.remove('hidden');
    this.button.classList.add('on');
  }

  close(): void {
    this.panel.classList.add('hidden');
    this.button.classList.remove('on');
    (document.activeElement as HTMLElement | null)?.blur();
  }

  private row(label: MessageKey, control: HTMLElement): HTMLElement {
    const row = document.createElement('div');
    row.className = 'st-row';
    const name = document.createElement('span');
    name.className = 'st-label';
    setText(name, label);
    row.append(name, control);
    return row;
  }

  private build(): void {
    const head = document.createElement('div');
    head.className = 'st-head';
    const title = document.createElement('span');
    setText(title, 'settings.title');
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'st-close';
    close.textContent = 'Esc';
    close.addEventListener('click', () => this.close());
    head.append(title, close);

    const bar = document.createElement('div');
    bar.className = 'st-tabs';
    for (const [i, key] of (['settings.tab.sound', 'settings.tab.display', 'settings.tab.keys'] as const).entries()) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'st-tab';
      setText(b, key);
      b.addEventListener('click', () => this.page(i));
      bar.append(b);
      this.tabs.push(b);
    }

    // Sound.
    const sound = document.createElement('div');
    sound.className = 'st-page';
    this.mute.type = 'button';
    this.mute.className = 'st-switch';
    this.mute.addEventListener('click', () => {
      audio.unlock();
      audio.setMuted(!audio.muted);
    });
    this.volume.type = 'range';
    this.volume.min = '0';
    this.volume.max = '100';
    this.volume.className = 'st-slider';
    this.volume.addEventListener('input', () => {
      audio.unlock();
      audio.setVolume(Number(this.volume.value) / 100);
    });
    this.volume.addEventListener('change', () => this.volume.blur());
    this.volumeNum.className = 'st-num';
    const slider = document.createElement('div');
    slider.className = 'st-slider-box';
    slider.append(this.volume, this.volumeNum);
    this.sea.type = 'button';
    this.sea.className = 'st-switch';
    this.sea.addEventListener('click', () => {
      audio.unlock();
      audio.setAmbient(!audio.ambientOn);
    });
    sound.append(
      this.row('settings.sound', this.mute),
      this.row('sound.volume', slider),
      this.row('settings.ambient', this.sea),
    );

    // Display: how see-through the panels are.
    const display = document.createElement('div');
    display.className = 'st-page';
    this.opacity.type = 'range';
    this.opacity.min = '0';
    this.opacity.max = '100';
    this.opacity.className = 'st-slider';
    this.opacity.value = String(savedOpacity());
    this.opacityNum.className = 'st-num';
    this.opacityNum.textContent = this.opacity.value;
    this.opacity.addEventListener('input', () => {
      const v = Number(this.opacity.value);
      applyOpacity(v);
      this.opacityNum.textContent = String(v);
      try {
        localStorage.setItem(OPACITY_KEY, String(v));
      } catch {
        // Not remembering is fine.
      }
    });
    this.opacity.addEventListener('change', () => this.opacity.blur());
    const opacityBox = document.createElement('div');
    opacityBox.className = 'st-slider-box';
    opacityBox.append(this.opacity, this.opacityNum);
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'st-btn';
    setText(reset, 'settings.reset');
    reset.addEventListener('click', () => {
      this.opacity.value = String(OPACITY_DEFAULT);
      this.opacity.dispatchEvent(new Event('input'));
    });
    const note = document.createElement('p');
    note.className = 'st-note';
    setText(note, 'settings.opacityNote');
    // The language: a choice changes every text of the game at once (no reload).
    const language = document.createElement('select');
    language.className = 'st-select';
    for (const lang of LANGUAGES) {
      const o = document.createElement('option');
      o.value = lang.code;
      o.textContent = lang.name;
      o.lang = lang.code;
      language.append(o);
    }
    language.value = currentLanguage();
    language.addEventListener('change', () => {
      saveLanguage(language.value);
      void setLanguage(language.value);
      language.blur();
    });
    onLanguageChange(() => (language.value = currentLanguage()));
    setTitle(language, 'menu.language');
    display.append(this.row('menu.language', language), this.row('settings.opacity', opacityBox), note, reset);

    // Keys.
    const keys = document.createElement('div');
    keys.className = 'st-page st-keys';
    for (const [chip, text] of KEYS) {
      const row = document.createElement('div');
      row.className = 'st-key';
      const kbd = document.createElement('kbd');
      if (chip.startsWith('keys.chip.')) setText(kbd, chip as MessageKey);
      else kbd.textContent = chip;
      const desc = document.createElement('span');
      setText(desc, text);
      row.append(kbd, desc);
      keys.append(row);
    }
    this.pages.push(sound, display, keys);

    const foot = document.createElement('div');
    foot.className = 'st-foot';
    const howto = document.createElement('button');
    howto.type = 'button';
    howto.className = 'st-btn';
    setText(howto, 'menu.howto');
    howto.addEventListener('click', () => {
      this.close();
      this.onHowTo();
    });
    foot.append(howto);

    this.panel.append(head, bar, sound, display, keys, foot);
    this.page(0);
  }

  private page(i: number): void {
    this.tabs.forEach((b, k) => b.classList.toggle('on', k === i));
    this.pages.forEach((p, k) => p.classList.toggle('hidden', k !== i));
  }

  private refresh(): void {
    this.mute.textContent = t(audio.muted ? 'settings.off' : 'settings.on');
    this.mute.classList.toggle('on', !audio.muted);
    this.volume.value = String(Math.round(audio.volume * 100));
    this.volumeNum.textContent = `${Math.round(audio.volume * 100)}`;
    this.sea.textContent = t(audio.ambientOn ? 'settings.on' : 'settings.off');
    this.sea.classList.toggle('on', audio.ambientOn);
  }
}
