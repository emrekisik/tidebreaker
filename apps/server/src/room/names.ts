import { NAME_MAX_CHARS } from '@tidebreaker/shared';

/** Words that may not appear in a name (case-insensitive). Words up to 4 letters only match as a whole word. TR + EN starter list. */
const BLOCKED = [
  'admin',
  'moderator',
  'mod',
  'server',
  'system',
  'support',
  'staff',
  'fuck',
  'shit',
  'bitch',
  'nigg',
  'nazi',
  'hitler',
  'sik',
  'amk',
  'orospu',
  'piç',
  'yarak',
  'götün',
  'göt',
  'ibne',
];

/**
 * Cleans a player name (GAME_DESIGN.md §13): NFC, only letters, digits, space, `_` and `-`,
 * repeated spaces collapsed, 1-16 characters, no blocked words. Returns null when nothing usable
 * is left or a blocked word is found.
 */
export function sanitizeName(raw: string): string | null {
  let name = raw.normalize('NFC');
  name = name.replace(/[^\p{L}\p{N} _-]/gu, '');
  name = name.replace(/\s+/g, ' ').trim();
  const chars = Array.from(name);
  if (chars.length > NAME_MAX_CHARS) name = chars.slice(0, NAME_MAX_CHARS).join('').trim();
  if (Array.from(name).length === 0) return null;
  const lower = name.toLocaleLowerCase('en');
  const squashed = lower.replace(/[\s_-]/g, '');
  const tokens = lower.split(/[\s_-]+/);
  for (const word of BLOCKED) {
    // Short words only count as a whole word ("mod" must not block "Modern").
    if (word.length <= 4 ? tokens.includes(word) : squashed.includes(word)) return null;
  }
  return name;
}
