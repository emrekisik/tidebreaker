import { TEAM_A, TEAM_B, TEAM_PIRATE, countryOf } from '@tidebreaker/shared';
import type { Country } from '@tidebreaker/shared';

/**
 * Who the two teams are in the match on screen: team A and team B each play as one of the five countries (config/
 * countries.ts), which gives them a name and a colour. The room picks the countries and tells us in the MATCH message;
 * the start screen picks two for its own fight. The colours are also written to the page as CSS variables
 * (`--team-a`, `--team-a-hi`, `--team-a-rgb`, and the same for b) which the style sheets use.
 */
const countries: [number, number] = [0, 1];
const listeners: (() => void)[] = [];

const css = (hex: number): string => `#${hex.toString(16).padStart(6, '0')}`;
const rgb = (hex: number): string => `${(hex >> 16) & 255}, ${(hex >> 8) & 255}, ${hex & 255}`;

function publish(): void {
  const root = document.documentElement.style;
  for (const [slot, key] of [[0, 'a'], [1, 'b']] as const) {
    const c = countryOf(countries[slot]);
    root.setProperty(`--team-${key}`, css(c.ui));
    root.setProperty(`--team-${key}-hi`, css(c.hi));
    root.setProperty(`--team-${key}-rgb`, rgb(c.ui));
  }
  // The carriers' pictures (match bar, banner, start screen) are the ones painted in the country's colour.
  for (const img of document.querySelectorAll<HTMLImageElement>('img[data-carrier]')) {
    const c = countryOf(countries[img.dataset['carrier'] === 'b' ? 1 : 0]);
    img.src = `${import.meta.env.BASE_URL}icons/ships/card/aircraft_carrier_${c.id}.png`;
  }
  // The ladder of ships on the start screen is painted in team A's colour.
  for (const img of document.querySelectorAll<HTMLImageElement>('img[data-card]')) {
    img.src = `${import.meta.env.BASE_URL}icons/ships/card/${img.dataset['card']}_${countryOf(countries[0]).id}.png`;
  }
  for (const fn of listeners) fn();
}

/** The countries of team A and team B (indexes into `COUNTRIES`). */
export function setTeamCountries(a: number, b: number): void {
  if (a === countries[0] && b === countries[1]) return;
  countries[0] = a;
  countries[1] = b;
  publish();
}

/** Runs `fn` whenever the teams become other countries (and once now, so it starts with the right colours). */
export function onTeamCountries(fn: () => void): void {
  listeners.push(fn);
  fn();
}

export function teamCountry(team: number): Country {
  return countryOf(team === TEAM_B ? countries[1] : countries[0]);
}

/** The country's name (a made-up proper noun, the same in every language). */
export function teamName(team: number): string {
  return teamCountry(team).name;
}

/** The team's HUD colour as "r, g, b" (for `rgba(...)` in canvas drawing). */
export function teamRgb(team: number): string {
  return rgb(teamCountry(team).ui);
}

/** The team's HUD colour as `#rrggbb` (for canvas drawing; page styles use `var(--team-a)` and `var(--team-b)`). */
export function teamCss(team: number): string {
  return css(teamCountry(team).ui);
}

/** The team as a CSS class: `team-a`, `team-b` or `pirate` (see the `--team-a` and `--team-b` colours). */
export function teamClass(team: number): 'team-a' | 'team-b' | 'pirate' {
  return team === TEAM_A ? 'team-a' : team === TEAM_PIRATE ? 'pirate' : 'team-b';
}

publish();
