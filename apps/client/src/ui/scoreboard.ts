import { SHIP_IDS, TEAM_BLUE, TEAM_RED, compareRankOrder } from '@tidebreaker/shared';
import type { ScoreEntry } from '@tidebreaker/shared';
import { t } from '../i18n/index.ts';
import { rankBadge } from './rankBadge.ts';
import { RankBook } from './rankBook.ts';

/** Two-column scoreboard (blue, red): hold Tab, or it stays up between rounds. */
export class Scoreboard {
  private rows: ScoreEntry[] = [];
  private myId = 0;
  private held = false;
  private pinned = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly ranks: RankBook,
  ) {}

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
      this.cell(t('score.score'), 'sb-num'),
      this.cell(t('score.kills'), 'sb-num'),
      this.cell(t('score.deaths'), 'sb-num'),
    );
    col.append(head);
    const mine = this.rows
      .filter((r) => r.team === team)
      .sort(compareRankOrder);
    for (const r of mine) {
      const row = document.createElement('div');
      row.className = r.id === this.myId ? 'sb-row me' : 'sb-row';
      row.append(
        this.nameCell(r),
        this.cell(String(r.score), 'sb-num'),
        this.cell(String(r.kills), 'sb-num'),
        this.cell(String(r.deaths), 'sb-num'),
      );
      col.append(row);
    }
    return col;
  }

  /** The player's name with the icon of their ship class (a top-down view, bow to the right). */
  private nameCell(r: ScoreEntry): HTMLElement {
    const el = document.createElement('span');
    el.className = 'sb-name';
    const ship = SHIP_IDS[r.shipId] ?? SHIP_IDS[0]!;
    const icon = document.createElement('img');
    icon.className = 'sb-ship';
    icon.alt = `T${r.tier + 1}`;
    icon.title = `T${r.tier + 1}`;
    icon.src = `${import.meta.env.BASE_URL}icons/ships/side/${r.team === TEAM_BLUE ? 'blue' : 'red'}/${ship}.png`;
    const rank = this.ranks.of(r.id);
    // The name is its own element, so only it is shortened (and only when the row really is too narrow).
    const text = document.createElement('span');
    text.className = 'sb-text';
    text.textContent = r.name;
    text.title = r.name;
    el.append(rankBadge(rank, RankBook.title(rank)), icon, text);
    // The own row says so, so the player finds themselves at a glance.
    if (r.id === this.myId) {
      const you = document.createElement('span');
      you.className = 'sb-you';
      you.textContent = t('score.you');
      el.append(you);
    }
    return el;
  }

  private cell(text: string, cls: string): HTMLElement {
    const el = document.createElement('span');
    el.className = cls;
    el.textContent = text;
    return el;
  }
}
