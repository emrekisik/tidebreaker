import { describe, expect, it } from 'vitest';
import {
  Mulberry32,
  SHIPS,
  STEP_SEC,
  WORLD_CENTER,
  applyWorldBounds,
  collideIslands,
  createShipState,
  generateMap,
  newSelfState,
  stepShip,
} from '@tidebreaker/shared';
import { ServerClock } from './clock.ts';
import { EXTRAPOLATE_MAX_MS, SnapshotBuffer } from './interpolation.ts';
import type { PoseSample } from './interpolation.ts';
import { IGNORE_ERROR, Predictor, SNAP_ERROR, seqDiff } from './prediction.ts';

const pose = (): PoseSample => ({ x: 0, y: 0, heading: 0, speed: 0, hp: 1, shield: 1 });

describe('ServerClock', () => {
  it('locks on to the least-delayed packets, ignoring jitter', () => {
    const clock = new ServerClock();
    const rng = new Mulberry32(5);
    // True offset: server time = client time + 5000. Packets arrive 20-120 ms late.
    for (let i = 0; i < 100; i++) {
      const serverMs = i * 100;
      const delay = 20 + rng.next() * 100;
      clock.onServerTime(serverMs, serverMs - 5000 + delay);
    }
    // The estimate is off by roughly the minimum delay (20 ms), not by the average (70 ms).
    const err = clock.serverNow(10000 - 5000) - 10000;
    expect(Math.abs(err)).toBeLessThan(35);
  });

  it('never jumps by more than a hair per sample once running', () => {
    const clock = new ServerClock();
    clock.onServerTime(1000, 0);
    const before = clock.serverNow(500);
    clock.onServerTime(1100, 100); // the same offset again
    clock.onServerTime(1200, 200);
    expect(Math.abs(clock.serverNow(500) - before)).toBeLessThan(1.1);
  });

  it('smooths round-trip time', () => {
    const clock = new ServerClock();
    clock.onPong(0, 100);
    clock.onPong(0, 200);
    expect(clock.rtt).toBeGreaterThan(100);
    expect(clock.rtt).toBeLessThan(200);
  });
});

describe('SnapshotBuffer', () => {
  it('interpolates between samples and wraps heading the short way', () => {
    const b = new SnapshotBuffer();
    b.push(0, 0, 0, 3.0, 5, 1, 1);
    b.push(100, 10, 20, -3.0, 5, 0.5, 1);
    const out = pose();
    expect(b.sample(50, out)).toBe(true);
    expect(out.x).toBeCloseTo(5);
    expect(out.y).toBeCloseTo(10);
    expect(out.hp).toBeCloseTo(0.75);
    // 3.0 -> -3.0 crosses +/-PI: halfway is about PI, not 0.
    expect(Math.abs(Math.abs(out.heading) - Math.PI)).toBeLessThan(0.2);
  });

  it('holds the first sample before the data and extrapolates a little after it', () => {
    const b = new SnapshotBuffer();
    b.push(1000, 10, 10, 0, 10, 1, 1);
    b.push(1100, 11, 10, 0, 10, 1, 1);
    const out = pose();
    b.sample(500, out);
    expect(out.x).toBe(10);
    b.sample(1150, out);
    expect(out.x).toBeCloseTo(11 + 10 * 0.05);
    b.sample(1100 + EXTRAPOLATE_MAX_MS + 5000, out);
    expect(out.x).toBeCloseTo(11 + 10 * (EXTRAPOLATE_MAX_MS / 1000));
  });

  it('drops out-of-order samples and keeps only the newest 32', () => {
    const b = new SnapshotBuffer();
    for (let i = 0; i < 100; i++) b.push(i * 100, i, 0, 0, 0, 1, 1);
    b.push(50, 999, 0, 0, 0, 1, 1);
    expect(b.count).toBe(32);
    const out = pose();
    b.sample(9900 - 150, out);
    expect(out.x).toBeCloseTo(97.5, 0);
  });
});

describe('seqDiff', () => {
  it('works across the 16-bit wrap', () => {
    expect(seqDiff(5, 3)).toBe(2);
    expect(seqDiff(3, 5)).toBe(-2);
    expect(seqDiff(2, 65534)).toBe(4);
    expect(seqDiff(65534, 2)).toBe(-4);
  });
});

