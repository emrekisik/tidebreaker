import en from './en.json';
import tr from './tr.json';

export type MessageKey = keyof typeof en;

const tables: Record<string, Record<MessageKey, string>> = { en, tr };

let current: Record<MessageKey, string> = en;

export function setLanguage(lang: string): void {
  current = tables[lang] ?? en;
  // Uppercase labels in CSS need the right language (Turkish has a dotted capital I).
  document.documentElement.lang = tables[lang] ? lang : 'en';
}

export function t(key: MessageKey): string {
  return current[key];
}

/** Fills every element carrying a `data-i18n` attribute. */
export function applyI18n(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const key = el.dataset['i18n'] as MessageKey | undefined;
    if (key) el.textContent = t(key);
  });
}

const LANG_KEY = 'tidebreaker.lang';

/** The language the player picked on the menu; otherwise the browser's (Turkish or English). */
export function detectLanguage(): string {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved && tables[saved]) return saved;
  } catch {
    // Private mode: use the browser's language.
  }
  return navigator.language.toLowerCase().startsWith('tr') ? 'tr' : 'en';
}

/** Remembers the language choice (the page reloads to use it everywhere). */
export function saveLanguage(lang: string): void {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    // Not remembering is fine.
  }
}

export function currentLanguage(): string {
  return document.documentElement.lang === 'tr' ? 'tr' : 'en';
}
