import { MATCH, MATCH_STATE } from '@tidebreaker/shared';
import type { Combatant } from '@tidebreaker/shared';
import { onLanguageChange, t } from '../i18n/index.ts';
import { teamName } from './teams.ts';

const el = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;

type BannerKind = '' | 'win' | 'lose' | 'death' | 'lost';

/**
 * Online-only HUD: both carriers' health at the top (the objective of the match), the team score,
 * and the big messages: the end of a round (victory or defeat, the score, the time to the next round), a sunk ship
 * (what sank it and the respawn countdown), connection lost.
 */
export class MatchHud {
  private readonly root = el('match');
  private readonly bar = {
    hullA: el('m-a-hull'),
    shieldA: el('m-a-shield'),
    hullB: el('m-b-hull'),
    shieldB: el('m-b-shield'),
  };
  private readonly kills = el('m-kills');
  private readonly banner = el('banner');
  private readonly tag = el('banner-tag');
  private readonly title = el('banner-title');
  private readonly sub = el('banner-sub');
  private readonly score = el('banner-score');
  private readonly countLabel = el('banner-count-label');
  private readonly countBar = el('banner-bar');
  private readonly countNum = el('banner-count-num');
  private deathLeft = 0;
  /** The respawn time of this death (the bar drains from it). */
  private deathTotal = 1;
  private deathBy = '';
  /** The ship wrecked itself on land (nobody sank it). */
  private crashed = false;
  private restartLeft = 0;
  private winner = 0;
  private myTeam = 0;
  private ended = false;
  private lost = false;
  private lastKills = '';
  private shown: BannerKind = '';
  private lastNum = '';

  constructor() {
    // The words of a banner that is on screen follow a new language.
    onLanguageChange(() => {
      if (this.shown !== '') this.fillText(this.shown);
    });
  }

  show(on: boolean): void {
    this.root.classList.toggle('hidden', !on);
  }

  /** The carriers' current state (undefined until they have been seen). */
  update(carriers: readonly (Combatant | undefined)[], killsA: number, killsB: number): void {
    const a = carriers[0];
    const b = carriers[1];
    if (a) this.fill(this.bar.hullA, this.bar.shieldA, a);
    if (b) this.fill(this.bar.hullB, this.bar.shieldB, b);
    const k = `${killsA} : ${killsB}`;
    if (k !== this.lastKills) {
      this.kills.textContent = k;
      this.score.textContent = k;
      this.lastKills = k;
    }
  }

  private fill(hull: HTMLElement, shield: HTMLElement, c: Combatant): void {
    hull.style.width = `${Math.max(0, 100 * (c.state.hull / c.def.hull))}%`;
    shield.style.width = `${Math.max(0, 100 * (c.state.shield / c.def.shield))}%`;
  }

  died(killerName: string, respawnSec: number, crashed = false): void {
    this.deathLeft = respawnSec;
    this.deathTotal = Math.max(1, respawnSec);
    this.deathBy = killerName;
    this.crashed = crashed;
    this.refresh();
  }

  respawned(): void {
    this.deathLeft = 0;
    this.refresh();
  }

  /** `myTeam`: the player's team (the end of the round is a victory or a defeat for them). */
  setMatch(state: number, winner: number, restartSec: number, myTeam: number): void {
    this.ended = state === MATCH_STATE.ENDED;
    this.winner = winner;
    this.restartLeft = restartSec;
    this.myTeam = myTeam;
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
    let kind: BannerKind = '';
    if (this.lost) kind = 'lost';
    else if (this.ended) kind = this.winner === this.myTeam ? 'win' : 'lose';
    else if (this.deathLeft > 0) kind = 'death';

    if (kind !== this.shown) {
      this.shown = kind;
      this.banner.classList.toggle('hidden', kind === '');
      this.banner.dataset['kind'] = kind;
      this.fillText(kind);
    }
    if (kind === 'death') this.count(this.deathLeft / this.deathTotal, this.deathLeft);
    else if (kind === 'win' || kind === 'lose') this.count(this.restartLeft / MATCH.intermissionSec, this.restartLeft);
  }

  /** The words of a banner (they change only when its kind does). */
  private fillText(kind: BannerKind): void {
    switch (kind) {
      case 'win':
      case 'lose':
        this.tag.textContent = t('banner.tag.round');
        this.title.textContent = t(kind === 'win' ? 'banner.win' : 'banner.lose');
        this.sub.textContent = t('banner.winSub').replace('{team}', teamName(this.winner));
        this.countLabel.textContent = t('banner.next');
        break;
      case 'death':
        this.tag.textContent = t('banner.tag.death');
        this.title.textContent = t(this.crashed ? 'death.crashed' : 'death.sunk');
        this.sub.textContent = this.deathBy ? t('death.by').replace('{name}', this.deathBy) : '';
        this.countLabel.textContent = t('banner.respawn');
        break;
      case 'lost':
        this.tag.textContent = t('banner.tag.net');
        this.title.textContent = t('net.lost');
        this.sub.textContent = '';
        this.countLabel.textContent = '';
        break;
      default:
        break;
    }
    this.lastNum = '';
  }

  /** The bar under the message and the seconds beside it. */
  private count(frac: number, left: number): void {
    this.countBar.style.transform = `scaleX(${Math.max(0, Math.min(1, frac)).toFixed(3)})`;
    const num = `${Math.max(0, Math.ceil(left))} ${t('banner.sec')}`;
    if (num !== this.lastNum) {
      this.lastNum = num;
      this.countNum.textContent = num;
    }
  }
}
