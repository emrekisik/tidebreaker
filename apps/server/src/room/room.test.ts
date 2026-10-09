import { describe, expect, it } from 'vitest';
import {
  CARRIER,
  MATCH,
  MATCH_STATE,
  PROTOCOL_VERSION,
  REJECT_REASON,
  SHIPS,
  SHIP_IDS,
  STEP_SEC,
  TEAM_BLUE,
  TEAM_RED,
  TICK_RATE,
  applyWorldBounds,
  collideIslands,
  configHash,
  createShipState,
  dqAngle16,
  dqAxis,
  qAngle16,
  qAxis,
  stepShip,
} from '@tidebreaker/shared';
import { MemoryTransport } from '../net/memTransport.ts';
import { TestClient, settle } from '../testing.ts';
import { Room } from './room.ts';

const SEED = 1337;
const idx = (id: keyof typeof SHIPS): number => SHIP_IDS.indexOf(id);

/** A room driven by hand: every `tick()` advances the clock by exactly one step. */
function setup(): {
  room: Room;
  transport: MemoryTransport;
  tick: (n?: number) => Promise<void>;
  join: (name: string, ship?: keyof typeof SHIPS, ip?: string) => Promise<TestClient>;
} {
  const transport = new MemoryTransport();
  let now = 1000;
  const room = new Room({ transport, seed: SEED, clock: () => now });
  const tick = async (n = 1): Promise<void> => {
    for (let i = 0; i < n; i++) {
      now += STEP_SEC * 1000;
      room.tick();
      await settle();
    }
  };
  const join = async (
    name: string,
    ship: keyof typeof SHIPS = 'coast_guard_boat',
    ip = '10.0.0.1',
  ): Promise<TestClient> => {
    const c = new TestClient(transport.connect(ip));
    c.hello();
    c.play(name, idx(ship));
    await settle();
    return c;
  };
  return { room, transport, tick, join };
}

/** Puts a player's ship somewhere and clears its spawn protection. */
function place(room: Room, c: TestClient, x: number, y: number, heading: number): void {
  const slot = c.heard.joined[c.heard.joined.length - 1]!.entityId - 1;
  const s = room.world.slots[slot]!.state;
  s.x = x;
  s.y = y;
  s.heading = heading;
  s.speed = 0;
  room.world.protectLeft[slot] = 0;
}

describe('handshake', () => {
  it('answers HELLO with WELCOME (seed, tick rate, config hash)', async () => {
    const { transport } = setup();
    const c = new TestClient(transport.connect());
    c.hello();
    await settle();
    expect(c.heard.welcome).toHaveLength(1);
    expect(c.heard.welcome[0]).toMatchObject({
      mapSeed: SEED,
      tickRate: TICK_RATE,
      configHash: configHash(),
    });
  });

  it('refuses a different protocol version', async () => {
    const { transport } = setup();
    const c = new TestClient(transport.connect());
    c.hello(PROTOCOL_VERSION + 1);
    await settle();
    expect(c.heard.rejects).toEqual([REJECT_REASON.VERSION]);
    expect(c.conn.closed).toBe(true);
  });

  it('PLAY before HELLO is ignored, a bad name is rejected without closing', async () => {
    const { transport } = setup();
    const c = new TestClient(transport.connect());
    c.play('Early');
    await settle();
    expect(c.heard.joined).toHaveLength(0);
    c.hello();
    c.play('Admin');
    await settle();
    expect(c.heard.rejects).toEqual([REJECT_REASON.BAD_NAME]);
    expect(c.conn.closed).toBe(false);
    c.play('Captain Rex');
    await settle();
    expect(c.heard.joined).toHaveLength(1);
  });

  it('balances teams: blue, red, blue ...', async () => {
    const { join } = setup();
    const a = await join('A');
    const b = await join('B');
    const c = await join('C');
    expect(a.heard.joined[0]!.team).toBe(TEAM_BLUE);
    expect(b.heard.joined[0]!.team).toBe(TEAM_RED);
    expect(c.heard.joined[0]!.team).toBe(TEAM_BLUE);
  });

  it('answers PING with PONG', async () => {
    const { join } = setup();
    const a = await join('A');
    a.ping(1234);
    await settle();
    expect(a.heard.pongs[0]!.clientTime).toBe(1234);
  });

  it('refuses the player after the room is full', async () => {
    const { join, room } = setup();
    for (let i = 0; i < MATCH.maxPlayers; i++)
      await join(`P${i}`, 'coast_guard_boat', `10.0.0.${i}`);
    expect(room.world.playerCount()).toBe(MATCH.maxPlayers);
    const late = await join('Late', 'coast_guard_boat', '10.0.1.1');
    expect(late.heard.rejects).toContain(REJECT_REASON.ROOM_FULL);
    expect(room.world.playerCount()).toBe(MATCH.maxPlayers);
  });
});

