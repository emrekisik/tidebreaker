import { onLanguageChange, t } from '../i18n/index.ts';

const ICONS = {
  ping: '<svg viewBox="0 0 14 12" aria-hidden="true"><path d="M1.5 11V8.5M5.5 11V6M9.5 11V3.5M13 11V1"/></svg>',
  fps: '<svg viewBox="0 0 14 12" aria-hidden="true"><path d="M1.5 10.5a5.5 5.5 0 1 1 11 0"/><path d="M7 10.5 9.8 5.5"/></svg>',
  players:
    '<svg viewBox="0 0 14 12" aria-hidden="true"><circle cx="7" cy="3.6" r="2.2"/><path d="M2.4 11c0-2.6 2-4 4.6-4s4.6 1.4 4.6 4"/></svg>',
  server:
    '<svg viewBox="0 0 14 12" aria-hidden="true"><rect x="1.5" y="1.5" width="11" height="3.6"/><rect x="1.5" y="6.9" width="11" height="3.6"/><path d="M4 3.3h.01M4 8.7h.01"/></svg>',
} as const;

/**
 * A small strip under the radar: the ping to the server, the frame rate, how many players are in the room and which
 * server it is. Each has a small picture; the ping turns amber and red as it gets worse. The page is only touched
 * a couple of times a second.
 */
export class NetStatus {
  private readonly ping = this.item('ping');
  private readonly fps = this.item('fps');
  private readonly players = this.item('players');
  private readonly server = this.item('server');
  private frameMsEma = 16.7;
  private lastMs = 0;

  constructor(
    private readonly root: HTMLElement,
    /** The server's address (null: there is none, offline practice). */
    private readonly serverName: string | null,
  ) {
    const top = document.createElement('div');
    top.className = 'ns-row';
    top.append(this.ping.el, this.fps.el, this.players.el);
    this.server.el.classList.add('wide');
    this.root.append(top, this.server.el);
    this.words();
    onLanguageChange(() => this.words());
  }

  /** The words: the name of the server (or "offline") and the tooltips. */
  private words(): void {
    const name = this.serverName ?? t('net.offline');
    this.server.text.textContent = name;
    this.server.el.title = `${t('net.server')}: ${name}`;
    this.ping.el.title = t('net.ping');
    this.fps.el.title = t('net.fps');
    this.players.el.title = t('net.players');
  }

  private item(kind: keyof typeof ICONS): { el: HTMLElement; text: HTMLElement } {
    const el = document.createElement('span');
    el.className = `ns-item ${kind}`;
    const icon = document.createElement('i');
    icon.innerHTML = ICONS[kind];
    const text = document.createElement('b');
    text.textContent = '–';
    el.append(icon, text);
    return { el, text };
  }

  /** Called every frame (`frameMs`: how long the last frame took). */
  frame(frameMs: number): void {
    this.frameMsEma += (Math.min(frameMs, 250) - this.frameMsEma) * 0.05;
  }

  /** Twice a second at most. `rtt`: round-trip time in ms (null when there is no server); `count`/`max`: players. */
  update(nowMs: number, rtt: number | null, count: number, max: number): void {
    if (nowMs - this.lastMs < 500) return;
    this.lastMs = nowMs;
    this.fps.text.textContent = String(Math.round(1000 / Math.max(1, this.frameMsEma)));
    this.players.text.textContent = count > 0 ? `${count}/${max}` : '–';
    if (rtt === null || rtt <= 0) {
      this.ping.text.textContent = '–';
      this.ping.el.dataset['q'] = '';
    } else {
      this.ping.text.textContent = `${Math.round(rtt)} ms`;
      this.ping.el.dataset['q'] = rtt < 70 ? 'good' : rtt < 140 ? 'fair' : 'poor';
    }
  }
}
