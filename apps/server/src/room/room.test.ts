import { describe, expect, it } from 'vitest';
import {
  CARRIER,
  COMBAT,
  DRONE,
  DRONE_TYPES,
  MATCH,
  MATCH_STATE,
  NO_WEAPON,
  PICKUP_CAPACITY,
  END_REASON,
  PICKUP_ID_BASE,
  PIRATE,
  PIRATE_COUNT,
  PIRATE_COVES,
  PIRATE_GARRISONS,
  PIRATE_TYPES,
  PROTOCOL_VERSION,
  RIG,
  RIGS,
  RIG_NO_OWNER,
  REJECT_REASON,
  SHIPS,
  SHIP_IDS,
  STAT,
  STAT_COUNT,
  STEP_SEC,
  TEAM_BLUE,
  TEAM_PIRATE,
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
  BASE,
  BASE_ITEM,
  EMOTE,
  EMOTE_IDS,
  encodeBaseBuy,
  encodeEmote,
  encodeLock,
  ANNOUNCE,
  weaponIndex,
  encodeBuyDrone,
  MISSILE,
  WEAPONS,
  lockRange,
  gunsCost,
  encodeTierUp,
  encodeUpgrade,
  pirateReward,
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
const PIRATE_SKIFF_INDEX = 0;
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
      .filter((e) => e.id < PICKUP_ID_BASE && e.kind !== KIND.PIRATE)
      .map((e) => e.id)
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
    place(room, a, 530, 480, 0);
    place(room, b, 570, 480, 0);
    const slotB = b.heard.joined[0]!.entityId - 1;
    const hull0 = room.world.slots[slotB]!.state.hull;
    for (let i = 0; i < 120 && a.heard.sunk.length === 0; i++) {
      // Keep the target where it is (a steady aim is all this test needs).
      place(room, b, 570, 480, 0);
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
    place(room, a, 530, 480, 0);
    place(room, c, 570, 480, 0);
    const slotC = c.heard.joined[0]!.entityId - 1;
    const hull0 = room.world.slots[slotC]!.state.hull;
    for (let i = 0; i < 80; i++) {
      place(room, c, 570, 480, 0);
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
    place(room, a, 530, 480, 0);
    place(room, b, 570, 480, 0);
    const slotB = b.heard.joined[0]!.entityId - 1;
    for (let i = 0; i < 40; i++) {
      room.world.protectLeft[slotB] = 1; // always protected
      place(room, b, 570, 480, 0);
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
    place(room, a, 530, 480, 0);
    place(room, b, 570, 480, 0);
    const aId = a.heard.joined[0]!.entityId;
    const bId = b.heard.joined[0]!.entityId;
    for (let i = 0; i < 160 && a.heard.kills.length === 0; i++) {
      place(room, b, 570, 480, 0);
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
    place(room, a, 530, 480, 0);
    place(room, b, 531, 480, 0);
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

  it('only mends while the ship stands still', async () => {
    const { room, join, tick } = setup();
    const a = await join('A');
    await tick(1);
    const slot = a.heard.joined[0]!.entityId - 1;
    const s = room.world.slots[slot]!.state;
    const max = room.world.slots[slot]!.def.hull;
    s.hull = max * 0.5;
    s.sinceDamage = COMBAT.hullRegenDelaySec + 1;
    // Sailing: nothing is repaired, however long it lasts.
    for (let i = 0; i < 5 * TICK_RATE; i++) {
      s.speed = COMBAT.repairMaxSpeed * 4;
      await tick(1);
    }
    expect(s.hull).toBeCloseTo(max * 0.5, 3);
    // Stopped: it mends.
    s.speed = 0;
    await tick(2 * TICK_RATE);
    expect(s.hull).toBeGreaterThan(max * 0.5);
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
    // Everyone is told when it is over (the hologram goes).
    expect(a.heard.protectEnds.some((e) => e.id === slot + 1)).toBe(true);
  });

  it('lasts while the ship does not attack, far past the old three seconds, up to the cap', async () => {
    const { room, join, tick } = setup();
    const a = await join('A', 'corvette');
    const b = await join('B', 'corvette');
    await tick(4);
    const slot = a.heard.joined[0]!.entityId - 1;
    // Announced to everyone with the ship (bit 7 of the power field).
    expect(b.heard.enters.find((e) => e.id === slot + 1)!.power & 0x80).toBe(0x80);
    await tick(Math.ceil(5 * TICK_RATE));
    expect(room.world.protectLeft[slot]).toBeGreaterThan(0);
    await tick(Math.ceil((MATCH.spawnProtectSec - 5) * TICK_RATE) + 3);
    expect(room.world.protectLeft[slot]).toBe(0);
    expect(a.heard.protectEnds.filter((e) => e.id === slot + 1)).toHaveLength(1);
  });

  it('ends when the ship hurts another ship by ramming it, but not when it rams a protected one', async () => {
    const { room, join, tick } = setup();
    const a = await join('A', 'corvette');
    const b = await join('B', 'corvette');
    await tick(1);
    const w = room.world;
    const aSlot = a.heard.joined[0]!.entityId - 1;
    const bSlot = b.heard.joined[0]!.entityId - 1;
    // B is protected too: ramming it hurts nobody.
    w.onCollision(aSlot + 1, bSlot + 1, 100, 100, 6, 5, 5, false, false);
    expect(w.protectLeft[aSlot]).toBeGreaterThan(0);
    // B no longer protected: A hurt it.
    w.protectLeft[bSlot] = 0;
    w.onCollision(aSlot + 1, bSlot + 1, 100, 100, 6, 5, 5, false, false);
    expect(w.protectLeft[aSlot]).toBe(0);
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
      place(room, a, 530, 480, 0);
      const sb = room.world.slots[slotB]!.state;
      sb.x = 570;
      sb.y = 480;
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

  it('a ship that touches a crate takes it: money (not score), STATS, a PICKUP event', async () => {
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
    // (The spawn point may happen to sit on another crate: count from what the ship holds now.)
    const cash0 = room.world.cash[slot]!;
    const score0 = room.world.score[slot]!;
    const s = room.world.slots[slot]!.state;
    s.x = p.x[crate]!;
    s.y = p.y[crate]!;
    await tick(2);
    expect(room.world.cash[slot]).toBe(cash0 + value);
    expect(room.world.score[slot]).toBe(score0); // picking money up never scores
    expect(p.active[crate]).toBe(0);
    expect(
      a.heard.pickups.some((e) => e.id === PICKUP_ID_BASE + crate && e.collector === slot + 1),
    ).toBe(true);
    const stats = a.heard.stats[a.heard.stats.length - 1]!;
    expect(stats.cash).toBe(cash0 + value);
    expect(stats.score).toBe(score0);
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

  it('moving up a class costs money; position, speed and health share stay', async () => {
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
    expect(w.tier[slot]).toBe(0); // not enough money
    w.cash[slot] = ECONOMY.tierCost[1]!;
    w.statsDirty[slot] = 1;
    await tick(2);
    // The offer is made from the money in hand (the score is still 0).
    expect(a.heard.stats[a.heard.stats.length - 1]!.canTierUp).toBe(true);
    request(a, 'tier');
    await tick(2);
    expect(w.tier[slot]).toBe(1);
    expect(w.cash[slot]).toBe(0); // the class was paid for
    expect(w.slots[slot]!.def.id).toBe('gunboat');
    expect(w.slots[slot]!.state.hull / w.slots[slot]!.def.hull).toBeCloseTo(0.5, 1);
    expect(Math.abs(s.x - x)).toBeLessThan(2);
    const stats = a.heard.stats[a.heard.stats.length - 1]!;
    expect(stats.tier).toBe(1);
    expect(stats.shipId).toBe(idx('gunboat'));
  });

  it('sinking: the killer is paid, the loser drops banknotes (80% of the money) and a class', async () => {
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
      place(room, a, 530, 480, 0);
      place(room, b, 570, 480, 0);
      a.input(0, 0, 0, 40, true);
      await tick(1);
    }
    expect(w.deaths[bSlot]).toBe(1);
    expect(w.score[aSlot]).toBeGreaterThan(scoreBefore);
    // The loser: one class down (the score stays), money gone, upgrades clipped.
    expect(w.tier[bSlot]).toBe(2);
    expect(w.score[bSlot]).toBe(1000);
    // 80% of the money floated away, the rest stays.
    expect(w.cash[bSlot]).toBe(200 - Math.floor(200 * ECONOMY.death.cashLossPct));
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
    expect(total).toBe(Math.floor(200 * ECONOMY.death.cashLossPct));
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

  it('damage to the enemy carrier pays money, not score', async () => {
    const { room, join, tick } = setup({ anyClass: true });
    const a = await join('A', 'corvette'); // blue
    await tick(2);
    const slot = a.heard.joined[0]!.entityId - 1;
    const rc = MATCH.carriers[1]!;
    const before = room.world.score[slot]!;
    const cashBefore = room.world.cash[slot]!;
    for (let i = 0; i < 80; i++) {
      place(room, a, rc.x - 45, rc.y, 0);
      const mine = room.world.slots[slot]!;
      mine.state.hull = mine.def.hull;
      mine.state.shield = mine.def.shield;
      a.input(0, 0, 0, 45, true);
      await tick(1);
    }
    expect(room.world.cash[slot]!).toBeGreaterThan(cashBefore);
    expect(room.world.score[slot]!).toBe(before);
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
        place(room, a, 530, 480, 0);
        place(room, b, 570, 480, 0);
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
    expect(c.heard.enters.find((e) => e.id === aSlot + 1)!.power & 0x7f).toBe(1);
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
    w.cash[slot] = cash + ECONOMY.tierCost[1]!;
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
        place(room, a, 530, 480, 0);
        place(room, client, x, 480, 0);
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
        place(room, a, 530, 480, 0);
        place(room, b, 570, 480, 0);
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
    expect(w.cash[bSlot]).toBe(60 - Math.floor(60 * ECONOMY.death.cashLossPct)); // most of the money is gone every time
    expect(w.slots[bSlot]!.def.id).toBe('frigate');
    expect(b.heard.stats[b.heard.stats.length - 1]!.lives).toBe(ECONOMY.death.lives - 1);
    await sinkOnce();
    expect(w.tier[bSlot]).toBe(3);
    expect(w.lives[bSlot]).toBe(1);
    await sinkOnce();
    expect(w.tier[bSlot]).toBe(2); // the third sinking costs the class
    expect(w.lives[bSlot]).toBe(ECONOMY.death.lives);
    expect(w.slots[bSlot]!.def.id).toBe('corvette');
    // Moving up again gives a full set of lives.
    w.lives[bSlot] = 1;
    w.cash[bSlot] = ECONOMY.tierCost[3]!;
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

describe('oil rigs', () => {
  /** A rig's centre, and a spot inside its capture circle (clear of the platform). */
  const rig = RIGS[1]!;
  const inside = { x: rig.x + 16, y: rig.y };

  const keep = (room: Room, c: TestClient, spot = inside): void =>
    place(room, c, spot.x, spot.y, 0);

  it('a lone ship moves the gauge at the documented speed; the owner is paid every few seconds', async () => {
    const { room, join, tick } = setup({ anyClass: false });
    const blue = await join('Blue'); // blue team
    const red = await join('Red'); // red team, far away
    const blue2 = await join('Blue2'); // second blue player, also far away
    await tick(2);
    const w = room.world;
    const blueSlot = blue.heard.joined[0]!.entityId - 1;
    const blue2Slot = blue2.heard.joined[0]!.entityId - 1;
    const redSlot = red.heard.joined[0]!.entityId - 1;
    // Half the capture time: half full, nobody owns it yet.
    const half = Math.round((RIG.captureSecPerPower / 2) * TICK_RATE);
    for (let i = 0; i < half; i++) {
      keep(room, blue);
      await tick(1);
    }
    expect(w.rigMeter[1]).toBeGreaterThan(0.45);
    expect(w.rigMeter[1]).toBeLessThan(0.55);
    expect(w.rigOwner[1]).toBe(RIG_NO_OWNER);
    for (let i = 0; i < half + 10; i++) {
      keep(room, blue);
      await tick(1);
    }
    expect(w.rigMeter[1]).toBe(1);
    expect(w.rigOwner[1]).toBe(TEAM_BLUE);
    // Taking it scored for the player standing there, and only for them.
    expect(w.score[blueSlot]).toBe(RIG.captureScore);
    expect(w.score[blue2Slot]).toBe(0);
    expect(w.score[redSlot]).toBe(0);
    // Now it pays every blue player (not only the one standing there), nothing to red.
    const before = [w.cash[blueSlot]!, w.cash[blue2Slot]!, w.cash[redSlot]!];
    for (let i = 0; i < RIG.incomeEverySec * TICK_RATE * 4; i++) {
      keep(room, blue);
      await tick(1);
    }
    expect(w.cash[blueSlot]! - before[0]!).toBeGreaterThanOrEqual(3 * RIG.incomeCash);
    expect(w.cash[blue2Slot]! - before[1]!).toBeGreaterThanOrEqual(3 * RIG.incomeCash);
    expect(w.cash[redSlot]! - before[2]!).toBe(0);
    // Everybody hears the gauge.
    const last = blue2.heard.rigs[blue2.heard.rigs.length - 1]!;
    expect(last).toHaveLength(RIG.count);
    expect(last[1]).toEqual({ meter: 1, owner: TEAM_BLUE });
  });

  it('equal power is a standoff; more power wins, and the owner keeps it until the gauge is neutral', async () => {
    const { room, join, tick } = setup({ anyClass: true });
    const blue = await join('Blue', 'coast_guard_boat');
    const red = await join('Red', 'coast_guard_boat');
    await tick(2);
    const w = room.world;
    // Both inside: nothing moves.
    for (let i = 0; i < 100; i++) {
      keep(room, blue, { x: rig.x + 16, y: rig.y });
      keep(room, red, { x: rig.x - 16, y: rig.y });
      await tick(1);
    }
    expect(w.rigMeter[1]).toBe(0);
    // Blue captures it alone.
    for (let i = 0; i < (RIG.captureSecPerPower + 2) * TICK_RATE; i++) {
      keep(room, blue);
      place(room, red, 300, 300, 0);
      await tick(1);
    }
    expect(w.rigOwner[1]).toBe(TEAM_BLUE);
    // Red turns up with a stronger ship: the gauge goes back, the rig is lost at neutral, and with
    // enough time it turns red.
    const redSlot = red.heard.joined[0]!.entityId - 1;
    w.tier[redSlot] = 4; // power 3
    let lostAt = -1;
    for (let i = 0; i < 40 * TICK_RATE; i++) {
      place(room, blue, 300, 300, 0);
      keep(room, red);
      await tick(1);
      if (lostAt < 0 && w.rigOwner[1] === RIG_NO_OWNER) lostAt = i;
    }
    expect(lostAt).toBeGreaterThan(0);
    expect(w.rigOwner[1]).toBe(TEAM_RED);
    expect(w.rigMeter[1]).toBe(-1);
  });

  it('an empty rig keeps its gauge, and a new round resets every rig', async () => {
    const { room, join, tick } = setup({ anyClass: false });
    const blue = await join('Blue');
    await tick(2);
    const w = room.world;
    for (let i = 0; i < 5 * TICK_RATE; i++) {
      keep(room, blue);
      await tick(1);
    }
    const reached = w.rigMeter[1]!;
    expect(reached).toBeGreaterThan(0.1);
    place(room, blue, 300, 300, 0);
    await tick(3 * TICK_RATE);
    expect(w.rigMeter[1]).toBeCloseTo(reached, 5);
    w.startRound();
    expect(w.rigMeter[1]).toBe(0);
    expect(w.rigOwner[1]).toBe(RIG_NO_OWNER);
  });

  it('a newcomer is told the state of the rigs at once', async () => {
    const { join, tick } = setup();
    const a = await join('A');
    await tick(2);
    expect(a.heard.rigs.length).toBeGreaterThan(0);
    expect(a.heard.rigs[0]).toHaveLength(RIG.count);
  });
});

describe('pirates', () => {
  /** Slot of pirate `p` and the cove it lives at. */
  const slotOf = (room: Room, p: number): number => room.world.playerEnd + p;
  const coveOf = (p: number): { x: number; y: number } => {
    let n = 0;
    for (let c = 0; c < PIRATE_GARRISONS.length; c++) {
      n += PIRATE_GARRISONS[c]!.length;
      if (p < n) return PIRATE_COVES[c]!;
    }
    throw new Error('no such pirate');
  };
  /** The first pirate of this type. */
  const firstOf = (room: Room, typeIdx: number): number => {
    for (let p = 0; p < PIRATE_COUNT; p++) if (room.world.pirates.type[p] === typeIdx) return p;
    throw new Error('no such type');
  };

  it('are in every snapshot from the start: kind PIRATE, their own team, named by type', async () => {
    const { join, tick } = setup();
    const a = await join('A');
    await tick(4);
    const seen = a.heard.enters.filter((e) => e.kind === KIND.PIRATE);
    expect(seen).toHaveLength(PIRATE_COUNT);
    for (const e of seen) {
      expect(e.team).toBe(TEAM_PIRATE);
      expect(PIRATE_TYPES[e.shipId]!.id).toBe(e.name);
    }
    // They are not on the scoreboard.
    expect(a.heard.scores.at(-1)?.some((r) => r.team === TEAM_PIRATE) ?? false).toBe(false);
  });

  it('wait at their cove while nobody is near, and never end up in land', async () => {
    const { room, join, tick } = setup();
    await join('A');
    await tick(TICK_RATE * 30);
    const out = new Float32Array(3);
    for (let p = 0; p < PIRATE_COUNT; p++) {
      const st = room.world.slots[slotOf(room, p)]!.state;
      const cove = coveOf(p);
      expect(st.alive).toBe(true);
      expect(Math.hypot(st.x - cove.x, st.y - cove.y)).toBeLessThan(PIRATE.patrolRadius + 25);
      expect(circleVsWorld(room.world.land, st.x, st.y, 1, out)).toBe(false);
    }
  });

  it('attack a player who comes near their cove, and keep out of land while chasing', async () => {
    const { room, join, tick } = setup({ anyClass: true });
    const a = await join('A', 'heavy_frigate');
    await tick(2);
    const slot = a.heard.joined[0]!.entityId - 1;
    const w = room.world;
    const me = w.slots[slot]!;
    const cove = PIRATE_COVES[2]!;
    const start = me.state.hull + me.state.shield;
    const out = new Float32Array(3);
    for (let i = 0; i < TICK_RATE * 20; i++) {
      // The player stays at the edge of the cove, a bit outside the pirates' guns at first.
      place(room, a, cove.x + 35, cove.y + 10, Math.PI);
      me.state.hull = me.def.hull;
      me.state.shield = me.def.shield;
      await tick(1);
      for (let p = 0; p < PIRATE_COUNT; p++) {
        const st = w.slots[slotOf(room, p)]!.state;
        if (st.alive) expect(circleVsWorld(w.land, st.x, st.y, 1, out)).toBe(false);
      }
    }
    // Their shots arrived: a pirate hit this ship at least once (the player's health is topped up
    // every tick, so look at what the projectiles did instead).
    expect(a.heard.hits.some((h) => h.target === slot + 1 && h.attacker > w.playerEnd)).toBe(true);
    expect(start).toBeGreaterThan(0);
  });

  it("leave a player alone who is under a carrier's guns", async () => {
    const { room, join, tick } = setup({ anyClass: true });
    const a = await join('A', 'heavy_frigate');
    await tick(2);
    const slot = a.heard.joined[0]!.entityId - 1;
    const w = room.world;
    const home = MATCH.carriers[0]!;
    const ps = slotOf(room, firstOf(room, 1));
    const rs = w.slots[ps]!.state;
    // A raider sits 15 units from the player, who is inside the carrier's safe zone: it must not
    // shoot (the carrier's guns would sink it), even though the carrier cannot reach it yet.
    for (let i = 0; i < TICK_RATE * 6; i++) {
      place(room, a, home.x + 70, home.y + 20, 0);
      rs.x = home.x + 85;
      rs.y = home.y + 20;
      rs.speed = 0;
      await tick(1);
    }
    expect(a.heard.hits.some((h) => h.attacker === ps + 1)).toBe(false);
    expect(a.heard.spawns.some((sp) => sp.owner === ps + 1)).toBe(false);
    expect(slot).toBeGreaterThanOrEqual(0);
  });

  it('pay whoever sank them by damage, scaled to the player class, and come back later', async () => {
    const { room, join, tick } = setup({ anyClass: false });
    const a = await join('A'); // T1
    await tick(2);
    const slot = a.heard.joined[0]!.entityId - 1;
    const w = room.world;
    const p = firstOf(room, 0); // a skiff
    const ps = slotOf(room, p);
    const st = w.slots[ps]!.state;
    const cash0 = w.cash[slot]!;
    const score0 = w.score[slot]!;
    const gen0 = w.spawnGen[ps]!;
    // A big shot, owned by the player, lands right on the pirate.
    w.spawn(st.x - 4, st.y, 0, 60, 30, 0.15, 500, slot + 1, 0);
    await tick(2);
    expect(st.alive).toBe(false);
    const type = PIRATE_TYPES[PIRATE_SKIFF_INDEX]!;
    // Score for the kill; the money is in the loot chest it left behind.
    expect(w.score[slot]! - score0).toBe(pirateReward(type.reward, type.tier, 0));
    expect(w.cash[slot]).toBe(cash0);
    const p0 = w.pickups;
    let crate = -1;
    for (let i = NOTE_START; i < p0.active.length; i++) {
      if (p0.active[i] === 1 && p0.kind[i] === KIND.CHEST) crate = i;
    }
    expect(crate).toBeGreaterThanOrEqual(0);
    expect(p0.value[crate]).toBe(type.loot);
    // Whoever reaches it takes the money.
    const mine = w.slots[slot]!.state;
    mine.x = p0.x[crate]!;
    mine.y = p0.y[crate]!;
    await tick(2);
    expect(w.cash[slot]! - cash0).toBe(type.loot);
    expect(a.heard.kills.some((k) => k.victimId === ps + 1 && k.killerId === slot + 1)).toBe(true);
    expect(a.heard.leaves).toContain(ps + 1);
    // Sinking it does not cost the player a life or give a team kill.
    expect(w.lives[slot]).toBe(ECONOMY.death.lives);
    expect(w.teamKills[0]! + w.teamKills[1]!).toBe(0);
    // It is back at its cove after its respawn time, as a new ship.
    await tick(Math.ceil((type.respawnSec + 2) * TICK_RATE));
    expect(st.alive).toBe(true);
    expect(w.spawnGen[ps]).not.toBe(gen0);
    const cove = coveOf(p);
    expect(Math.hypot(st.x - cove.x, st.y - cove.y)).toBeLessThan(PIRATE.coveRadius + 20);
  });

  it('shoot players dead too, and that costs a life like any other kill', async () => {
    const { room, join, tick } = setup({ anyClass: false });
    const a = await join('A');
    await tick(2);
    const slot = a.heard.joined[0]!.entityId - 1;
    const w = room.world;
    const ps = slotOf(room, firstOf(room, 0));
    place(room, a, 300, 700, 0);
    // A pirate shot with enough damage sinks the T1 ship at once.
    w.spawn(w.slots[slot]!.state.x - 4, w.slots[slot]!.state.y, 0, 60, 30, 0.15, 900, ps + 1, 0);
    await tick(2);
    expect(w.slots[slot]!.state.alive).toBe(false);
    expect(w.lives[slot]).toBe(ECONOMY.death.lives - 1);
    expect(a.heard.youDied.at(-1)?.killerId).toBe(ps + 1);
    expect(w.teamKills[0]! + w.teamKills[1]!).toBe(0);
  });

  it('are shot at by the carriers', async () => {
    const { room, join, tick } = setup();
    await join('A');
    await tick(2);
    const w = room.world;
    const p = firstOf(room, 1); // a raider
    const ps = slotOf(room, p);
    const st = w.slots[ps]!.state;
    const home = MATCH.carriers[0]!;
    st.x = home.x + 35;
    st.y = home.y + 15;
    const full = st.hull + st.shield;
    await tick(TICK_RATE);
    expect(!st.alive || st.hull + st.shield < full).toBe(true);
  });
});

describe('explosive barrels', () => {
  /** The first barrel and a spot with open water on every side of it. */
  const barrelOf = (room: Room): number => {
    const p = room.world.pickups;
    for (let i = 0; i < p.active.length; i++) {
      if (p.active[i] === 1 && p.kind[i] === KIND.BARREL) return i;
    }
    return -1;
  };

  it('ramming a barrel sets it off: the ship and its neighbours take damage, money does not change', async () => {
    const { room, join, tick } = setup({ anyClass: true });
    const a = await join('Rammer', 'corvette');
    const b = await join('Bystander', 'corvette');
    await tick(2);
    const w = room.world;
    const p = w.pickups;
    const barrel = barrelOf(room);
    expect(barrel).toBeGreaterThanOrEqual(0);
    expect(p.value[barrel]).toBe(0);
    const bx = p.x[barrel]!;
    const by = p.y[barrel]!;
    const aSlot = a.heard.joined[0]!.entityId - 1;
    const bSlot = b.heard.joined[0]!.entityId - 1;
    const cash0 = w.cash[aSlot]!;
    const B = ECONOMY.pickups.barrel.blast;
    // The bystander floats near the rim of the blast.
    place(room, b, bx + 12 + 6, by, 0);
    place(room, a, bx, by, 0);
    const bHull = w.slots[bSlot]!.state.hull;
    const bShield = w.slots[bSlot]!.state.shield;
    const aHull = w.slots[aSlot]!.state.hull + w.slots[aSlot]!.state.shield;
    await tick(2);
    expect(p.active[barrel]).toBe(0);
    expect(a.heard.blasts.some((e) => e.id === PICKUP_ID_BASE + barrel)).toBe(true);
    // The rammer sits in the middle: nearly the full damage.
    const aLeft = w.slots[aSlot]!.state.hull + w.slots[aSlot]!.state.shield;
    expect(aHull - aLeft).toBeGreaterThan(B.damage * 0.8);
    expect(aHull - aLeft).toBeLessThanOrEqual(B.damage + 1);
    // The bystander is hurt less (or not at all, when beyond the radius).
    const bLost = bHull + bShield - (w.slots[bSlot]!.state.hull + w.slots[bSlot]!.state.shield);
    expect(bLost).toBeLessThan(aHull - aLeft);
    expect(w.cash[aSlot]).toBe(cash0);
    // It comes back after a while.
    await tick(Math.ceil((ECONOMY.pickups.barrel.respawnSec + 2) * TICK_RATE));
    expect(p.active[barrel]).toBe(1);
  });

  it('a shot that reaches a barrel ends there and sets it off, crediting the shooter', async () => {
    const { room, join, tick } = setup({ anyClass: true });
    const a = await join('Shooter', 'corvette');
    const b = await join('Victim', 'coast_guard_boat');
    await tick(2);
    const w = room.world;
    const p = w.pickups;
    const barrel = barrelOf(room);
    const bx = p.x[barrel]!;
    const by = p.y[barrel]!;
    const aSlot = a.heard.joined[0]!.entityId - 1;
    const bSlot = b.heard.joined[0]!.entityId - 1;
    place(room, a, bx - 60, by, 0);
    place(room, b, bx + 9, by, 0);
    // Keep the shooter's own gun silent; fire a shot by hand along the barrel's row.
    const victim = w.slots[bSlot]!.state;
    const before = victim.hull + victim.shield;
    w.spawn(bx - 8, by, 0, 60, 30, 0.15, 1, aSlot + 1, 0);
    await tick(6);
    expect(p.active[barrel]).toBe(0);
    expect(a.heard.ends.some((e) => e.reason === END_REASON.HIT_ISLAND)).toBe(true);
    expect(a.heard.blasts.length).toBeGreaterThan(0);
    expect(before - (victim.hull + victim.shield)).toBeGreaterThan(0);
    // The blast is attributed to the shooter (a SHIP_HIT with the shooter as attacker).
    expect(a.heard.hits.some((h) => h.target === bSlot + 1 && h.attacker === aSlot + 1)).toBe(true);
  });

  it('a barrel next to another sets that one off too', async () => {
    const { room, join, tick } = setup({ anyClass: true });
    const a = await join('Rammer', 'heavy_frigate');
    await tick(2);
    const w = room.world;
    const p = w.pickups;
    const first = barrelOf(room);
    let second = -1;
    for (let i = first + 1; i < p.active.length; i++) {
      if (p.active[i] === 1 && p.kind[i] === KIND.BARREL) {
        second = i;
        break;
      }
    }
    expect(second).toBeGreaterThan(first);
    p.x[second] = p.x[first]! + 3;
    p.y[second] = p.y[first]!;
    const aSlot = a.heard.joined[0]!.entityId - 1;
    place(room, a, p.x[first]!, p.y[first]!, 0);
    w.protectLeft[aSlot] = 0;
    await tick(2);
    expect(p.active[first]).toBe(0);
    expect(p.active[second]).toBe(0);
    expect(a.heard.blasts.length).toBeGreaterThanOrEqual(2);
  });
});

describe('drones', () => {
  const buy = (c: TestClient, type: number): void => {
    const w = new Writer(4);
    encodeBuyDrone(w, type);
    c.conn.send(w.toBytes());
  };
  /** A spot a little way off the own carrier's hull (inside the buying range). */
  const byCarrier = (team: number): { x: number; y: number } => {
    const b = MATCH.carriers[team]!;
    return { x: b.x, y: b.y + 40 };
  };

  it('are bought near the own carrier with money, up to the limit; the drone shows up for everyone', async () => {
    const { room, join, tick } = setup({ anyClass: false });
    const a = await join('Owner'); // blue
    const b = await join('Watcher'); // red
    await tick(2);
    const w = room.world;
    const slot = a.heard.joined[0]!.entityId - 1;
    const spot = byCarrier(TEAM_BLUE);
    place(room, a, spot.x, spot.y, 0);
    expect(w.nearOwnCarrier(slot)).toBe(true);
    // Too poor.
    w.cash[slot] = DRONE_TYPES[0]!.price - 1;
    buy(a, 0);
    await tick(2);
    expect(w.drones.countOf[slot]).toBe(0);
    // With the money: one drone, the money is gone, everyone is told, the owner's STATS count it.
    w.cash[slot] = DRONE_TYPES[0]!.price + DRONE_TYPES[1]!.price + 5;
    buy(a, 0);
    await tick(2);
    expect(w.drones.countOf[slot]).toBe(1);
    expect(w.cash[slot]).toBe(DRONE_TYPES[1]!.price + 5);
    expect(a.heard.stats[a.heard.stats.length - 1]!.drones).toBe(1);
    expect(b.heard.enters.some((e) => e.kind === KIND.DRONE && e.team === TEAM_BLUE)).toBe(true);
    // A second, then no more.
    buy(a, 1);
    await tick(2);
    expect(w.drones.countOf[slot]).toBe(DRONE.perPlayer);
    w.cash[slot] = 1000;
    buy(a, 0);
    await tick(2);
    expect(w.drones.countOf[slot]).toBe(DRONE.perPlayer);
    expect(w.cash[slot]).toBe(1000 - 0);
  });

  it('cannot be bought away from the carrier, with a bad type, or while sunk', async () => {
    const { room, join, tick } = setup({ anyClass: false });
    const a = await join('Owner');
    await tick(2);
    const w = room.world;
    const slot = a.heard.joined[0]!.entityId - 1;
    w.cash[slot] = 1000;
    place(room, a, 600, 300, 0);
    expect(w.nearOwnCarrier(slot)).toBe(false);
    buy(a, 0);
    await tick(2);
    const spot = byCarrier(TEAM_BLUE);
    place(room, a, spot.x, spot.y, 0);
    buy(a, 7);
    await tick(2);
    expect(w.drones.countOf[slot]).toBe(0);
    expect(w.cash[slot]).toBe(1000);
  });

  it('attack the nearest enemy near their owner, and the kill is the owner\'s', async () => {
    const { room, join, tick } = setup({ anyClass: true });
    const a = await join('Owner', 'corvette'); // blue
    const b = await join('Enemy', 'coast_guard_boat'); // red
    await tick(2);
    const w = room.world;
    const slot = a.heard.joined[0]!.entityId - 1;
    const enemy = b.heard.joined[0]!.entityId - 1;
    const spot = byCarrier(TEAM_BLUE);
    place(room, a, spot.x, spot.y, 0);
    w.cash[slot] = 500;
    buy(a, 0);
    await tick(2);
    expect(w.drones.countOf[slot]).toBe(1);
    // The owner sails out into the open sea; an enemy comes within reach (away from any carrier guns).
    const es = w.slots[enemy]!.state;
    const score0 = w.score[slot]!;
    for (let i = 0; i < 900 && es.alive; i++) {
      place(room, a, 560, 480, 0);
      place(room, b, 600, 480, Math.PI);
      w.protectLeft[enemy] = 0;
      await tick(1);
    }
    // The drone hurt it (shield first, then hull) and, given time, sank it for the owner.
    expect(es.alive).toBe(false);
    expect(w.score[slot]!).toBeGreaterThan(score0);
    expect(w.kills[slot]).toBe(1);
  });

  it('are shot down by the enemy for a bounty, and go with their owner when it sinks', async () => {
    const { room, join, tick } = setup({ anyClass: true });
    const a = await join('Owner', 'corvette');
    const b = await join('Hunter', 'corvette');
    await tick(2);
    const w = room.world;
    const slot = a.heard.joined[0]!.entityId - 1;
    const hunter = b.heard.joined[0]!.entityId - 1;
    const spot = byCarrier(TEAM_BLUE);
    place(room, a, spot.x, spot.y, 0);
    w.cash[slot] = 500;
    buy(a, 0);
    buy(a, 1);
    await tick(2);
    expect(w.drones.countOf[slot]).toBe(2);
    // The red player's shot lands right on the first drone (after its take-off protection).
    await tick(Math.ceil((DRONE.launchSec + 0.5) * TICK_RATE));
    const d0 = w.drones.slotOf(0);
    const ds = w.slots[d0]!.state;
    const before = w.score[hunter]!;
    w.spawn(ds.x - 1.5, ds.y, 0, 60, 30, 1.2, 500, hunter + 1, 0);
    await tick(2);
    expect(ds.alive).toBe(false);
    expect(w.drones.countOf[slot]).toBe(1);
    expect(w.score[hunter]! - before).toBe(DRONE_TYPES[0]!.bounty);
    expect(a.heard.leaves).toContain(d0 + 1);
    // The owner sinks: the other drone goes too.
    const os = w.slots[slot]!.state;
    place(room, a, 300, 700, 0);
    w.protectLeft[slot] = 0;
    w.spawn(os.x - 4, os.y, 0, 60, 30, 0.15, 2000, hunter + 1, 0);
    await tick(3);
    expect(os.alive).toBe(false);
    expect(w.drones.countOf[slot]).toBe(0);
    expect(w.drones.count).toBe(0);
  });

  it('point their nose the way they fly (also while circling their owner)', async () => {
    const { room, join, tick } = setup({ anyClass: false });
    const a = await join('Owner');
    await tick(2);
    const w = room.world;
    const slot = a.heard.joined[0]!.entityId - 1;
    const spot = byCarrier(TEAM_BLUE);
    place(room, a, spot.x, spot.y, 0);
    w.cash[slot] = 500;
    buy(a, 1); // the combat drone
    await tick(2);
    const ds = w.slots[w.drones.slotOf(0)]!.state;
    let checked = 0;
    for (let i = 0; i < 400; i++) {
      place(room, a, spot.x, spot.y, 0);
      const x0 = ds.x;
      const y0 = ds.y;
      await tick(1);
      const moved = Math.hypot(ds.x - x0, ds.y - y0);
      // After the take-off, whenever it moves noticeably the nose is along the movement.
      if (i > 120 && moved > 0.15) {
        const dir = Math.atan2(ds.y - y0, ds.x - x0);
        expect(Math.abs(Math.atan2(Math.sin(dir - ds.heading), Math.cos(dir - ds.heading)))).toBeLessThan(0.6);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('tell everyone whose they are (the owner entity id in ENTER power)', async () => {
    const { room, join, tick } = setup({ anyClass: false });
    const a = await join('Owner');
    const b = await join('Watcher');
    await tick(2);
    const w = room.world;
    const slot = a.heard.joined[0]!.entityId - 1;
    const spot = byCarrier(TEAM_BLUE);
    place(room, a, spot.x, spot.y, 0);
    w.cash[slot] = 500;
    buy(a, 0);
    await tick(3);
    const e = b.heard.enters.find((x) => x.kind === KIND.DRONE)!;
    expect(e.power).toBe(slot + 1);
  });

  it('give up the attack and fly home when they are far from their owner', async () => {
    const { room, join, tick } = setup({ anyClass: true });
    const a = await join('Owner', 'corvette');
    const b = await join('Enemy', 'coast_guard_boat');
    await tick(2);
    const w = room.world;
    const slot = a.heard.joined[0]!.entityId - 1;
    const spot = byCarrier(TEAM_BLUE);
    place(room, a, spot.x, spot.y, 0);
    w.cash[slot] = 500;
    buy(a, 0);
    await tick(2);
    const d0 = w.drones.slotOf(0);
    // The owner is far from the drone (and from the enemy, which sits right by the drone): no attack.
    const ds = w.slots[d0]!.state;
    for (let i = 0; i < 90; i++) {
      place(room, a, spot.x + 150, spot.y - 150, 0);
      place(room, b, ds.x + 25, ds.y, Math.PI);
      w.protectLeft[b.heard.joined[0]!.entityId - 1] = 0;
      await tick(1);
    }
    expect(a.heard.spawns.filter((x) => x.owner === d0 + 1)).toHaveLength(0);
  });

  it('are gone when a new round starts', async () => {
    const { room, join, tick } = setup({ anyClass: false });
    const a = await join('Owner');
    await tick(2);
    const w = room.world;
    const slot = a.heard.joined[0]!.entityId - 1;
    const spot = byCarrier(TEAM_BLUE);
    place(room, a, spot.x, spot.y, 0);
    w.cash[slot] = 500;
    buy(a, 0);
    await tick(2);
    expect(w.drones.count).toBe(1);
    w.startRound();
    expect(w.drones.count).toBe(0);
    expect(w.drones.countOf[slot]).toBe(0);
  });
});

describe('base shop', () => {
  const buyBase = (c: TestClient, item: number): void => {
    const w = new Writer(4);
    encodeBaseBuy(w, item);
    c.conn.send(w.toBytes());
  };
  const byCarrier = (team: number): { x: number; y: number } => {
    const b = MATCH.carriers[team]!;
    return { x: b.x, y: b.y + 40 };
  };

  it('mends the own carrier for money, only while it is damaged and the buyer is at it', async () => {
    const { room, join, tick } = setup({ anyClass: false });
    const a = await join('Owner'); // blue
    await tick(2);
    const w = room.world;
    const slot = a.heard.joined[0]!.entityId - 1;
    const carrier = w.slots[0]!;
    const spot = byCarrier(TEAM_BLUE);
    place(room, a, spot.x, spot.y, 0);
    w.cash[slot] = 1000;
    // Undamaged: nothing to mend, no money taken.
    buyBase(a, BASE_ITEM.REPAIR);
    await tick(2);
    expect(w.cash[slot]).toBe(1000);
    carrier.state.hull = carrier.def.hull * 0.5;
    buyBase(a, BASE_ITEM.REPAIR);
    await tick(2);
    expect(w.cash[slot]).toBe(1000 - BASE.repair.price);
    expect(carrier.state.hull).toBeCloseTo(carrier.def.hull * (0.5 + BASE.repair.pct), 0);
    // Away from the carrier it is refused.
    place(room, a, 600, 300, 0);
    buyBase(a, BASE_ITEM.REPAIR);
    await tick(2);
    expect(w.cash[slot]).toBe(1000 - BASE.repair.price);
    // The enemy carrier is not the buyer's to mend.
    expect(w.slots[1]!.state.hull).toBe(w.slots[1]!.def.hull);
  });

  it('raises the level of the team guns; the whole team hears it, the next level costs more', async () => {
    const { room, join, tick } = setup({ anyClass: false });
    const a = await join('Owner'); // blue
    const b = await join('Red'); // red
    const c = await join('Mate'); // blue
    await tick(2);
    const w = room.world;
    const slot = a.heard.joined[0]!.entityId - 1;
    const spot = byCarrier(TEAM_BLUE);
    place(room, a, spot.x, spot.y, 0);
    w.cash[slot] = 100000;
    buyBase(a, BASE_ITEM.GUNS);
    await tick(2);
    expect(w.baseGuns[TEAM_BLUE]).toBe(1);
    expect(w.baseGuns[TEAM_RED]).toBe(0);
    expect(w.cash[slot]).toBe(100000 - gunsCost(0));
    expect(a.heard.stats[a.heard.stats.length - 1]!.baseGuns).toBe(1);
    expect(c.heard.stats[c.heard.stats.length - 1]!.baseGuns).toBe(1);
    expect(b.heard.stats[b.heard.stats.length - 1]!.baseGuns).toBe(0);
    expect(gunsCost(1)).toBeGreaterThan(gunsCost(0));
    // Up to the top level, then no more.
    for (let i = 0; i < BASE.guns.maxLevel + 2; i++) {
      buyBase(a, BASE_ITEM.GUNS);
      await tick(1);
    }
    expect(w.baseGuns[TEAM_BLUE]).toBe(BASE.guns.maxLevel);
    // A new round starts the level over.
    w.startRound();
    expect(w.baseGuns[TEAM_BLUE]).toBe(0);
  });
});

describe('guided missiles', () => {
  const buyBase = (c: TestClient, item: number): void => {
    const w = new Writer(4);
    encodeBaseBuy(w, item);
    c.conn.send(w.toBytes());
  };
  const lock = (c: TestClient, target: number): void => {
    const w = new Writer(4);
    encodeLock(w, target);
    c.conn.send(w.toBytes());
  };
  const byCarrier = (team: number): { x: number; y: number } => {
    const b = MATCH.carriers[team]!;
    return { x: b.x, y: b.y + 40 };
  };
  const slotOf = (c: TestClient): number => c.heard.joined[c.heard.joined.length - 1]!.entityId - 1;
  const lastStats = (c: TestClient): { missiles: number; cash: number } =>
    c.heard.stats[c.heard.stats.length - 1]!;

  it('are bought at the own carrier by T3 and higher ships, two at most', async () => {
    const { room, join, tick } = setup();
    const t1 = await join('Small', 'coast_guard_boat'); // blue
    const red = await join('Red', 'corvette');
    const t2 = await join('Mid', 'gunboat'); // blue
    const t3 = await join('Big', 'corvette'); // red
    void red;
    await tick(2);
    const w = room.world;
    const spot = byCarrier(TEAM_BLUE);
    for (const c of [t1, t2]) {
      place(room, c, spot.x, spot.y, 0);
      w.cash[slotOf(c)] = 5000;
      buyBase(c, BASE_ITEM.MISSILE);
    }
    await tick(2);
    // T1 and T2 cannot carry any: no missile, no money taken.
    expect(w.missiles[slotOf(t1)]).toBe(0);
    expect(w.missiles[slotOf(t2)]).toBe(0);
    expect(w.cash[slotOf(t1)]).toBe(5000);
    // A T3 ship far from its carrier is refused as well.
    place(room, t3, 600, 300, 0);
    w.cash[slotOf(t3)] = 5000;
    buyBase(t3, BASE_ITEM.MISSILE);
    await tick(2);
    expect(w.missiles[slotOf(t3)]).toBe(0);
    // At its carrier it buys one, and a second, and no third.
    const red0 = byCarrier(TEAM_RED);
    place(room, t3, red0.x, red0.y, 0);
    for (let i = 0; i < MISSILE.maxStock + 1; i++) buyBase(t3, BASE_ITEM.MISSILE);
    await tick(2);
    expect(w.missiles[slotOf(t3)]).toBe(MISSILE.maxStock);
    expect(w.cash[slotOf(t3)]).toBe(5000 - MISSILE.price * MISSILE.maxStock);
    expect(lastStats(t3).missiles).toBe(MISSILE.maxStock);
    // Without the money nothing is bought either.
    w.missiles[slotOf(t3)] = 0;
    w.cash[slotOf(t3)] = MISSILE.price - 1;
    buyBase(t3, BASE_ITEM.MISSILE);
    await tick(2);
    expect(w.missiles[slotOf(t3)]).toBe(0);
  });

  it('launch after the lock time, chase the locked ship and hit it; the shooter is out one missile', async () => {
    const { room, join, tick } = setup();
    const a = await join('Shooter', 'corvette'); // blue
    const b = await join('Target', 'corvette'); // red
    await tick(2);
    const w = room.world;
    const aSlot = slotOf(a);
    const bSlot = slotOf(b);
    place(room, a, 600, 600, 0);
    place(room, b, 600, 700, Math.PI / 2);
    w.protectLeft[aSlot] = MATCH.spawnProtectSec;
    w.missiles[aSlot] = 2;
    const hull = w.slots[bSlot]!.state.hull + w.slots[bSlot]!.state.shield;
    lock(a, bSlot + 1);
    await tick(Math.ceil(MISSILE.lockSec * TICK_RATE) - 3);
    // Still locking: nothing has left yet.
    expect(b.heard.missiles).toHaveLength(0);
    await tick(6);
    expect(b.heard.missiles).toHaveLength(1);
    const m = b.heard.missiles[0]!;
    expect(m.owner).toBe(aSlot + 1);
    expect(m.target).toBe(bSlot + 1);
    expect(w.missiles[aSlot]).toBe(1);
    expect(lastStats(a).missiles).toBe(1);
    // Firing is an attack: the spawn protection is over.
    expect(w.protectLeft[aSlot]).toBe(0);
    await tick(TICK_RATE * 6);
    const struck = a.heard.hits.filter((h) => h.target === bSlot + 1);
    expect(struck.length).toBeGreaterThan(0);
    expect(struck.reduce((n, h) => n + h.damage, 0)).toBeCloseTo(WEAPONS.missile.damage, 0);
    const st = w.slots[bSlot]!.state;
    expect(st.hull + st.shield).toBeLessThan(hull);
  });

  it('flies after the ship when it keeps going, and the lock needs a real, visible enemy', async () => {
    const { room, join, tick } = setup();
    const a = await join('Shooter', 'corvette'); // blue
    const b = await join('Target', 'corvette'); // red
    const c = await join('Mate', 'corvette'); // blue
    await tick(2);
    const w = room.world;
    const aSlot = slotOf(a);
    const bSlot = slotOf(b);
    place(room, a, 600, 600, 0);
    place(room, b, 600, 680, Math.PI / 2);
    place(room, c, 560, 600, 0);
    w.missiles[aSlot] = 2;
    // A teammate, a carrier, a drone slot and nobody are refused.
    for (const target of [slotOf(c) + 1, 1, 2, w.pirateEnd + 1, 0xfff0]) {
      lock(a, target);
      await tick(2);
      expect(a.heard.lockBreaks.length).toBeGreaterThan(0);
      a.heard.lockBreaks.length = 0;
    }
    expect(w.missiles[aSlot]).toBe(2);
    // The target is under spawn protection: refused.
    w.protectLeft[bSlot] = 5;
    lock(a, bSlot + 1);
    await tick(2);
    expect(a.heard.lockBreaks).toHaveLength(1);
    a.heard.lockBreaks.length = 0;
    w.protectLeft[bSlot] = 0;
    // Too far away: refused.
    place(room, b, 600 + lockRange(2) + 50, 600, 0);
    lock(a, bSlot + 1);
    await tick(2);
    expect(a.heard.lockBreaks).toHaveLength(1);
    a.heard.lockBreaks.length = 0;
    // A lock that holds, then breaks when the target runs away out of reach.
    place(room, b, 600, 700, 0);
    lock(a, bSlot + 1);
    await tick(10);
    expect(a.heard.lockBreaks).toHaveLength(0);
    place(room, b, 600 + lockRange(2) + 50, 600, 0);
    await tick(2);
    expect(a.heard.lockBreaks).toHaveLength(1);
    await tick(TICK_RATE * 3);
    expect(w.missiles[aSlot]).toBe(2); // nothing was fired
    // Canceling a lock in progress stops the launch.
    place(room, b, 600, 700, 0);
    lock(a, bSlot + 1);
    await tick(10);
    lock(a, 0);
    await tick(TICK_RATE * 3);
    expect(w.missiles[aSlot]).toBe(2);
  });

  it('are lost with the ship when it sinks, and without a missile there is no lock', async () => {
    const { room, join, tick } = setup();
    const a = await join('Shooter', 'corvette');
    const b = await join('Target', 'corvette');
    await tick(2);
    const w = room.world;
    const aSlot = slotOf(a);
    const bSlot = slotOf(b);
    place(room, a, 600, 600, 0);
    place(room, b, 600, 700, 0);
    lock(a, bSlot + 1);
    await tick(2);
    expect(a.heard.lockBreaks).toHaveLength(1); // no missile on board
    w.missiles[aSlot] = 2;
    lock(a, bSlot + 1);
    await tick(4);
    w.onCollision(bSlot + 1, aSlot + 1, 600, 600, 5, 0, 5, false, true);
    await tick(2);
    expect(w.missiles[aSlot]).toBe(0);
    await tick(TICK_RATE * 3);
    expect(b.heard.missiles).toHaveLength(0);
  });
});

describe('guided missiles can be shot down', () => {
  it('enemy shots take hit points off a missile and destroy it; its own team passes through', async () => {
    const { room, join, tick } = setup();
    const a = await join('Blue', 'corvette'); // blue
    const b = await join('Red', 'corvette'); // red
    await tick(2);
    const w = room.world;
    const aId = a.heard.joined[0]!.entityId;
    const bId = b.heard.joined[0]!.entityId;
    place(room, a, 300, 300, 0);
    place(room, b, 900, 900, 0);
    const set = w.projectiles;
    const missile = set.spawn(1000, 1000, 0, 0.1, 100, 0.45, 80, aId, weaponIndex('missile'), TEAM_BLUE);
    set.hp[missile] = MISSILE.hp;
    // A shot of the missile's own team flies through.
    set.spawn(1004, 1000, Math.PI, 40, 50, 0.3, 20, aId, weaponIndex('cannon_t3'), TEAM_BLUE);
    await tick(2);
    expect(set.hp[missile]).toBe(MISSILE.hp);
    // An enemy shot is stopped by it and takes its damage off.
    set.spawn(1004, 1000, Math.PI, 40, 50, 0.3, 20, bId, weaponIndex('cannon_t3'), TEAM_RED);
    await tick(2);
    expect(set.hp[missile]).toBeCloseTo(MISSILE.hp - 20, 3);
    expect(a.heard.ends.some((e) => e.reason === END_REASON.INTERCEPT)).toBe(true);
    // Another one destroys it.
    const cash = w.cash[bId - 1]!;
    set.spawn(1004, 1000, Math.PI, 40, 50, 0.3, 20, bId, weaponIndex('cannon_t3'), TEAM_RED);
    await tick(2);
    expect(set.active[missile]).toBe(0);
    // The one who shot it down is paid.
    expect(w.cash[bId - 1]).toBe(cash + MISSILE.bounty);
    expect(a.heard.ends.filter((e) => e.reason === END_REASON.INTERCEPT && e.id === missile).length).toBeGreaterThan(0);
  });
});

describe('announcements', () => {
  it('tell the room about rigs taken and lost, the carrier mended and its guns upgraded', async () => {
    const { room, join, tick } = setup({ anyClass: false });
    const a = await join('Owner'); // blue
    const b = await join('Watcher'); // red
    await tick(2);
    const w = room.world;
    const slot = a.heard.joined[0]!.entityId - 1;
    const spot = { x: MATCH.carriers[TEAM_BLUE]!.x, y: MATCH.carriers[TEAM_BLUE]!.y + 40 };
    place(room, a, spot.x, spot.y, 0);
    w.cash[slot] = 5000;
    w.slots[0]!.state.hull = w.slots[0]!.def.hull * 0.5;
    const send = (item: number): void => {
      const wr = new Writer(4);
      encodeBaseBuy(wr, item);
      a.conn.send(wr.toBytes());
    };
    send(BASE_ITEM.REPAIR);
    send(BASE_ITEM.GUNS);
    await tick(3);
    const got = b.heard.announces;
    const repair = got.find((n) => n.kind === ANNOUNCE.CARRIER_REPAIRED)!;
    expect(repair.actor).toBe(slot + 1);
    expect(repair.team).toBe(TEAM_BLUE);
    expect(repair.arg).toBeGreaterThan(50);
    const guns = got.find((n) => n.kind === ANNOUNCE.GUNS_UPGRADED)!;
    expect(guns.arg).toBe(1);
    expect(guns.actor).toBe(slot + 1);
    // A rig taken, then lost again.
    w.rigMeter[0] = 1;
    await tick(2);
    expect(got.some((n) => n.kind === ANNOUNCE.RIG_CAPTURED && n.arg === 0 && n.team === TEAM_BLUE)).toBe(true);
    w.rigMeter[0] = -1;
    await tick(2);
    expect(got.some((n) => n.kind === ANNOUNCE.RIG_LOST && n.arg === 0 && n.team === TEAM_BLUE)).toBe(true);
    expect(got.some((n) => n.kind === ANNOUNCE.RIG_CAPTURED && n.arg === 0 && n.team === TEAM_RED)).toBe(true);
  });
});

describe('emotes', () => {
  const emote = (c: TestClient, id: number): void => {
    const w = new Writer(4);
    encodeEmote(w, id);
    c.conn.send(w.toBytes());
  };

  it('are shown to everyone with the id of the sender ship; pressed during the cooldown, only the latest is shown', async () => {
    const { join, tick } = setup({ anyClass: false });
    const a = await join('Sender');
    const b = await join('Watcher');
    await tick(2);
    const slot = a.heard.joined[0]!.entityId - 1;
    emote(a, 3);
    await tick(2);
    expect(b.heard.emotes.map((e) => [e.id, e.emote])).toEqual([[slot + 1, 3]]);
    expect(a.heard.emotes).toHaveLength(1); // the sender sees it too
    // Three quick presses: the first is already out, of the rest only the last one is shown (later).
    emote(a, 4);
    emote(a, 5);
    emote(a, 6);
    await tick(2);
    expect(b.heard.emotes).toHaveLength(1);
    await tick(Math.ceil(EMOTE.cooldownSec * TICK_RATE) + 2);
    expect(b.heard.emotes.map((e) => e.emote)).toEqual([3, 6]);
    // An id that does not exist is never shown.
    await tick(Math.ceil(EMOTE.cooldownSec * TICK_RATE) + 2);
    emote(a, EMOTE_IDS.length);
    await tick(Math.ceil(EMOTE.cooldownSec * TICK_RATE) + 2);
    expect(b.heard.emotes.map((e) => e.emote)).toEqual([3, 6]);
  });
});
