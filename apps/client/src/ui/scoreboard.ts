import { TEAM_BLUE, TEAM_RED } from '@tidebreaker/shared';
import type { ScoreEntry } from '@tidebreaker/shared';
import { t } from '../i18n/index.ts';

/** Two-column scoreboard (blue, red): hold Tab, or it stays up between rounds. */
export class Scoreboard {
  private rows: ScoreEntry[] = [];
  private myId = 0;
  private held = false;
  private pinned = false;

  constructor(private readonly root: HTMLElement) {}

  /** The server's latest scores. */
  update(rows: ScoreEntry[], myId: number): void {
    this.rows = rows;
    this.myId = myId;
    this.render();
  }

  /** Tab pressed or released. */
  hold(on: boolean): void {
    this.held = on;
    this.refresh();
  }

  /** Stays visible while true (the break between two rounds). */
  pin(on: boolean): void {
    this.pinned = on;
    this.refresh();
  }

  private refresh(): void {
    this.root.classList.toggle('hidden', !(this.held || this.pinned));
  }

  private render(): void {
    const columns = [TEAM_BLUE, TEAM_RED].map((team) => this.column(team));
    this.root.replaceChildren(...columns);
  }

  private column(team: number): HTMLElement {
    const col = document.createElement('div');
    col.className = team === TEAM_BLUE ? 'sb-col blue' : 'sb-col red';
    const head = document.createElement('div');
    head.className = 'sb-row sb-head';
    head.append(
      this.cell(team === TEAM_BLUE ? t('match.blue') : t('match.red'), 'sb-name'),
      this.cell(t('score.kills'), 'sb-num'),
      this.cell(t('score.deaths'), 'sb-num'),
    );
    col.append(head);
    const mine = this.rows
      .filter((r) => r.team === team)
      .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    for (const r of mine) {
      const row = document.createElement('div');
      row.className = r.id === this.myId ? 'sb-row me' : 'sb-row';
      row.append(
        this.cell(r.name, 'sb-name'),
        this.cell(String(r.kills), 'sb-num'),
        this.cell(String(r.deaths), 'sb-num'),
      );
      col.append(row);
    }
    return col;
  }

  private cell(text: string, cls: string): HTMLElement {
    const el = document.createElement('span');
    el.className = cls;
    el.textContent = text;
    return el;
  }
}
