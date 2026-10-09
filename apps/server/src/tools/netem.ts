import { WebSocket, WebSocketServer } from 'ws';
import type { RawData } from 'ws';

/**
 * Network emulator (GAME_DESIGN.md §14): a WebSocket proxy that makes a local game feel like a
 * bad connection. Point the game at the proxy with `?server=ws://localhost:9002`.
 *
 *   pnpm netem                               defaults: 75 ms each way (150 ms round trip), +/- 15 ms
 *   pnpm netem --latency 100 --jitter 30     one-way delay and jitter
 *   pnpm netem --stalls                      adds occasional 200-500 ms freezes (TCP packet loss)
 *   pnpm netem --port 9002 --target ws://127.0.0.1:9001
 *
 * Packets stay in order (like TCP): a delayed packet holds back the ones behind it.
 */
function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1]!.startsWith('--')
    ? process.argv[i + 1]!
    : fallback;
}
const port = Number(arg('port', '9002'));
const target = arg('target', 'ws://127.0.0.1:9001');
const latency = Number(arg('latency', '75'));
const jitter = Number(arg('jitter', '15'));
const stalls = process.argv.includes('--stalls');

/** One direction of one connection: delays messages but never reorders them. */
class Pipe {
  private lastDue = 0;
  private stallUntil = 0;

  constructor(private readonly sendOn: (data: RawData, binary: boolean) => void) {}

  stall(untilMs: number): void {
    this.stallUntil = Math.max(this.stallUntil, untilMs);
  }

  push(data: RawData, binary: boolean): void {
    const now = Date.now();
    const delay = latency + (Math.random() * 2 - 1) * jitter;
    const due = Math.max(this.lastDue, this.stallUntil, now + Math.max(0, delay));
    this.lastDue = due;
    setTimeout(() => this.sendOn(data, binary), Math.max(0, due - now));
  }
}

const wss = new WebSocketServer({ port });
console.log(
  `netem: :${port} -> ${target}  one-way ${latency} ms +/- ${jitter} ms${stalls ? ', stalls on' : ''}`,
);

wss.on('connection', (client, req) => {
  const upstream = new WebSocket(target, { origin: req.headers.origin ?? 'http://localhost:5173' });
  const up = new Pipe((data, binary) => {
    if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary });
  });
  const down = new Pipe((data, binary) => {
    if (client.readyState === WebSocket.OPEN) client.send(data, { binary });
  });
  const early: [RawData, boolean][] = [];
  upstream.on('open', () => {
    for (const [d, b] of early) up.push(d, b);
    early.length = 0;
  });
  client.on('message', (data, isBinary) => {
    if (upstream.readyState === WebSocket.OPEN) up.push(data, isBinary);
    else early.push([data, isBinary]);
  });
  upstream.on('message', (data, isBinary) => down.push(data, isBinary));
  client.on('close', () => upstream.close());
  upstream.on('close', () => client.close());
  client.on('error', () => upstream.terminate());
  upstream.on('error', () => client.terminate());

  if (stalls) {
    // A freeze of 200-500 ms every few seconds, in both directions at once.
    const timer = setInterval(
      () => {
        const until = Date.now() + 200 + Math.random() * 300;
        up.stall(until);
        down.stall(until);
      },
      3000 + Math.random() * 4000,
    );
    client.on('close', () => clearInterval(timer));
  }
});
