import { worstColorDistance } from '../math/color.ts';

/**
 * The five countries of the game. Every team plays as one of them and wears its colour and name (a room picks two of
 * the five for every round, `pickCountries`). The names are made up and are the same in every language. The colours
 * are for the HUD (`ui`, and `hi`, a lighter one for text on a dark panel), the hull paint of the ships (`paint`, a tint
 * that is multiplied into the model's grey) and the ring under the player's ship (`ring`), all sRGB 0xRRGGBB.
 */
export interface Country {
  id: string;
  name: string;
  ui: number;
  hi: number;
  paint: number;
  ring: number;
}

export const COUNTRIES: readonly Country[] = [
  { id: 'thalor', name: 'Thalor', ui: 0x3f98ff, hi: 0xa9d6ff, paint: 0x72a9e4, ring: 0x23b4ff },
  { id: 'karzan', name: 'Karzan', ui: 0xff4a5c, hi: 0xffb0b8, paint: 0xff6b78, ring: 0xff2a45 },
  { id: 'solmar', name: 'Solmar', ui: 0xffd21f, hi: 0xffe9a0, paint: 0xe6c24a, ring: 0xffb300 },
  { id: 'verdan', name: 'Verdan', ui: 0x7be03a, hi: 0xcdf5a8, paint: 0x8ed75a, ring: 0x6ee02a },
  { id: 'lysar', name: 'Lysar', ui: 0xc15cff, hi: 0xe3b8ff, paint: 0xb98cf0, ring: 0xb040ff },
] as const;
export const COUNTRY_COUNT = COUNTRIES.length;

/**
 * Two teams that meet must never be mistaken for each other, so only pairs whose colours are plainly different are
 * allowed: at least this far apart (CIE76 delta E) for normal vision and for the two common kinds of red-green colour
 * blindness (see `worstColorDistance`).
 */
export const COUNTRY_MIN_DISTANCE = 50;

/** Every pair of countries (by index, smaller first) that may play against each other. */
export const COUNTRY_PAIRS: readonly (readonly [number, number])[] = (() => {
  const out: (readonly [number, number])[] = [];
  for (let a = 0; a < COUNTRIES.length; a++) {
    for (let b = a + 1; b < COUNTRIES.length; b++) {
      if (worstColorDistance(COUNTRIES[a]!.ui, COUNTRIES[b]!.ui) >= COUNTRY_MIN_DISTANCE) out.push([a, b]);
    }
  }
  return out;
})();

/** Two countries for a match, at random: one of the allowed pairs, in either order. `rnd` returns [0, 1). */
export function pickCountries(rnd: () => number): [number, number] {
  const pair = COUNTRY_PAIRS[Math.floor(rnd() * COUNTRY_PAIRS.length)]!;
  return rnd() < 0.5 ? [pair[0], pair[1]] : [pair[1], pair[0]];
}

export function countryOf(index: number): Country {
  return COUNTRIES[index >= 0 && index < COUNTRY_COUNT ? index : 0]!;
}