describe('snapshots and prediction', () => {
  it('each client sees the others, and the carriers, as ENTER first and UPDATE after', async () => {
    const { join, tick } = setup();
    const a = await join('A');
    const b = await join('B');
    await tick(4);
    // A hears about both carriers and B.
    const ids = a.heard.enters.map((e) => e.id).sort();
    expect(ids).toEqual([1, 2, b.heard.joined[0]!.entityId]);
    expect(a.heard.enters.find((e) => e.id === 1)!.kind).toBe(10);
    expect(a.heard.updates.length).toBeGreaterThan(0);
    // Nobody is told about themselves in the lists.
    expect(a.heard.enters.some((e) => e.id === a.heard.joined[0]!.entityId)).toBe(false);
  });

  it('own snapshot acks the input sequence and matches a client-side replay', async () => {
    const { join, tick } = setup();
    const a = await join('A', 'coast_guard_boat');
    await tick(1);
    const inputs: { seq: number; steer: number; throttle: number }[] = [];
    for (let i = 0; i < 60; i++) {
      const steer = i < 20 ? 0 : 0.5;
      const seq = a.input(steer, 1);
      inputs.push({ seq, steer: dqAxis(qAxis(steer)), throttle: dqAxis(qAxis(1)) });
      await tick(1);
    }
    const snaps = a.heard.snapshots;
    const first = snaps.find((s) => s.seq === inputs[9]!.seq)!;
    const last = snaps[snaps.length - 1]!;
    expect(first).toBeDefined();
    expect(last.seq).toBeGreaterThan(first.seq);
    // Replay the inputs after `first` from its self state: it must land on `last` (same shared code).
    const def = SHIPS.coast_guard_boat;
    const s = createShipState(def, first.self.x, first.self.y, first.self.heading);
    s.speed = first.self.speed;
    s.kx = first.self.kx;
    s.ky = first.self.ky;
    s.spin = first.self.spin;
    for (const i of inputs) {
      if (i.seq <= first.seq || i.seq > last.seq) continue;
      stepShip(s, i.steer, i.throttle, def.vMax, (def.turnRateDeg * Math.PI) / 180, STEP_SEC);
      applyWorldBounds(s, STEP_SEC);
    }
    expect(Math.abs(s.x - last.self.x)).toBeLessThan(1e-3);
    expect(Math.abs(s.y - last.self.y)).toBeLessThan(1e-3);
    expect(Math.abs(s.heading - last.self.heading)).toBeLessThan(1e-3);
  });

  it('tells others when a player leaves', async () => {
    const { join, tick } = setup();
    const a = await join('A');
    const b = await join('B');
    await tick(4);
    b.conn.close();
    await settle();
    await tick(4);
    expect(a.heard.leaves).toContain(b.heard.joined[0]!.entityId);
  });

  it('never sends garbage to the client', async () => {
    const { join, tick } = setup();
    const a = await join('A');
    await join('B');
    await tick(30);
    expect(a.heard.bad).toBe(0);
  });
});

