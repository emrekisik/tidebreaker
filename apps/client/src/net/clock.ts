const WINDOW = 40;

/**
 * Estimates the server's clock (GAME_DESIGN.md §10.5). Every snapshot says "this was the world at
 * server time T" and arrives at client time R; `T - R` is largest for the packet with the least
 * delay, so the best offset is the maximum of the recent samples. It is then slewed slowly toward
 * that value, so the estimate never jumps (a jump would make everything on screen stutter).
 */
export class ServerClock {
  private readonly samples = new Float64Array(WINDOW);
  private count = 0;
  private next = 0;
  private offset = 0;
  private ready = false;
  /** Round-trip time in ms (smoothed), from PING/PONG. */
  rtt = 0;

  /** A snapshot or any timestamped message arrived: its server time and our receive time. */
  onServerTime(serverMs: number, clientRecvMs: number): void {
    this.samples[this.next] = serverMs - clientRecvMs;
    this.next = (this.next + 1) % WINDOW;
    if (this.count < WINDOW) this.count++;
    let best = -Infinity;
    for (let i = 0; i < this.count; i++) best = Math.max(best, this.samples[i]!);
    if (!this.ready || Math.abs(best - this.offset) > 250) {
      this.offset = best;
      this.ready = true;
    } else {
      // Quick at the start (the first samples are noisy), then at most 0.5 ms per sample:
      // about 5 ms/s, far more than real clock drift.
      const limit = this.count < WINDOW ? 4 : 0.5;
      const d = best - this.offset;
      this.offset += d > limit ? limit : d < -limit ? -limit : d;
    }
  }

  onPong(clientSentMs: number, clientRecvMs: number): void {
    const rtt = clientRecvMs - clientSentMs;
    if (rtt < 0 || rtt > 10000) return;
    this.rtt = this.rtt === 0 ? rtt : this.rtt + (rtt - this.rtt) * 0.2;
  }

  get isReady(): boolean {
    return this.ready;
  }

  /** The server's time (ms) at client time `clientMs`. */
  serverNow(clientMs: number): number {
    return clientMs + this.offset;
  }
}
