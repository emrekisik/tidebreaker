import { createServer } from 'node:http';
import type { IncomingMessage, Server } from 'node:http';
import { WebSocketServer } from 'ws';
import type { RawData, WebSocket } from 'ws';
import type { Connection, Transport } from './transport.ts';

export interface WsOptions {
  port: number;
  /** Allowed `Origin` headers. Connections without an Origin (tools, tests) are allowed unless `requireOrigin`. */
  allowedOrigins: readonly string[];
  requireOrigin: boolean;
  maxConnectionsPerIp: number;
  /** JSON for GET /status (called per request). */
  status: () => unknown;
}

/** One WebSocket as a `Connection`. */
class WsConnection implements Connection {
  readonly ip: string;
  onMessage: (data: Uint8Array) => void = () => {};
  onClose: () => void = () => {};
  private readonly ws: WebSocket;

  constructor(ws: WebSocket, ip: string) {
    this.ws = ws;
    this.ip = ip;
    ws.binaryType = 'nodebuffer';
    ws.on('message', (data: RawData, isBinary: boolean) => {
      // Text frames are not part of the protocol.
      if (!isBinary || !(data instanceof Buffer)) return;
      this.onMessage(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    });
    ws.on('close', () => this.onClose());
    ws.on('error', () => this.ws.terminate());
  }

  get bufferedAmount(): number {
    return this.ws.bufferedAmount;
  }

  send(data: Uint8Array): void {
    if (this.ws.readyState !== this.ws.OPEN) return;
    this.ws.send(data, { binary: true }, () => {});
  }

  close(): void {
    this.ws.close();
  }
}

/**
 * WebSocket transport on top of Node's HTTP server (which also serves GET /status). Security
 * defaults from CLAUDE.md: `perMessageDeflate` off, tiny `maxPayload`, Origin allow-list, per-IP
 * connection cap.
 */
export class WsTransport implements Transport {
  onConnection: (conn: Connection) => void = () => {};
  private readonly options: WsOptions;
  private http: Server | null = null;
  private wss: WebSocketServer | null = null;
  private readonly perIp = new Map<string, number>();

  constructor(options: WsOptions) {
    this.options = options;
  }

  /** The port actually listening (useful when 0 was requested). */
  get port(): number {
    const a = this.http?.address();
    return a && typeof a === 'object' ? a.port : this.options.port;
  }

  start(): Promise<void> {
    const o = this.options;
    this.http = createServer((req, res) => {
      if (req.url === '/status') {
        res.writeHead(200, {
          'content-type': 'application/json',
          'access-control-allow-origin': '*',
        });
        res.end(JSON.stringify(o.status()));
        return;
      }
      res.writeHead(404).end();
    });
    this.wss = new WebSocketServer({
      server: this.http,
      perMessageDeflate: false,
      maxPayload: 256,
      verifyClient: (info: { origin: string; req: IncomingMessage }) => this.verify(info),
    });
    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      const ip = req.socket.remoteAddress ?? 'unknown';
      this.perIp.set(ip, (this.perIp.get(ip) ?? 0) + 1);
      ws.on('close', () => {
        const n = (this.perIp.get(ip) ?? 1) - 1;
        if (n <= 0) this.perIp.delete(ip);
        else this.perIp.set(ip, n);
      });
      req.socket.setNoDelay(true);
      this.onConnection(new WsConnection(ws, ip));
    });
    return new Promise((resolve) => {
      this.http!.listen(o.port, () => resolve());
    });
  }

  private verify(info: { origin: string; req: IncomingMessage }): boolean {
    const o = this.options;
    const origin = info.origin;
    if (!origin) {
      if (o.requireOrigin) return false;
    } else if (!o.allowedOrigins.includes(origin)) {
      return false;
    }
    const ip = info.req.socket.remoteAddress ?? 'unknown';
    return (this.perIp.get(ip) ?? 0) < o.maxConnectionsPerIp;
  }

  async stop(): Promise<void> {
    for (const client of this.wss?.clients ?? []) client.terminate();
    await new Promise<void>((resolve) => {
      if (!this.wss) return resolve();
      this.wss.close(() => resolve());
    });
    await new Promise<void>((resolve) => {
      if (!this.http) return resolve();
      this.http.close(() => resolve());
    });
  }
}
