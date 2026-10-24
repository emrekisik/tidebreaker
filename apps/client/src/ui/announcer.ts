import { ANNOUNCE } from '@tidebreaker/shared';
import { t } from '../i18n/index.ts';
import damageIcon from './icons/damage.svg?raw';
import repairIcon from './icons/repair.svg?raw';
import rigIcon from './icons/rig.svg?raw';
import { rankBadge } from './rankBadge.ts';
import { RankBook } from './rankBook.ts';
import { teamClass, teamName } from './teams.ts';

const MAX_ROWS = 4;
const LIFETIME_MS = 6500;

/**
 * Announcements in the top middle of the screen: a team took or lost an oil rig, a player mended the
 * carrier or made its guns stronger. Rows fade out by themselves.
 */
export class Announcer {
  constructor(private readonly root: HTMLElement) {}

  /** The player's own rank went up. */
  rankUp(rank: number, team: number): void {
    const row = document.createElement('div');
    row.className = `ann-row ann-rank panel ${teamClass(team)}`;
    row.append(rankBadge(rank, RankBook.title(rank)), document.createTextNode(` ${t('announce.rankUp').replace('{name}', RankBook.title(rank))}`));
    this.root.append(row);
    while (this.root.childElementCount > MAX_ROWS) this.root.firstElementChild?.remove();
    setTimeout(() => row.classList.add('fading'), LIFETIME_MS - 600);
    setTimeout(() => row.remove(), LIFETIME_MS);
  }

  /** `name`: the player behind it (empty when it is the team's doing, like a rig). Shown as text only. */
  show(kind: number, arg: number, team: number, name: string): void {
    const teamLabel = teamName(team);
    let text: string;
    switch (kind) {
      case ANNOUNCE.RIG_CAPTURED:
        text = t('announce.rigCaptured');
        break;
      case ANNOUNCE.RIG_LOST:
        text = t('announce.rigLost');
        break;
      case ANNOUNCE.CARRIER_REPAIRED:
        text = t('announce.repair');
        break;
      case ANNOUNCE.GUNS_UPGRADED:
        text = t('announce.guns');
        break;
      default:
        return;
    }
    text = text
      .replace('{team}', teamLabel)
      .replace('{rig}', String.fromCharCode(65 + arg))
      .replace('{name}', name)
      .replace('{pct}', String(arg))
      .replace('{level}', String(arg));
    const row = document.createElement('div');
    row.className = `ann-row panel ${teamClass(team)}`;
    const rig = kind === ANNOUNCE.RIG_CAPTURED || kind === ANNOUNCE.RIG_LOST;
    if (rig) row.classList.add(kind === ANNOUNCE.RIG_LOST ? 'lost' : 'won');
    const ico = document.createElement('span');
    ico.className = 'ann-ico';
    ico.innerHTML = (rig ? rigIcon : kind === ANNOUNCE.CARRIER_REPAIRED ? repairIcon : damageIcon).replace(/ width="\d+" height="\d+"/, '');
    if (rig) {
      // The letter of the rig, as on the rig gauges.
      const chip = document.createElement('span');
      chip.className = 'ann-chip';
      chip.textContent = String.fromCharCode(65 + arg);
      ico.append(chip);
    }
    const label = document.createElement('span');
    label.textContent = text;
    row.append(ico, label);
    this.root.append(row);
    while (this.root.childElementCount > MAX_ROWS) this.root.firstElementChild?.remove();
    setTimeout(() => row.classList.add('fading'), LIFETIME_MS - 600);
    setTimeout(() => row.remove(), LIFETIME_MS);
  }
}
