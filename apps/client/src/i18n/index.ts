import en from './en.json';
import tr from './tr.json';

export type MessageKey = keyof typeof en;

const tables: Record<string, Record<MessageKey, string>> = { en, tr };

let current: Record<MessageKey, string> = en;

export function setLanguage(lang: string): void {
  current = tables[lang] ?? en;
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

export function detectLanguage(): string {
  return navigator.language.toLowerCase().startsWith('tr') ? 'tr' : 'en';
}
