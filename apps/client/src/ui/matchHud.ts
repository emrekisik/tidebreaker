import { MATCH_STATE, TEAM_BLUE } from '@tidebreaker/shared';
import type { Combatant } from '@tidebreaker/shared';
import { t } from '../i18n/index.ts';

const el = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;

/**
 * Online-only HUD: both carriers' health at the top (the objective of the match), the team score,
 * and the big messages: sunk (respawn countdown), round over, connection lost.
 */
export class MatchHud {
  private readonly root = el('match');
  private readonly bar = {
    blueHull: el('m-blue-hull'),
    blueShield: el('m-blue-shield'),
    redHull: el('m-red-hull'),
    redShield: el('m-red-shield'),
  };
  private readonly kills = el('m-kills');
  private readonly banner = el('banner');
  private readonly title = el('banner-title');
  private readonly sub = el('banner-sub');
  private deathLeft = 0;
  private deathBy = '';
  private restartLeft = 0;
  private winner = 0;
  private ended = false;
  private lost = false;
  private lastKills = '';

  show(on: boolean): void {
    this.root.classList.toggle('hidden', !on);
  }

  /** The carriers' current state (undefined until they have been seen). */
  update(carriers: readonly (Combatant | undefined)[], killsBlue: number, killsRed: number): void {
    const blue = carriers[0];
    const red = carriers[1];
    if (blue) this.fill(this.bar.blueHull, this.bar.blueShield, blue);
    if (red) this.fill(this.bar.redHull, this.bar.redShield, red);
    const k = `${killsBlue} : ${killsRed}`;
    if (k !== this.lastKills) {
      this.kills.textContent = k;
      this.lastKills = k;
    }
  }

  private fill(hull: HTMLElement, shield: HTMLElement, c: Combatant): void {
    hull.style.width = `${Math.max(0, 100 * (c.state.hull / c.def.hull))}%`;
    shield.style.width = `${Math.max(0, 100 * (c.state.shield / c.def.shield))}%`;
  }

  died(killerName: string, respawnSec: number): void {
    this.deathLeft = respawnSec;
    this.deathBy = killerName;
    this.refresh();
  }

  respawned(): void {
    this.deathLeft = 0;
    this.refresh();
  }

  setMatch(state: number, winner: number, restartSec: number): void {
    this.ended = state === MATCH_STATE.ENDED;
    this.winner = winner;
    this.restartLeft = restartSec;
    this.refresh();
  }

  connectionLost(): void {
    this.lost = true;
    this.refresh();
  }

  /** Counts the respawn timer down smoothly between messages. */
  frame(dtSec: number): void {
    if (this.deathLeft > 0) {
      this.deathLeft = Math.max(0, this.deathLeft - dtSec);
      this.refresh();
    }
  }

  private refresh(): void {
    let title = '';
    let sub = '';
    if (this.lost) {
      title = t('net.lost');
    } else if (this.ended) {
      title = t('match.win').replace(
        '{team}',
        this.winner === TEAM_BLUE ? t('match.blue') : t('match.red'),
      );
      sub = t('match.next').replace('{n}', String(Math.max(0, Math.ceil(this.restartLeft))));
    } else if (this.deathLeft > 0) {
      title = t('death.sunk');
      sub = [
        this.deathBy ? t('death.by').replace('{name}', this.deathBy) : '',
        t('death.respawn').replace('{n}', String(Math.ceil(this.deathLeft))),
      ]
        .filter((x) => x)
        .join(' · ');
    }
    this.banner.classList.toggle('hidden', title === '');
    this.title.textContent = title;
    this.sub.textContent = sub;
  }
}
