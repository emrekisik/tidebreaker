/**
 * What the room needs from a network connection. The room never touches `ws` directly, so tests
 * (and, later, other protocols) can plug in their own transport (CLAUDE.md: `Transport` interface).
 */
export interface Connection {
  /** Remote address, for the per-IP limit. */
  readonly ip: string;
  /** Bytes waiting to be sent (backpressure). */
  readonly bufferedAmount: number;
  /** Sends one binary message. Never throws. */
  send(data: Uint8Array): void;
  close(): void;
  /** Set by the room. */
  onMessage: (data: Uint8Array) => void;
  onClose: () => void;
}

export interface Transport {
  /** Called for every accepted connection. Set by the room before `start`. */
  onConnection: (conn: Connection) => void;
  start(): Promise<void>;
  stop(): Promise<void>;
}
