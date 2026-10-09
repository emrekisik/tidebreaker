import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Reader, Writer } from './buffer.ts';
import {
  C2S,
  END_REASON,
  EventWriter,
  KIND,
  SnapshotBuilder,
  decodeClient,
  decodeServer,
  encodeHello,
  encodeInput,
  encodeJoined,
  encodeMatch,
  encodePing,
  encodePlay,
  encodePong,
  encodeReject,
  encodeWelcome,
  encodeYouDied,
  newClientMsg,
  newSelfState,
} from './messages.ts';
import type { EnterEntry, ServerHandler, UpdateEntry } from './messages.ts';
import {
  dqAngle16,
  dqAngle8,
  dqAxis,
  dqPos,
  dqSpeed,
  qAngle16,
  qAngle8,
  qAxis,
  qPos,
  qSpeed,
} from './quant.ts';

/** Records every callback as a plain string, for easy comparisons. */
function recorder(): { log: string[]; h: ServerHandler } {
  const log: string[] = [];
  const h: ServerHandler = {
    welcome: (m) => log.push(`welcome ${JSON.stringify(m)}`),
    joined: (...a) => log.push(`joined ${a.join(',')}`),
    match: (...a) => log.push(`match ${a.join(',')}`),
    youDied: (...a) => log.push(`youDied ${a.join(',')}`),
    pong: (...a) => log.push(`pong ${a.join(',')}`),
    reject: (a) => log.push(`reject ${a}`),
    snapshot: (tick, seq, s) => log.push(`snapshot ${tick},${seq},${JSON.stringify(s)}`),
    enter: (e) => log.push(`enter ${JSON.stringify(e)}`),
    update: (u) => log.push(`update ${JSON.stringify(u)}`),
    leave: (id) => log.push(`leave ${id}`),
    projectileSpawn: (...a) => log.push(`spawn ${a.join(',')}`),
    projectileEnd: (...a) => log.push(`end ${a.join(',')}`),
    shipHit: (...a) => log.push(`hit ${a.join(',')}`),
    shipSunk: (...a) => log.push(`sunk ${a.join(',')}`),
    bump: (...a) => log.push(`bump ${a.join(',')}`),
  };
  return { log, h };
}

describe('Writer and Reader', () => {
  it('round-trip every primitive', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: -128, max: 127 }),
        fc.integer({ min: 0, max: 65535 }),
        fc.integer({ min: 0, max: 0xffffffff }),
        fc.float({ noNaN: true, noDefaultInfinity: true, min: -1e6, max: 1e6 }),
        fc.string({ maxLength: 20 }),
        (a, b, c, d, e, s) => {
          const w = new Writer(256);
          w.u8(a);
          w.i8(b);
          w.u16(c);
          w.u32(d);
          w.f32(e);
          w.string(s, 48);
          const r = new Reader(w.toBytes());
          expect(r.u8()).toBe(a);
          expect(r.i8()).toBe(b);
          expect(r.u16()).toBe(c);
          expect(r.u32()).toBe(d);
          expect(r.f32()).toBeCloseTo(e, 0);
          const back = r.string(48);
          expect(r.ok).toBe(true);
          expect(back.length).toBeLessThanOrEqual(s.length + 1);
        },
      ),
    );
  });

  it('writing past the end never throws and reading past the end fails softly', () => {
    const w = new Writer(3);
    w.u32(1);
    expect(w.overflow).toBe(true);
    const r = new Reader(new Uint8Array(2));
    expect(r.u32()).toBe(0);
    expect(r.ok).toBe(false);
    expect(r.u8()).toBe(0);
  });

  it('rejects NaN and infinity floats from the wire', () => {
    const w = new Writer(8);
    w.f32(Number.NaN);
    const r = new Reader(w.toBytes());
    r.f32();
    expect(r.ok).toBe(false);
  });

  it('strings are cut on character boundaries', () => {
    const w = new Writer(64);
    w.string('çççççç', 5); // 2 bytes per character
    const r = new Reader(w.toBytes());
    const back = r.string(48);
    expect(back).toBe('çç');
    expect(r.ok).toBe(true);
  });
});

