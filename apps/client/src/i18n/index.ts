import en from './en.json';

export type MessageKey = keyof typeof en;
/** The texts of one language. A language may leave out a text (the English one shows instead). */
export type Messages = Partial<Record<MessageKey, string>>;

export interface Language {
  /** The file name (`lang/<code>.json`) and the value of `<html lang>`. */
  code: string;
  /** The name of the language in that language (it is what the picker shows). */
  name: string;
}

/** Every language of the game, the most spoken first. English is built in; the others load when they are chosen. */
export const LANGUAGES: readonly Language[] = [
  { code: 'en', name: 'English' },
  { code: 'zh', name: '中文' },
  { code: 'hi', name: 'हिन्दी' },
  { code: 'es', name: 'Español' },
  { code: 'ar', name: 'العربية' },
  { code: 'fr', name: 'Français' },
  { code: 'bn', name: 'বাংলা' },
  { code: 'pt', name: 'Português' },
  { code: 'ru', name: 'Русский' },
  { code: 'ur', name: 'اردو' },
  { code: 'id', name: 'Bahasa Indonesia' },
  { code: 'de', name: 'Deutsch' },
  { code: 'ja', name: '日本語' },
  { code: 'tr', name: 'Türkçe' },
  { code: 'ko', name: '한국어' },
  { code: 'vi', name: 'Tiếng Việt' },
];

/** The language files, each its own chunk: a player only downloads the one they use. */
const files = import.meta.glob<{ default: Messages }>('./lang/*.json');

const tables: Record<string, Messages> = { en };
let current: Messages = en;
let currentCode = 'en';
/** Bumped by every `setLanguage`, so a slow download of an earlier choice cannot win over a later one. */
let ticket = 0;
const listeners: (() => void)[] = [];

export function t(key: MessageKey): string {
  return current[key] ?? en[key];
}

export function currentLanguage(): string {
  return currentCode;
}

/** Runs `fn` after every language change (for texts that were built from `t()` and kept). */
export function onLanguageChange(fn: () => void): void {
  listeners.push(fn);
}

/**
 * Switches the language of the whole page without reloading it: loads the file if it is not there yet, refills every
 * element marked for translation (`data-i18n`, `data-i18n-title`) and tells the modules that keep their own texts.
 */
export async function setLanguage(code: string): Promise<void> {
  const lang = LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0]!;
  const mine = ++ticket;
  if (!tables[lang.code]) {
    try {
      const load = files[`./lang/${lang.code}.json`];
      if (load) tables[lang.code] = (await load()).default;
    } catch {
      // The file did not come (offline): English stays.
    }
  }
  if (mine !== ticket) return;
  current = tables[lang.code] ?? en;
  currentCode = tables[lang.code] ? lang.code : 'en';
  // The language tells the browser how to draw the text (the dotted capital I of Turkish, the CJK fonts, ...).
  document.documentElement.lang = currentCode;
  applyI18n(document);
  for (const fn of listeners) fn();
}

/** Marks `el` as a text of the game: it gets the text of `key` now and again whenever the language changes. */
export function setText(el: HTMLElement, key: MessageKey): void {
  el.dataset['i18n'] = key;
  el.dir = 'auto';
  el.textContent = t(key);
}

/** Same for the tooltip of `el`. */
export function setTitle(el: HTMLElement, key: MessageKey): void {
  el.dataset['i18nTitle'] = key;
  el.title = t(key);
}

/** Fills every element carrying a `data-i18n` (text) or `data-i18n-title` (tooltip) attribute. */
export function applyI18n(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const key = el.dataset['i18n'] as MessageKey | undefined;
    if (!key) return;
    el.dir = 'auto';
    el.textContent = t(key);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => {
    const key = el.dataset['i18nTitle'] as MessageKey | undefined;
    if (key) el.title = t(key);
  });
}

const LANG_KEY = 'tidebreaker.lang';

/** The language the player picked; otherwise the first of the browser's languages the game has; otherwise English. */
export function detectLanguage(): string {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved && LANGUAGES.some((l) => l.code === saved)) return saved;
  } catch {
    // Private mode: use the browser's language.
  }
  for (const tag of navigator.languages ?? [navigator.language]) {
    const code = tag.toLowerCase().split('-')[0] ?? '';
    if (LANGUAGES.some((l) => l.code === code)) return code;
  }
  return 'en';
}

/** Remembers the language choice. */
export function saveLanguage(lang: string): void {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    // Not remembering is fine.
  }
}
