import type { Connection, Transport } from './transport.ts';

/** The client end of an in-memory connection (used by tests and tools). */
export class MemoryClient {
  /** Messages received from the server, oldest first. */
  readonly received: Uint8Array[] = [];
  onMessage: ((data: Uint8Array) => void) | null = null;
  closed = false;
  server: MemoryConnection | null = null;

  send(data: Uint8Array): void {
    if (this.closed || !this.server) return;
    // Copy: the server must never see later changes to the sender's buffer.
    const copy = data.slice();
    queueMicrotask(() => this.server?.onMessage(copy));
  }

  close(): void {
    if (this.closed) return;
    const s = this.server;
    // Queued behind anything still in flight, so the server sees every message first.
    queueMicrotask(() => {
      this.closed = true;
      s?.onClose();
    });
  }

  deliver(data: Uint8Array): void {
    if (this.closed) return;
    this.received.push(data);
    this.onMessage?.(data);
  }
}

class MemoryConnection implements Connection {
  readonly ip: string;
  bufferedAmount = 0;
  onMessage: (data: Uint8Array) => void = () => {};
  onClose: () => void = () => {};
  private readonly peer: MemoryClient;
  private closed = false;

  constructor(ip: string, peer: MemoryClient) {
    this.ip = ip;
    this.peer = peer;
  }

  send(data: Uint8Array): void {
    if (this.closed) return;
    const copy = data.slice();
    queueMicrotask(() => this.peer.deliver(copy));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    // Queued behind pending sends, so the peer still receives the last messages (e.g. REJECT).
    queueMicrotask(() => {
      this.peer.closed = true;
      this.onClose();
    });
  }
}

/** A transport without a network: `connect()` creates a client and hands its server end to the room. */
export class MemoryTransport implements Transport {
  onConnection: (conn: Connection) => void = () => {};

  async start(): Promise<void> {}

  async stop(): Promise<void> {}

  connect(ip = '127.0.0.1'): MemoryClient {
    const client = new MemoryClient();
    const conn = new MemoryConnection(ip, client);
    client.server = conn;
    this.onConnection(conn);
    return client;
  }
}