describe('client messages', () => {
  it('HELLO, PLAY and PING round-trip', () => {
    const w = new Writer(128);
    const m = newClientMsg();
    encodeHello(w);
    expect(decodeClient(w.toBytes(), m)).toBe(C2S.HELLO);
    w.reset();
    encodePlay(w, 'Kaptan Çınar', 3);
    expect(decodeClient(w.toBytes(), m)).toBe(C2S.PLAY);
    expect(m.name).toBe('Kaptan Çınar');
    expect(m.shipId).toBe(3);
    w.reset();
    encodePing(w, 123456);
    expect(decodeClient(w.toBytes(), m)).toBe(C2S.PING);
    expect(m.clientTime).toBe(123456);
  });

  it('INPUT is 9 bytes and round-trips', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 65535 }),
        fc.boolean(),
        fc.integer({ min: -127, max: 127 }),
        fc.integer({ min: -127, max: 127 }),
        fc.integer({ min: 0, max: 65535 }),
        fc.integer({ min: 0, max: 255 }),
        (seq, fire, mx, my, aim, dist) => {
          const w = new Writer(16);
          encodeInput(w, seq, fire, mx, my, aim, dist);
          expect(w.pos).toBe(9);
          const m = newClientMsg();
          expect(decodeClient(w.toBytes(), m)).toBe(C2S.INPUT);
          expect([m.seq, m.fire, m.moveX, m.moveY, m.aim, m.aimDist]).toEqual([
            seq,
            fire,
            mx,
            my,
            aim,
            dist,
          ]);
        },
      ),
    );
  });

  it('truncated or padded messages are rejected', () => {
    const w = new Writer(16);
    encodeInput(w, 5, true, 1, 2, 3, 4);
    const bytes = w.toBytes();
    const m = newClientMsg();
    for (let n = 0; n < bytes.length; n++) expect(decodeClient(bytes.subarray(0, n), m)).toBe(0);
    const padded = new Uint8Array(bytes.length + 1);
    padded.set(bytes);
    expect(decodeClient(padded, m)).toBe(0);
  });

  it('random bytes never throw', () => {
    const m = newClientMsg();
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 80 }), (bytes) => {
        expect(() => decodeClient(bytes, m)).not.toThrow();
      }),
      { numRuns: 2000 },
    );
  });
});

