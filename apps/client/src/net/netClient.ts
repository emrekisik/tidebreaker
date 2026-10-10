import {
  Writer,
  decodeServer,
  encodeHello,
  encodeInput,
  encodePing,
  encodePlay,
  encodeTierUp,
  encodeUpgrade,
} from '@tidebreaker/shared';
import type { ServerHandler } from '@tidebreaker/shared';

/** Connection events the game cares about besides the protocol messages. */
export interface NetHooks {
  open(): void;
  /** The socket closed or failed; `reason` is for the player ("could not connect", ...). */
  close(reason: 'failed' | 'closed'): void;
}

/** Counters shown in the debug HUD. */
export interface NetStats {
  /** Bytes received / sent in the last full second. */
  rxBytesPerSec: number;
  txBytesPerSec: number;
  /** Snapshots per second. */
  snapshotsPerSec: number;
  bad: number;
}

/**
 * A WebSocket speaking the binary protocol (GAME_DESIGN.md §10.2). Messages are decoded straight
 * into the handler; anything malformed is counted and dropped.
 */
export class NetClient {
  private readonly ws: WebSocket;
  private readonly out = new Writer(64);
  readonly stats: NetStats = { rxBytesPerSec: 0, txBytesPerSec: 0, snapshotsPerSec: 0, bad: 0 };
  private rx = 0;
  private tx = 0;
  private snaps = 0;
  private windowStart = performance.now();
  private open = false;

  constructor(url: string, handler: ServerHandler, hooks: NetHooks) {
    this.ws = new WebSocket(url);
    this.ws.binaryType = 'arraybuffer';
    this.ws.addEventListener('open', () => {
      this.open = true;
      hooks.open();
    });
    this.ws.addEventListener('close', () => hooks.close(this.open ? 'closed' : 'failed'));
    this.ws.addEventListener('message', (ev: MessageEvent<ArrayBuffer>) => {
      if (!(ev.data instanceof ArrayBuffer)) return;
      const bytes = new Uint8Array(ev.data);
      this.rx += bytes.length;
      if (bytes[0] === 0x82) this.snaps++;
      if (!decodeServer(bytes, handler)) this.stats.bad++;
    });
  }

  private flush(): void {
    if (this.ws.readyState !== WebSocket.OPEN) {
      this.out.reset();
      return;
    }
    this.tx += this.out.pos;
    this.ws.send(this.out.buf.slice(0, this.out.pos) as Uint8Array<ArrayBuffer>);
    this.out.reset();
  }

  hello(): void {
    encodeHello(this.out);
    this.flush();
  }

  play(name: string, shipId: number): void {
    encodePlay(this.out, name, shipId);
    this.flush();
  }

  upgrade(stat: number): void {
    encodeUpgrade(this.out, stat);
    this.flush();
  }

  tierUp(): void {
    encodeTierUp(this.out, 0);
    this.flush();
  }

  ping(clientTimeMs: number): void {
    encodePing(this.out, clientTimeMs >>> 0);
    this.flush();
  }

  input(
    seq: number,
    fire: boolean,
    moveX: number,
    moveY: number,
    aim16: number,
    aimDist: number,
  ): void {
    encodeInput(this.out, seq, fire, moveX, moveY, aim16, aimDist);
    this.flush();
  }

  close(): void {
    this.ws.close();
  }

  /** Call every frame: rolls the per-second counters. */
  tick(nowMs: number): void {
    const dt = nowMs - this.windowStart;
    if (dt < 1000) return;
    const k = 1000 / dt;
    this.stats.rxBytesPerSec = this.rx * k;
    this.stats.txBytesPerSec = this.tx * k;
    this.stats.snapshotsPerSec = this.snaps * k;
    this.rx = 0;
    this.tx = 0;
    this.snaps = 0;
    this.windowStart = nowMs;
  }
}