describe('combat', () => {
  it('a shot is announced, hits, damages and eventually sinks the target, who respawns', async () => {
    const { room, join, tick } = setup();
    const a = await join('Shooter', 'corvette');
    const b = await join('Target', 'coast_guard_boat');
    await tick(1);
    // Blue shooter at x=300, red target 40 units east. Teams differ (blue vs red).
    place(room, a, 530, 550, 0);
    place(room, b, 570, 550, 0);
    const slotB = b.heard.joined[0]!.entityId - 1;
    const hull0 = room.world.slots[slotB]!.state.hull;
    for (let i = 0; i < 120 && a.heard.sunk.length === 0; i++) {
      // Keep the target where it is (a steady aim is all this test needs).
      place(room, b, 570, 550, 0);
      room.world.protectLeft[a.heard.joined[0]!.entityId - 1] = 0;
      a.input(0, 0, 0, 40, true);
      await tick(1);
    }
    expect(a.heard.spawns.some((s) => s.owner === a.heard.joined[0]!.entityId)).toBe(true);
    expect(a.heard.hits.some((h) => h.target === b.heard.joined[0]!.entityId)).toBe(true);
    expect(room.world.slots[slotB]!.state.hull).toBeLessThan(hull0);
    expect(a.heard.sunk.map((s) => s.id)).toContain(b.heard.joined[0]!.entityId);
    expect(b.heard.youDied).toHaveLength(1);
    expect(b.heard.youDied[0]!.killerId).toBe(a.heard.joined[0]!.entityId);
    // The wreck vanishes from snapshots and the player returns after the respawn delay.
    const joinedBefore = b.heard.joined.length;
    await tick(Math.ceil(MATCH.respawnSec * TICK_RATE) + 2);
    expect(b.heard.joined.length).toBe(joinedBefore + 1);
    expect(room.world.slots[slotB]!.state.alive).toBe(true);
    expect(a.heard.bad).toBe(0);
  });

  it('teammates do not hurt each other', async () => {
    const { room, join, tick } = setup();
    const a = await join('A', 'corvette'); // blue
    await join('Mid'); // red
    const c = await join('C', 'coast_guard_boat'); // blue
    await tick(1);
    place(room, a, 530, 550, 0);
    place(room, c, 570, 550, 0);
    const slotC = c.heard.joined[0]!.entityId - 1;
    const hull0 = room.world.slots[slotC]!.state.hull;
    for (let i = 0; i < 80; i++) {
      place(room, c, 570, 550, 0);
      a.input(0, 0, 0, 40, true);
      await tick(1);
    }
    expect(a.heard.spawns.length).toBeGreaterThan(0);
    expect(room.world.slots[slotC]!.state.hull).toBe(hull0);
    expect(room.world.slots[slotC]!.state.shield).toBe(SHIPS.coast_guard_boat.shield);
  });

  it('spawn protection absorbs hits', async () => {
    const { room, join, tick } = setup();
    const a = await join('A', 'corvette');
    const b = await join('B', 'coast_guard_boat');
    await tick(1);
    place(room, a, 530, 550, 0);
    place(room, b, 570, 550, 0);
    const slotB = b.heard.joined[0]!.entityId - 1;
    for (let i = 0; i < 40; i++) {
      room.world.protectLeft[slotB] = 1; // always protected
      place(room, b, 570, 550, 0);
      room.world.protectLeft[slotB] = 1;
      a.input(0, 0, 0, 40, true);
      await tick(1);
    }
    expect(room.world.slots[slotB]!.state.hull).toBe(SHIPS.coast_guard_boat.hull);
    expect(a.heard.hits.filter((h) => h.target === b.heard.joined[0]!.entityId)).toHaveLength(0);
  });

  it('the carrier shoots enemies that come close, and only enemies', async () => {
    const { room, join, tick } = setup();
    const blue = await join('Blue', 'coast_guard_boat');
    const red = await join('Red', 'coast_guard_boat');
    await tick(1);
    const bc = MATCH.carriers[0]!;
    // The red player sails right up to the blue carrier; the blue one stays beside it.
    place(room, red, bc.x + 25, bc.y + 28, 0);
    place(room, blue, bc.x - 25, bc.y + 28, 0);
    room.world.slots[blue.heard.joined[0]!.entityId - 1]!.state.hull = 100;
    for (let i = 0; i < 60; i++) {
      place(room, red, bc.x + 25, bc.y + 28, 0);
      place(room, blue, bc.x - 25, bc.y + 28, 0);
      await tick(1);
    }
    const redId = red.heard.joined[0]!.entityId;
    const blueId = blue.heard.joined[0]!.entityId;
    expect(red.heard.hits.some((h) => h.target === redId && h.attacker === 1)).toBe(true);
    expect(blue.heard.hits.some((h) => h.target === blueId)).toBe(false);
  });
});

