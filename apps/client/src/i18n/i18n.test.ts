import { describe, expect, it } from 'vitest';
import en from './en.json';
import { LANGUAGES } from './index.ts';

const files = import.meta.glob<Record<string, string>>('./lang/*.json', { eager: true, import: 'default' });
const byCode = new Map<string, Record<string, string>>();
for (const [path, table] of Object.entries(files)) byCode.set(path.replace(/^.*\/(.+)\.json$/, '$1'), table);

/** Texts of the developer tools (test panels): they stay English. */
const DEV_ONLY = /^(look\.|picker\.|menu\.ship$)/;
const placeholders = (text: string): string => (text.match(/\{[a-z]+\}/g) ?? []).sort().join(',');
const english = en as Record<string, string>;

describe('languages', () => {
  it('lists every language file, and a file for every listed language but English', () => {
    const listed = LANGUAGES.map((l) => l.code).filter((c) => c !== 'en');
    expect([...byCode.keys()].sort()).toEqual(listed.sort());
    expect(new Set(LANGUAGES.map((l) => l.code)).size).toBe(LANGUAGES.length);
  });

  for (const [code, table] of byCode) {
    describe(code, () => {
      it('has no text the English file does not have', () => {
        expect(Object.keys(table).filter((k) => !(k in english))).toEqual([]);
      });

      it('has every text of the game (only the developer tools stay English)', () => {
        const missing = Object.keys(english).filter((k) => !DEV_ONLY.test(k) && !(k in table));
        expect(missing).toEqual([]);
      });

      it('has no empty text and keeps the {placeholders} of the English one', () => {
        for (const [key, text] of Object.entries(table)) {
          expect(text.trim(), key).not.toBe('');
          expect(placeholders(text), key).toBe(placeholders(english[key]!));
        }
      });
    });
  }
});