/** A server that applies the same inputs with network delay and jitter, and sends snapshots. */
function runSession(options: {
  ticks: number;
  latencyTicks: number;
  jitter: number;
  seed: number;
  steer: (i: number) => number;
}): { predictor: Predictor; maxVisibleJump: number; finalDiff: number; snapRate: number } {
  const def = SHIPS.coast_guard_boat;
  const map = generateMap(1337);
  const rng = new Mulberry32(options.seed);
  const predictor = new Predictor(def, map, 1);
  const server = createShipState(def, WORLD_CENTER - 100, WORLD_CENTER, 0);
  predictor.reset(server.x, server.y, server.heading);
  predictor.state.x = server.x;
  predictor.state.y = server.y;

  interface Packet {
    due: number;
    seq: number;
    steer: number;
    throttle: number;
  }
  const toServer: Packet[] = [];
  const toClient: { due: number; self: ReturnType<typeof newSelfState>; seq: number }[] = [];
  let lastSeq = 0;
  let lastUp = 0;
  let lastDown = 0;
  let seq = 0;
  let maxJump = 0;
  let prevShownX = predictor.state.x;
  let prevShownY = predictor.state.y;
  let snaps = 0;

  for (let tick = 0; tick < options.ticks; tick++) {
    // Client: one input per tick, applied locally and sent.
    seq = (seq + 1) & 0xffff;
    const steer = options.steer(tick);
    predictor.apply(seq, steer, 1);
    // TCP keeps order: a delayed packet holds back the ones behind it.
    lastUp = Math.max(
      lastUp,
      tick + options.latencyTicks + Math.floor(rng.next() * (options.jitter + 1)),
    );
    toServer.push({
      due: lastUp,
      seq,
      steer,
      throttle: 1,
    });

    // Server: takes due inputs in order, at most two per tick, one step each; never an invented step.
    const due = toServer.filter((p) => p.due <= tick).sort((a, b) => a.seq - b.seq);
    for (const next of due.slice(0, 2)) {
      toServer.splice(toServer.indexOf(next), 1);
      lastSeq = next.seq;
      stepShip(
        server,
        next.steer,
        next.throttle,
        def.vMax,
        (def.turnRateDeg * Math.PI) / 180,
        STEP_SEC,
      );
      collideIslands(map, server, def, 1, { onIslandHit() {} });
      applyWorldBounds(server, STEP_SEC);
    }
    if (tick % 2 === 0) {
      const self = newSelfState();
      Object.assign(self, {
        x: server.x,
        y: server.y,
        heading: server.heading,
        speed: server.speed,
        kx: server.kx,
        ky: server.ky,
        spin: server.spin,
        hull: server.hull,
        shield: server.shield,
      });
      lastDown = Math.max(
        lastDown,
        tick + options.latencyTicks + Math.floor(rng.next() * (options.jitter + 1)),
      );
      toClient.push({
        due: lastDown,
        self,
        seq: lastSeq,
      });
    }
    // Client: snapshots that arrived (they can arrive out of order only if jitter is huge).
    for (const s of toClient.filter((p) => p.due <= tick)) {
      toClient.splice(toClient.indexOf(s), 1);
      predictor.reconcile(s.self, s.seq);
      snaps++;
    }
    predictor.frame(STEP_SEC);
    // What is drawn: predicted state plus the smoothing offset. It must never jump by much.
    const shownX = predictor.state.x + predictor.offsetX;
    const shownY = predictor.state.y + predictor.offsetY;
    maxJump = Math.max(
      maxJump,
      Math.hypot(shownX - prevShownX, shownY - prevShownY) - def.vMax * STEP_SEC,
    );
    prevShownX = shownX;
    prevShownY = shownY;
  }
  return {
    predictor,
    maxVisibleJump: maxJump,
    finalDiff: Math.hypot(predictor.state.x - server.x, predictor.state.y - server.y),
    snapRate: snaps / options.ticks,
  };
}

describe('Predictor', () => {
  it('with a perfect link the prediction equals the server and corrections are zero', () => {
    const r = runSession({
      ticks: 200,
      latencyTicks: 2,
      jitter: 0,
      seed: 1,
      steer: (i) => (i % 50 < 25 ? 0.3 : -0.3),
    });
    expect(r.predictor.peakError).toBeLessThan(IGNORE_ERROR);
  });

  it('with jitter (150 ms and stalls) it stays smooth and does not drift away', () => {
    const r = runSession({
      ticks: 600,
      latencyTicks: 3,
      jitter: 3,
      seed: 9,
      steer: (i) => Math.sin(i / 17),
    });
    // Corrections are small blends, never a visible jump.
    expect(r.maxVisibleJump).toBeLessThan(0.6);
    // Server and client end up within the correction band of each other.
    expect(r.finalDiff).toBeLessThan(SNAP_ERROR);
  });

  it('teleports when the error is huge (e.g. after a respawn) and keeps no offset', () => {
    const map = generateMap(1337);
    const p = new Predictor(SHIPS.coast_guard_boat, map, 1);
    p.reset(100, 100, 0);
    p.apply(1, 0, 1);
    const far = newSelfState();
    far.x = 300;
    far.y = 300;
    p.reconcile(far, 1);
    expect(p.state.x).toBeCloseTo(300, 0);
    expect(p.offsetX).toBe(0);
  });

  it('a sunk ship follows the server and ignores inputs', () => {
    const map = generateMap(1337);
    const p = new Predictor(SHIPS.coast_guard_boat, map, 1);
    p.reset(100, 100, 0);
    p.enabled = false;
    p.apply(1, 1, 1);
    expect(p.state.x).toBe(100);
    const s = newSelfState();
    s.x = 120;
    s.y = 100;
    p.reconcile(s, 1);
    expect(p.state.x).toBe(120);
  });

  it('applies the same island collisions as the server code', () => {
    const map = generateMap(1337);
    const p = new Predictor(SHIPS.coast_guard_boat, map, 1);
    // Right next to island 0, driving straight into it.
    p.reset(map.islandX[0]! - map.islandR[0]! - 10, map.islandY[0]!, 0);
    for (let i = 1; i <= 150; i++) p.apply(i, 0, 1);
    expect(Math.hypot(p.state.x - map.islandX[0]!, p.state.y - map.islandY[0]!)).toBeGreaterThan(5);
  });
});
