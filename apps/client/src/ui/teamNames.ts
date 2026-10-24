import { TEAM_BLUE, TEAM_NAME_COUNT, TEAM_RED } from '@tidebreaker/shared';
import { t } from '../i18n/index.ts';
import type { MessageKey } from '../i18n/index.ts';

/** The numbers of the current names of the blue and red team (-1 until the server has told). */
const names = [-1, -1];

/** The server's latest draw (it comes with every MATCH message). */
export function setTeamNames(blue: number, red: number): void {
  names[TEAM_BLUE] = blue;
  names[TEAM_RED] = red;
}

/** The name of a team: the generic name the room drew for this round ("Eagles"), or the colour until it is known. */
export function teamName(team: number): string {
  const n = names[team] ?? -1;
  if (n >= 0 && n < TEAM_NAME_COUNT) return t(`team.name.${n}` as MessageKey);
  return t(team === TEAM_BLUE ? 'team.blue' : 'team.red');
}