describe('match flow', () => {
  it('sinking the enemy carrier ends the round, then a new one starts', async () => {
    const { room, join, tick } = setup();
    const blue = await join('Blue', 'corvette');
    const red = await join('Red', 'coast_guard_boat');
    await tick(1);
    const rc = MATCH.carriers[1]!;
    const redCarrier = room.world.slots[1]!.state;
    redCarrier.hull = 20;
    redCarrier.shield = 0;
    // Blue sails next to the red carrier and shoots it (spawn protection keeps it alive meanwhile).
    for (let i = 0; i < 100 && room.world.matchState === MATCH_STATE.PLAYING; i++) {
      place(room, blue, rc.x - 40, rc.y, 0);
      // The carrier shoots back: keep the attacker alive so the test is about the carrier's fate.
      const mine = room.world.slots[blue.heard.joined[0]!.entityId - 1]!;
      mine.state.hull = mine.def.hull;
      mine.state.shield = mine.def.shield;
      blue.input(0, 0, 0, 40, true);
      await tick(1);
    }
    expect(room.world.matchState).toBe(MATCH_STATE.ENDED);
    expect(room.world.winner).toBe(TEAM_BLUE);
    const ended = red.heard.match.filter((m) => m.state === MATCH_STATE.ENDED);
    expect(ended.length).toBeGreaterThan(0);
    expect(ended[0]!.winner).toBe(TEAM_BLUE);

    // Intermission, then everything is back.
    const joinedBefore = red.heard.joined.length;
    await tick(Math.ceil(MATCH.intermissionSec * TICK_RATE) + 3);
    expect(room.world.matchState).toBe(MATCH_STATE.PLAYING);
    expect(room.world.slots[1]!.state.hull).toBe(CARRIER.hull);
    expect(room.world.slots[1]!.state.alive).toBe(true);
    expect(red.heard.joined.length).toBeGreaterThan(joinedBefore);
    expect(red.heard.match[red.heard.match.length - 1]!.state).toBe(MATCH_STATE.PLAYING);
  });
});

describe('abuse', () => {
  it('survives a flood of messages and garbage', async () => {
    const { room, join, tick, transport } = setup();
    const a = await join('A');
    const bad = new TestClient(transport.connect('10.9.9.9'));
    bad.hello();
    for (let i = 0; i < 2000; i++) bad.conn.send(new Uint8Array([i & 255, 1, 2, 3]));
    for (let i = 0; i < 2000; i++) bad.input(0, 1);
    await settle();
    await tick(10);
    // The honest client is unaffected and the room keeps ticking.
    expect(a.heard.bad).toBe(0);
    expect(room.world.tick).toBeGreaterThan(5);
  });

  it('drops a connection that never says HELLO', async () => {
    const { tick, transport } = setup();
    const c = new TestClient(transport.connect());
    await tick(TICK_RATE * 7);
    expect(c.conn.closed).toBe(true);
  });

  it('ignores INPUT before PLAY and PLAY with an unknown ship', async () => {
    const { room, transport, tick } = setup();
    const c = new TestClient(transport.connect());
    c.hello();
    c.input(0, 1);
    c.play('Valid', 250);
    await settle();
    await tick(3);
    expect(c.heard.joined).toHaveLength(0);
    expect(room.world.playerCount()).toBe(0);
  });
});

describe('wire values', () => {
  it('quantized aim survives the trip within a hair', () => {
    expect(Math.abs(dqAngle16(qAngle16(1.2345)) - 1.2345)).toBeLessThan(1e-4);
  });
});

describe('collisions on the server', () => {
  it('islands stop a player and are reported as a bump', async () => {
    const { room, join, tick } = setup();
    const a = await join('A', 'coast_guard_boat');
    await tick(1);
    const map = room.world.land;
    // Park right next to the first island and drive into it.
    const i = 0;
    const slot = a.heard.joined[0]!.entityId - 1;
    const s = room.world.slots[slot]!.state;
    s.x = map.islandX[i]! - map.islandR[i]! - 12;
    s.y = map.islandY[i]!;
    s.heading = 0;
    room.world.protectLeft[slot] = 0;
    for (let k = 0; k < 120; k++) {
      a.input(0, 1);
      await tick(1);
    }
    // Outside the island polygon, and the impact was reported.
    const probe = createShipState(SHIPS.coast_guard_boat, s.x, s.y, s.heading);
    let touching = false;
    collideIslands(map, probe, SHIPS.coast_guard_boat, 1, {
      onIslandHit: () => {
        touching = true;
      },
    });
    expect(touching).toBe(false);
    expect(a.heard.bumps.some((b) => b.other === 0xffff)).toBe(true);
  });
});