describe('server messages', () => {
  it('simple messages round-trip', () => {
    const { log, h } = recorder();
    const w = new Writer(256);
    const send = (): void => {
      expect(decodeServer(w.toBytes(), h)).toBe(true);
      w.reset();
    };
    encodeWelcome(w, {
      version: 1,
      mapSeed: 99,
      tickRate: 20,
      snapshotEvery: 2,
      serverTimeMs: 5000,
      configHash: 0xdeadbeef,
    });
    send();
    encodeJoined(w, 7, 1, 2);
    send();
    encodeMatch(w, 1, 0, 14, 3, 9);
    send();
    encodeYouDied(w, 4, 'Aaa', 5);
    send();
    encodePong(w, 10, 20);
    send();
    encodeReject(w, 2);
    send();
    expect(log).toEqual([
      'welcome {"version":1,"mapSeed":99,"tickRate":20,"snapshotEvery":2,"serverTimeMs":5000,"configHash":3735928559}',
      'joined 7,1,2',
      'match 1,0,14,3,9',
      'youDied 4,Aaa,5',
      'pong 10,20',
      'reject 2',
    ]);
  });

  it('snapshots round-trip with the documented quantization', () => {
    const b = new SnapshotBuilder();
    b.begin();
    const e: EnterEntry = {
      id: 5,
      kind: KIND.SHIP,
      shipId: 2,
      team: 1,
      x: 123.456,
      y: 987.654,
      heading: 2.5,
      hp: 0.5,
      shield: 1,
      name: 'Deniz',
    };
    b.enter(e);
    b.update(6, 10.1, 20.2, -1, 12.3, 0.25, 0);
    b.leave(9);
    const self = newSelfState();
    self.x = 1.5;
    self.y = 2.5;
    self.heading = 0.75;
    self.speed = -3;
    self.kx = 0.5;
    self.ky = -0.25;
    self.spin = 0.125;
    self.hull = 80;
    self.shield = 20;
    const w = new Writer(512);
    b.finish(w, 4242, 77, self);

    const enters: EnterEntry[] = [];
    const updates: UpdateEntry[] = [];
    const leaves: number[] = [];
    let header = '';
    const { h } = recorder();
    const hh: ServerHandler = {
      ...h,
      snapshot: (tick, seq, s) => {
        header = `${tick},${seq},${s.x},${s.y},${s.heading},${s.speed},${s.kx},${s.ky},${s.spin},${s.hull},${s.shield}`;
      },
      enter: (x) => enters.push({ ...x }),
      update: (x) => updates.push({ ...x }),
      leave: (id) => leaves.push(id),
    };
    expect(decodeServer(w.toBytes(), hh)).toBe(true);
    expect(header).toBe('4242,77,1.5,2.5,0.75,-3,0.5,-0.25,0.125,80,20');
    expect(enters).toHaveLength(1);
    expect(enters[0]!.name).toBe('Deniz');
    expect(Math.abs(enters[0]!.x - 123.456)).toBeLessThan(1 / 32 + 1e-9);
    expect(Math.abs(enters[0]!.y - 987.654)).toBeLessThan(1 / 32 + 1e-9);
    expect(updates[0]!.id).toBe(6);
    expect(Math.abs(updates[0]!.speed - 12.3)).toBeLessThan(1 / 12 + 1e-9);
    expect(leaves).toEqual([9]);
  });

  it('an UPDATE entry is 10 bytes (bandwidth budget)', () => {
    const b = new SnapshotBuilder();
    const w1 = new Writer(256);
    const self = newSelfState();
    b.begin();
    b.finish(w1, 1, 1, self);
    const base = w1.pos;
    b.begin();
    b.update(1, 1, 1, 0, 0, 1, 1);
    const w2 = new Writer(256);
    b.finish(w2, 1, 1, self);
    expect(w2.pos - base).toBe(10);
  });

  it('events round-trip', () => {
    const ev = new EventWriter();
    ev.begin(100);
    ev.projectileSpawn(12, 3, 4, 50.25, 60.5, 1.0);
    ev.projectileEnd(12, END_REASON.HIT_SHIP, 51, 61);
    ev.shipHit(8, 3, 16.4, true, 4, 51, 61);
    ev.shipSunk(8, 3, 51, 61);
    ev.bump(8, 0xffff, 40, 41, 5.5);
    expect(ev.finish()).toBe(true);
    const { log, h } = recorder();
    expect(decodeServer(ev.w.toBytes(), h)).toBe(true);
    expect(log).toEqual([
      `spawn 100,12,3,4,50.25,60.5,${dqAngle16(qAngle16(1.0))}`,
      'end 100,12,0,51,61',
      'hit 100,8,3,16,true,4,51,61',
      'sunk 100,8,3,51,61',
      'bump 100,8,65535,40,41,5.5',
    ]);
  });

  it('an empty event message reports nothing to send', () => {
    const ev = new EventWriter();
    ev.begin(1);
    expect(ev.finish()).toBe(false);
  });

  it('every truncation of a valid snapshot or events message fails softly', () => {
    const b = new SnapshotBuilder();
    b.begin();
    b.enter({
      id: 1,
      kind: 0,
      shipId: 0,
      team: 0,
      x: 1,
      y: 2,
      heading: 0,
      hp: 1,
      shield: 1,
      name: 'A',
    });
    b.update(2, 3, 4, 0, 0, 1, 1);
    b.leave(3);
    const w = new Writer(256);
    b.finish(w, 1, 1, newSelfState());
    const ev = new EventWriter();
    ev.begin(1);
    ev.shipSunk(1, 2, 3, 4);
    ev.finish();
    const { h } = recorder();
    for (const bytes of [w.toBytes(), ev.w.toBytes()]) {
      expect(decodeServer(bytes, h)).toBe(true);
      for (let n = 0; n < bytes.length; n++) {
        expect(decodeServer(bytes.subarray(0, n), h)).toBe(false);
      }
    }
  });

  it('random bytes and lying counts never throw or hang', () => {
    const { h } = recorder();
    fc.assert(
      fc.property(
        fc.uint8Array({ maxLength: 120 }),
        fc.integer({ min: 0x81, max: 0x8b }),
        (bytes, type) => {
          const data = new Uint8Array(bytes.length + 1);
          data[0] = type;
          data.set(bytes, 1);
          expect(() => decodeServer(data, h)).not.toThrow();
        },
      ),
      { numRuns: 3000 },
    );
    // A snapshot that claims 255 entries of each kind with no data behind it.
    const w = new Writer(64);
    w.u8(0x82);
    w.u32(1);
    w.u16(1);
    for (let i = 0; i < 7; i++) w.f32(0);
    w.u16(0);
    w.u16(0);
    w.u8(255);
    w.u8(255);
    w.u8(255);
    expect(decodeServer(w.toBytes(), h)).toBe(false);
  });
});

describe('quantization', () => {
  it('positions are within 1/32 unit', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1100, noNaN: true }), (v) => {
        expect(Math.abs(dqPos(qPos(v)) - v)).toBeLessThanOrEqual(1 / 32 + 1e-9);
      }),
    );
  });

  it('angles are within half a step', () => {
    const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
    fc.assert(
      fc.property(fc.double({ min: -20, max: 20, noNaN: true }), (a) => {
        expect(Math.abs(wrap(dqAngle8(qAngle8(a)) - a))).toBeLessThanOrEqual(Math.PI / 256 + 1e-9);
        expect(Math.abs(wrap(dqAngle16(qAngle16(a)) - a))).toBeLessThanOrEqual(
          Math.PI / 65536 + 1e-9,
        );
      }),
    );
  });

  it('axes and speeds clamp and stay close', () => {
    expect(qAxis(5)).toBe(127);
    expect(qAxis(-5)).toBe(-127);
    expect(dqAxis(qAxis(0.5))).toBeCloseTo(0.5, 2);
    expect(Math.abs(dqSpeed(qSpeed(13.37)) - 13.37)).toBeLessThan(1 / 12 + 1e-9);
    expect(qSpeed(1000)).toBe(127);
  });
});
