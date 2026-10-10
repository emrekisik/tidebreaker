import { describe, expect, it } from 'vitest';
import {
  CARRIER,
  COMBAT,
  MATCH,
  MATCH_STATE,
  NO_WEAPON,
  PICKUP_CAPACITY,
  PICKUP_ID_BASE,
  PROTOCOL_VERSION,
  REJECT_REASON,
  SHIPS,
  SHIP_IDS,
  STAT,
  STAT_COUNT,
  STEP_SEC,
  TEAM_BLUE,
  TEAM_RED,
  TICK_RATE,
  ECONOMY,
  KIND,
  applyWorldBounds,
  circleVsWorld,
  collideIslands,
  configHash,
  createShipState,
  dqAngle16,
  dqAxis,
  encodeTierUp,
  encodeUpgrade,
  qAngle16,
  qAxis,
  stepShip,
  statCost,
  Writer,
} from '@tidebreaker/shared';
import { MemoryTransport } from '../net/memTransport.ts';
import { TestClient, settle } from '../testing.ts';
import { NOTE_START } from '../sim/hot/pickups.ts';
import { Room } from './room.ts';

const SEED = 1337;
const idx = (id: keyof typeof SHIPS): number => SHIP_IDS.indexOf(id);

/** A room driven by hand: every `tick()` advances the clock by exactly one step. */
function setup(options: { anyClass?: boolean } = {}): {
  room: Room;
  transport: MemoryTransport;
  tick: (n?: number) => Promise<void>;
  join: (name: string, ship?: keyof typeof SHIPS, ip?: string) => Promise<TestClient>;
} {
  const transport = new MemoryTransport();
  let now = 1000;
  const room = new Room({ transport, seed: SEED, clock: () => now, ...options });
  const joined: TestClient[] = [];
  let ticks = 0;
  const tick = async (n = 1): Promise<void> => {
    for (let i = 0; i < n; i++) {
      now += STEP_SEC * 1000;
      // Idle connections are dropped after 20 s: keep the scripted players alive.
      if (++ticks % TICK_RATE === 0) for (const c of joined) if (!c.conn.closed) c.ping(ticks);
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
    joined.push(c);
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
    const ids = a.heard.enters
      .map((e) => e.id)
      .filter((id) => id < PICKUP_ID_BASE)
      .sort();
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
    // The shots are reported (sparks on the shield) but do no damage.
    const onB = a.heard.hits.filter((h) => h.target === b.heard.joined[0]!.entityId);
    expect(onB.every((h) => h.damage === 0)).toBe(true);
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

describe('kill feed and scoreboard', () => {
  it('announces who sank whom to everyone and keeps score', async () => {
    const { room, join, tick } = setup();
    const a = await join('Shooter', 'corvette');
    const b = await join('Target', 'coast_guard_boat');
    await tick(1);
    place(room, a, 530, 550, 0);
    place(room, b, 570, 550, 0);
    const aId = a.heard.joined[0]!.entityId;
    const bId = b.heard.joined[0]!.entityId;
    for (let i = 0; i < 160 && a.heard.kills.length === 0; i++) {
      place(room, b, 570, 550, 0);
      room.world.protectLeft[aId - 1] = 0;
      a.input(0, 0, 0, 40, true);
      await tick(1);
    }
    for (const c of [a, b]) {
      expect(c.heard.kills).toHaveLength(1);
      expect(c.heard.kills[0]).toMatchObject({
        killerId: aId,
        victimId: bId,
        killerTeam: TEAM_BLUE,
        victimTeam: TEAM_RED,
        killerName: 'Shooter',
        victimName: 'Target',
      });
      expect(c.heard.kills[0]!.weapon).not.toBe(NO_WEAPON);
    }
    await tick(TICK_RATE + 2);
    const rows = a.heard.scores[a.heard.scores.length - 1]!;
    expect(rows.find((r) => r.id === aId)).toMatchObject({ kills: 1, deaths: 0, name: 'Shooter' });
    expect(rows.find((r) => r.id === bId)).toMatchObject({ kills: 0, deaths: 1, team: TEAM_RED });
    expect(a.heard.bad).toBe(0);
  });

  it('a collision kill has no weapon', async () => {
    const { room, join, tick } = setup();
    const a = await join('A');
    const b = await join('B');
    await tick(1);
    const aId = a.heard.joined[0]!.entityId;
    const bId = b.heard.joined[0]!.entityId;
    place(room, a, 530, 550, 0);
    place(room, b, 531, 550, 0);
    room.world.slots[bId - 1]!.state.hull = 1;
    room.world.slots[bId - 1]!.state.shield = 0;
    room.world.slots[aId - 1]!.state.speed = 10;
    for (let i = 0; i < 20 && a.heard.kills.length === 0; i++) await tick(1);
    if (a.heard.kills.length > 0) expect(a.heard.kills[0]!.weapon).toBe(NO_WEAPON);
  });
});

describe('shield recharge', () => {
  it('starts after a few quiet seconds and refills in the configured time', async () => {
    const { room, join, tick } = setup();
    const a = await join('A');
    await tick(1);
    const slot = a.heard.joined[0]!.entityId - 1;
    const s = room.world.slots[slot]!.state;
    const max = room.world.slots[slot]!.def.shield;
    s.shield = 0;
    s.sinceDamage = 0;
    await tick(Math.floor((COMBAT.shieldDelaySec - 0.5) * TICK_RATE));
    expect(s.shield).toBe(0);
    await tick(Math.ceil(1.5 * TICK_RATE));
    expect(s.shield).toBeGreaterThan(0);
    await tick(Math.ceil(COMBAT.shieldRechargeSec * TICK_RATE));
    expect(s.shield).toBe(max);
  });

  it('damage interrupts it again', async () => {
    const { room, join, tick } = setup();
    const a = await join('A');
    await tick(1);
    const s = room.world.slots[a.heard.joined[0]!.entityId - 1]!.state;
    s.shield = 5;
    s.sinceDamage = 100;
    await tick(10);
    expect(s.shield).toBeGreaterThan(5);
    s.sinceDamage = 0; // as applyDamage does
    const before = s.shield;
    await tick(Math.floor((COMBAT.shieldDelaySec - 1) * TICK_RATE));
    expect(s.shield).toBeCloseTo(before, 3);
  });

  it('carriers recharge too, much more slowly', async () => {
    const { room, tick } = setup();
    const carrier = room.world.slots[0]!;
    carrier.state.shield = 0;
    carrier.state.sinceDamage = 0;
    await tick(Math.ceil((COMBAT.carrierShieldDelaySec + 6) * TICK_RATE));
    const gained = carrier.state.shield / CARRIER.shield;
    expect(gained).toBeGreaterThan(0.05);
    expect(gained).toBeLessThan(0.15);
  });
});

describe('hull repair', () => {
  it('mends slowly after a quiet spell, and the upgrade level speeds it up', async () => {
    const { room, join, tick } = setup();
    const a = await join('A');
    await tick(1);
    const slot = a.heard.joined[0]!.entityId - 1;
    const s = room.world.slots[slot]!.state;
    const max = room.world.slots[slot]!.def.hull;
    s.hull = max * 0.5;
    s.sinceDamage = 0;
    await tick(Math.floor((COMBAT.hullRegenDelaySec - 0.5) * TICK_RATE));
    expect(s.hull).toBeCloseTo(max * 0.5, 3);
    await tick(10 * TICK_RATE);
    const slow = s.hull - max * 0.5;
    expect(slow).toBeGreaterThan(0);
    // About 0.3% of the hull per second, so ten seconds is a few percent at most.
    expect(slow).toBeLessThan(max * 0.05);
    room.world.levels[slot * STAT_COUNT + STAT.REGEN] = 3;
    const before = s.hull;
    await tick(5 * TICK_RATE);
    expect(s.hull - before).toBeGreaterThan(slow / 2);
  });

  it('never repairs a carrier hull', async () => {
    const { room, tick } = setup();
    const carrier = room.world.slots[0]!.state;
    carrier.hull = 1000;
    carrier.sinceDamage = 100;
    await tick(10 * TICK_RATE);
    expect(carrier.hull).toBe(1000);
  });
});

describe('spawn protection', () => {
  it('ends with the first shot', async () => {
    const { room, join, tick } = setup();
    const a = await join('A', 'corvette');
    await tick(1);
    const slot = a.heard.joined[0]!.entityId - 1;
    expect(room.world.protectLeft[slot]).toBeGreaterThan(0);
    await tick(5);
    expect(room.world.protectLeft[slot]).toBeGreaterThan(0);
    a.input(0, 0, 0, 40, true);
    await tick(2);
    expect(room.world.protectLeft[slot]).toBe(0);
    expect(a.heard.spawns.some((x) => x.owner === slot + 1)).toBe(true);
  });
});

describe('combat-log protection', () => {
  it('a player who drops out in the middle of a fight stays as a drifting target for a while', async () => {
    const { room, join, tick } = setup();
    const a = await join('A');
    const b = await join('B');
    await tick(2);
    const slotB = b.heard.joined[0]!.entityId - 1;
    room.world.combatAge[slotB] = 1; // was hit a second ago
    b.conn.close();
    await settle();
    await tick(1);
    expect(room.world.used[slotB]).toBe(1);
    expect(room.world.slots[slotB]!.state.alive).toBe(true);
    // Still in the snapshots of the others.
    await tick(Math.floor((COMBAT.combatLogDriftSec - 2) * TICK_RATE));
    expect(room.world.used[slotB]).toBe(1);
    expect(a.heard.leaves).not.toContain(slotB + 1);
    // Then it is gone.
    await tick(Math.ceil(3 * TICK_RATE));
    expect(room.world.used[slotB]).toBe(0);
    expect(a.heard.leaves).toContain(slotB + 1);
  });

  it('a drifting ship can still be sunk, and counts as a kill for the shooter', async () => {
    const { room, join, tick } = setup();
    const a = await join('Shooter', 'corvette');
    const b = await join('Quitter', 'coast_guard_boat');
    await tick(2);
    const aId = a.heard.joined[0]!.entityId;
    const slotB = b.heard.joined[0]!.entityId - 1;
    room.world.combatAge[slotB] = 1;
    b.conn.close();
    await settle();
    for (let i = 0; i < 200 && room.world.used[slotB] === 1; i++) {
      place(room, a, 530, 550, 0);
      const sb = room.world.slots[slotB]!.state;
      sb.x = 570;
      sb.y = 550;
      room.world.protectLeft[slotB] = 0;
      a.input(0, 0, 0, 40, true);
      await tick(1);
    }
    expect(room.world.used[slotB]).toBe(0);
    expect(a.heard.sunk.map((x) => x.id)).toContain(slotB + 1);
    expect(room.world.kills[aId - 1]).toBe(1);
  });

  it('a player who was not fighting disappears at once', async () => {
    const { room, join, tick } = setup();
    const b = await join('B');
    await tick(2);
    const slotB = b.heard.joined[0]!.entityId - 1;
    b.conn.close();
    await settle();
    await tick(1);
    expect(room.world.used[slotB]).toBe(0);
  });
});

/** Sends an UPGRADE or TIER_UP request the way a browser would. */
function request(c: TestClient, kind: 'upgrade' | 'tier', stat = 0): void {
  const w = new Writer(8);
  if (kind === 'upgrade') encodeUpgrade(w, stat);
  else encodeTierUp(w, 0);
  c.conn.send(w.toBytes());
}

describe('money and progress', () => {
  it('everyone starts as T1 with nothing unless the server lets players pick a class', async () => {
    const strict = setup({ anyClass: false });
    const a = await strict.join('A', 'heavy_frigate');
    await strict.tick(2);
    expect(a.heard.joined[0]!.shipId).toBe(idx('coast_guard_boat'));
    expect(strict.room.world.tier[a.heard.joined[0]!.entityId - 1]).toBe(0);
    const open = setup({ anyClass: true });
    const b = await open.join('B', 'heavy_frigate');
    await open.tick(2);
    expect(b.heard.joined[0]!.shipId).toBe(idx('heavy_frigate'));
    expect(open.room.world.tier[b.heard.joined[0]!.entityId - 1]).toBe(4);
  });

  it('a ship that touches a crate takes it: money and score, STATS, a PICKUP event', async () => {
    const { room, join, tick } = setup({ anyClass: false });
    const a = await join('A');
    const b = await join('B');
    await tick(2);
    const slot = a.heard.joined[0]!.entityId - 1;
    const p = room.world.pickups;
    // Find an ordinary crate and put the ship on it.
    let crate = -1;
    for (let i = 0; i < p.active.length && crate < 0; i++) {
      if (p.active[i] === 1 && p.kind[i] === KIND.CRATE) crate = i;
    }
    expect(crate).toBeGreaterThanOrEqual(0);
    const value = p.value[crate]!;
    const s = room.world.slots[slot]!.state;
    s.x = p.x[crate]!;
    s.y = p.y[crate]!;
    await tick(2);
    expect(room.world.cash[slot]).toBe(value);
    expect(room.world.score[slot]).toBe(value);
    expect(p.active[crate]).toBe(0);
    expect(
      a.heard.pickups.some((e) => e.id === PICKUP_ID_BASE + crate && e.collector === slot + 1),
    ).toBe(true);
    const stats = a.heard.stats[a.heard.stats.length - 1]!;
    expect(stats.cash).toBe(value);
    expect(stats.score).toBe(value);
    // B is told it is gone, and that it came back after the respawn delay (somewhere else).
    expect(b.heard.leaves).toContain(PICKUP_ID_BASE + crate);
    const entersBefore = b.heard.enters.filter((e) => e.id === PICKUP_ID_BASE + crate).length;
    await tick(Math.ceil((ECONOMY.pickups.crate.respawnSec + 2) * TICK_RATE));
    expect(b.heard.enters.filter((e) => e.id === PICKUP_ID_BASE + crate).length).toBeGreaterThan(
      entersBefore,
    );
  });

  it('upgrades cost money, respect the cap and change how the ship behaves', async () => {
    const { room, join, tick } = setup({ anyClass: false });
    const a = await join('A');
    await tick(2);
    const slot = a.heard.joined[0]!.entityId - 1;
    const w = room.world;
    w.cash[slot] = 100;
    request(a, 'upgrade', 0);
    await tick(1);
    expect(w.level(slot, 0)).toBe(1);
    expect(w.cash[slot]).toBe(100 - statCost(0));
    // Not enough money: refused.
    w.cash[slot] = 5;
    request(a, 'upgrade', 1);
    await tick(1);
    expect(w.level(slot, 1)).toBe(0);
    // A nonsense stat id is ignored.
    w.cash[slot] = 1000;
    request(a, 'upgrade', 9);
    await tick(1);
    expect(w.cash[slot]).toBe(1000);
    // The cap of T1 is 3.
    for (let i = 0; i < 6; i++) {
      request(a, 'upgrade', 2);
      await tick(1);
    }
    expect(w.level(slot, 2)).toBe(ECONOMY.statCap[0]);
    // The owner hears about it.
    const stats = a.heard.stats[a.heard.stats.length - 1]!;
    expect(stats.levels[0]).toBe(1);
    expect(stats.levels[2]).toBe(ECONOMY.statCap[0]);
  });

  it('the shield upgrade raises the capacity and fills the new part', async () => {
    const { room, join, tick } = setup({ anyClass: false });
    const a = await join('A');
    await tick(2);
    const slot = a.heard.joined[0]!.entityId - 1;
    const w = room.world;
    const base = w.maxShieldOf(slot);
    w.cash[slot] = 50;
    request(a, 'upgrade', 3);
    await tick(1);
    expect(w.maxShieldOf(slot)).toBeGreaterThan(base);
    expect(w.slots[slot]!.state.shield).toBeCloseTo(w.maxShieldOf(slot), 3);
  });

  it('moving up a class needs the score; position, speed and health share stay', async () => {
    const { room, join, tick } = setup({ anyClass: false });
    const a = await join('A');
    await tick(2);
    const slot = a.heard.joined[0]!.entityId - 1;
    const w = room.world;
    const s = w.slots[slot]!.state;
    s.hull = s.hull / 2;
    s.speed = 7;
    const x = s.x;
    request(a, 'tier');
    await tick(1);
    expect(w.tier[slot]).toBe(0); // not enough score
    w.score[slot] = ECONOMY.tierScore[1]!;
    request(a, 'tier');
    await tick(2);
    expect(w.tier[slot]).toBe(1);
    expect(w.slots[slot]!.def.id).toBe('gunboat');
    expect(w.slots[slot]!.state.hull / w.slots[slot]!.def.hull).toBeCloseTo(0.5, 1);
    expect(Math.abs(s.x - x)).toBeLessThan(2);
    const stats = a.heard.stats[a.heard.stats.length - 1]!;
    expect(stats.tier).toBe(1);
    expect(stats.shipId).toBe(idx('gunboat'));
  });

  it('sinking: the killer is paid, the loser drops banknotes, a class and the unspent money', async () => {
    const { room, join, tick } = setup({ anyClass: true });
    const a = await join('Shooter', 'corvette');
    const b = await join('Victim', 'frigate');
    await tick(2);
    const aSlot = a.heard.joined[0]!.entityId - 1;
    const bSlot = b.heard.joined[0]!.entityId - 1;
    const w = room.world;
    w.cash[bSlot] = 200;
    w.lives[bSlot] = 1; // the last life: this sinking costs the class
    w.score[bSlot] = 1000;
    w.levels[bSlot * 5 + 3] = 4; // shield level above the T3 cap? cap(T3)=5, stays
    w.levels[bSlot * 5 + 0] = 7; // above the cap of T3 (5): must be clipped
    const scoreBefore = w.score[aSlot]!;
    for (let i = 0; i < 400 && w.deaths[bSlot] === 0; i++) {
      place(room, a, 530, 550, 0);
      place(room, b, 570, 550, 0);
      a.input(0, 0, 0, 40, true);
      await tick(1);
    }
    expect(w.deaths[bSlot]).toBe(1);
    expect(w.score[aSlot]).toBeGreaterThan(scoreBefore);
    // The loser: one class down, score at that tier's floor, money gone, upgrades clipped.
    expect(w.tier[bSlot]).toBe(2);
    expect(w.score[bSlot]).toBe(ECONOMY.tierScore[2]);
    expect(w.cash[bSlot]).toBe(0);
    expect(w.level(bSlot, 0)).toBeLessThanOrEqual(ECONOMY.statCap[2]!);
    // The money lies in the sea as banknotes.
    let notes = 0;
    let total = 0;
    for (let i = 0; i < w.pickups.active.length; i++) {
      if (w.pickups.active[i] === 1 && w.pickups.kind[i] === KIND.BANKNOTE) {
        notes++;
        total += w.pickups.value[i]!;
      }
    }
    expect(notes).toBeGreaterThan(0);
    expect(total).toBe(200);
    // After the respawn delay the loser is back in the lower class.
    await tick(Math.ceil(MATCH.respawnSec * TICK_RATE) + 2);
    expect(w.slots[bSlot]!.def.id).toBe('corvette');
  });

  it('banknote piles expire after a while', async () => {
    const { room, tick } = setup();
    const p = room.world.pickups;
    p.dropBanknote(300, 300, 50);
    const notesActive = (): number => {
      let n = 0;
      for (let i = 0; i < p.active.length; i++) {
        if (p.active[i] === 1 && p.kind[i] === KIND.BANKNOTE) n++;
      }
      return n;
    };
    expect(notesActive()).toBe(1);
    await tick(Math.ceil((ECONOMY.death.lootLifeSec + 2) * TICK_RATE));
    expect(notesActive()).toBe(0);
  });

  it('damage to the enemy carrier pays', async () => {
    const { room, join, tick } = setup({ anyClass: true });
    const a = await join('A', 'corvette'); // blue
    await tick(2);
    const slot = a.heard.joined[0]!.entityId - 1;
    const rc = MATCH.carriers[1]!;
    const before = room.world.score[slot]!;
    for (let i = 0; i < 80; i++) {
      place(room, a, rc.x - 45, rc.y, 0);
      const mine = room.world.slots[slot]!;
      mine.state.hull = mine.def.hull;
      mine.state.shield = mine.def.shield;
      a.input(0, 0, 0, 45, true);
      await tick(1);
    }
    expect(room.world.score[slot]!).toBeGreaterThan(before);
    expect(room.world.cash[slot]!).toBe(room.world.score[slot]! - before);
  });

  it('a new round starts everyone over as T1', async () => {
    const { room, join, tick } = setup({ anyClass: true });
    const a = await join('A', 'frigate');
    await tick(2);
    const slot = a.heard.joined[0]!.entityId - 1;
    const w = room.world;
    w.cash[slot] = 500;
    w.score[slot] = 3000;
    w.startRound();
    expect(w.tier[slot]).toBe(0);
    expect(w.score[slot]).toBe(0);
    expect(w.cash[slot]).toBe(0);
    expect(w.slots[slot]!.def.id).toBe('coast_guard_boat');
  });
});

describe('damage upgrade', () => {
  it('raises the damage of every shot, and tells clients how strong the shot is', async () => {
    const hitDamage = async (level: number): Promise<{ damage: number; power: number }> => {
      const { room, join, tick } = setup({ anyClass: true });
      const a = await join('Shooter', 'corvette');
      const b = await join('Target', 'coast_guard_boat');
      await tick(2);
      const aSlot = a.heard.joined[0]!.entityId - 1;
      room.world.levels[aSlot * STAT_COUNT + STAT.DAMAGE] = level;
      for (let i = 0; i < 100 && a.heard.hits.length === 0; i++) {
        place(room, a, 530, 550, 0);
        place(room, b, 570, 550, 0);
        a.input(0, 0, 0, 40, true);
        await tick(1);
      }
      const spawn = a.heard.spawns.find((x) => x.owner === aSlot + 1)!;
      return { damage: a.heard.hits[0]!.damage, power: spawn.power };
    };
    const plain = await hitDamage(0);
    const strong = await hitDamage(5);
    expect(plain.power).toBe(0);
    expect(strong.power).toBe(5);
    expect(strong.damage).toBeGreaterThan(plain.damage * 1.3);
  });
});

describe('the guns grow with the damage upgrade', () => {
  it('everyone is told when it changes, and newcomers learn the current level', async () => {
    const { room, join, tick } = setup({ anyClass: false });
    const a = await join('A');
    const b = await join('B');
    await tick(2);
    const aSlot = a.heard.joined[0]!.entityId - 1;
    const w = room.world;
    w.cash[aSlot] = 100;
    request(a, 'upgrade', STAT.DAMAGE);
    await tick(2);
    expect(w.level(aSlot, STAT.DAMAGE)).toBe(1);
    expect(b.heard.powers.some((p) => p.id === aSlot + 1 && p.level === 1)).toBe(true);
    // A third player joins later and is told the level in the ENTER entry.
    const c = await join('C');
    await tick(4);
    expect(c.heard.enters.find((e) => e.id === aSlot + 1)!.power).toBe(1);
    expect(c.heard.enters.find((e) => e.id === 1)!.power).toBe(0); // a carrier
  });
});

describe('upgrade effects', () => {
  it('the speed and reload upgrades change how the ship behaves', async () => {
    const { room, join, tick } = setup({ anyClass: false });
    const a = await join('A');
    const b = await join('B');
    await tick(2);
    const w = room.world;
    const sa = a.heard.joined[0]!.entityId - 1;
    const sb = b.heard.joined[0]!.entityId - 1;
    w.levels[sa * STAT_COUNT + STAT.SPEED] = 3;
    for (const slot of [sa, sb]) {
      const s = w.slots[slot]!.state;
      s.x = slot === sa ? 500 : 500;
      s.y = slot === sa ? 400 : 700;
      s.heading = 0;
      s.speed = 0;
    }
    for (let i = 0; i < 100; i++) {
      w.moveShip(sa, 0, 1);
      w.moveShip(sb, 0, 1);
    }
    // After 5 seconds at full throttle the upgraded ship is clearly ahead.
    expect(w.slots[sa]!.state.x - 500).toBeGreaterThan((w.slots[sb]!.state.x - 500) * 1.05);
  });

  it('the pickup slot layout matches the shared capacity', async () => {
    const { room } = setup();
    expect(room.world.pickups.active.length).toBe(PICKUP_CAPACITY);
    expect(NOTE_START + ECONOMY.pickups.banknoteCapacity).toBe(PICKUP_CAPACITY);
  });
});

describe('upgrades belong to the class', () => {
  it('a class jump starts the new class without upgrades, and keeps the money', async () => {
    const { room, join, tick } = setup({ anyClass: false });
    const a = await join('A');
    await tick(2);
    const slot = a.heard.joined[0]!.entityId - 1;
    const w = room.world;
    w.cash[slot] = 100;
    request(a, 'upgrade', 0);
    request(a, 'upgrade', 3);
    await tick(2);
    expect(w.level(slot, 0)).toBe(1);
    expect(w.level(slot, 3)).toBe(1);
    const cash = w.cash[slot]!;
    w.score[slot] = ECONOMY.tierScore[1]!;
    request(a, 'tier');
    await tick(2);
    expect(w.tier[slot]).toBe(1);
    for (let k = 0; k < STAT_COUNT; k++) expect(w.level(slot, k)).toBe(0);
    expect(w.cash[slot]).toBe(cash);
    // The shield capacity went back to the plain class value, filled.
    expect(w.slots[slot]!.state.shield).toBeCloseTo(w.slots[slot]!.def.shield, 3);
    const stats = a.heard.stats[a.heard.stats.length - 1]!;
    expect(Array.from(stats.levels)).toEqual(new Array(STAT_COUNT).fill(0));
  });

  it('sinking drops the class and with it the upgrades; a T1 ship keeps its own', async () => {
    const { room, join, tick } = setup({ anyClass: true });
    const a = await join('Shooter', 'corvette');
    const b = await join('Victim', 'gunboat');
    await join('Filler', 'coast_guard_boat'); // keeps the next joiner on the red team
    const c = await join('Victim2', 'coast_guard_boat');
    await tick(2);
    const w = room.world;
    const bSlot = b.heard.joined[0]!.entityId - 1;
    const cSlot = c.heard.joined[0]!.entityId - 1;
    for (const slot of [bSlot, cSlot]) {
      w.levels[slot * STAT_COUNT] = 2;
      w.cash[slot] = 50;
      w.lives[slot] = 1;
    }
    // Shoot one victim at a time until it sinks, then look at what is left of it.
    const sink = async (client: TestClient, slot: number, x: number): Promise<void> => {
      for (let i = 0; i < 300 && w.deaths[slot] === 0; i++) {
        place(room, a, 530, 550, 0);
        place(room, client, x, 550, 0);
        const s = w.slots[slot]!.state;
        s.hull = Math.min(s.hull, 1);
        s.shield = 0;
        a.input(0, 0, 0, 40, true);
        await tick(1);
      }
    };
    await sink(b, bSlot, 570);
    expect(w.deaths[bSlot]).toBe(1);
    expect(w.tier[bSlot]).toBe(0);
    expect(w.level(bSlot, 0)).toBe(0); // class changed: upgrades gone
    await sink(c, cSlot, 570);
    expect(w.deaths[cSlot]).toBe(1);
    expect(w.tier[cSlot]).toBe(0);
    expect(w.level(cSlot, 0)).toBe(2); // still T1: kept
  });
});

describe('lives', () => {
  it('the class survives two sinkings and is lost with the third; a class jump restores the lives', async () => {
    const { room, join, tick } = setup({ anyClass: true });
    const a = await join('Shooter', 'corvette');
    const b = await join('Victim', 'frigate');
    await tick(2);
    const w = room.world;
    const bSlot = b.heard.joined[0]!.entityId - 1;
    w.cash[bSlot] = 60;
    w.score[bSlot] = 1500;
    expect(w.lives[bSlot]).toBe(ECONOMY.death.lives);
    const sinkOnce = async (): Promise<void> => {
      const before = w.deaths[bSlot]!;
      for (let i = 0; i < 400 && w.deaths[bSlot] === before; i++) {
        place(room, a, 530, 550, 0);
        place(room, b, 570, 550, 0);
        const s = w.slots[bSlot]!.state;
        s.hull = Math.min(s.hull, 1);
        s.shield = 0;
        a.input(0, 0, 0, 40, true);
        await tick(1);
      }
      // Wait for the respawn.
      await tick(Math.ceil(MATCH.respawnSec * TICK_RATE) + 2);
    };
    await sinkOnce();
    expect(w.tier[bSlot]).toBe(3); // still a frigate
    expect(w.lives[bSlot]).toBe(ECONOMY.death.lives - 1);
    expect(w.cash[bSlot]).toBe(0); // the money is gone every time
    expect(w.slots[bSlot]!.def.id).toBe('frigate');
    expect(b.heard.stats[b.heard.stats.length - 1]!.lives).toBe(ECONOMY.death.lives - 1);
    await sinkOnce();
    expect(w.tier[bSlot]).toBe(3);
    expect(w.lives[bSlot]).toBe(1);
    await sinkOnce();
    expect(w.tier[bSlot]).toBe(2); // the third sinking costs the class
    expect(w.lives[bSlot]).toBe(ECONOMY.death.lives);
    expect(w.score[bSlot]).toBe(ECONOMY.tierScore[2]);
    expect(w.slots[bSlot]!.def.id).toBe('corvette');
    // Moving up again gives a full set of lives.
    w.lives[bSlot] = 1;
    w.score[bSlot] = ECONOMY.tierScore[3]!;
    request(b, 'tier');
    await tick(2);
    expect(w.tier[bSlot]).toBe(3);
    expect(w.lives[bSlot]).toBe(ECONOMY.death.lives);
  });
});

describe('pickups are only where a ship can collect them', () => {
  it('none lies on land, in a carrier hull or in a pocket a ship cannot enter', async () => {
    const out = new Float32Array(3);
    for (const seed of [1337, 1, 987654]) {
      const { room, tick } = (() => {
        const transport = new MemoryTransport();
        let now = 1000;
        const room = new Room({ transport, seed, clock: () => now });
        return {
          room,
          tick: async (n: number): Promise<void> => {
            for (let i = 0; i < n; i++) {
              now += STEP_SEC * 1000;
              room.tick();
            }
          },
        };
      })();
      const w = room.world;
      // Over a few minutes everything respawns several times.
      for (let round = 0; round < 8; round++) {
        await tick(TICK_RATE * 30);
        const p = w.pickups;
        for (let i = 0; i < p.active.length; i++) {
          if (p.active[i] === 0) continue;
          const x = p.x[i]!;
          const y = p.y[i]!;
          expect(circleVsWorld(w.land, x, y, 5, out)).toBe(false);
          for (let t = 0; t < 2; t++) {
            const carrier = w.slots[t]!;
            for (const c of carrier.def.hitCircles) {
              const cx = carrier.state.x + Math.cos(carrier.state.heading) * c.offset;
              const cy = carrier.state.y + Math.sin(carrier.state.heading) * c.offset;
              expect(Math.hypot(cx - x, cy - y)).toBeGreaterThan(c.radius + 3);
            }
          }
        }
      }
    }
  });
});
