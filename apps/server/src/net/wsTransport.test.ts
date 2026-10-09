import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { Writer, decodeServer, encodeHello, S2C } from '@tidebreaker/shared';
import type { ServerHandler } from '@tidebreaker/shared';
import { Room } from '../room/room.ts';
import { WsTransport } from './wsTransport.ts';

let room: Room | null = null;
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  await room?.stop();
  room = null;
});

async function boot(maxPerIp = 4): Promise<{ port: number }> {
  const transport = new WsTransport({
    port: 0,
    allowedOrigins: ['http://localhost:5173'],
    requireOrigin: false,
    maxConnectionsPerIp: maxPerIp,
    status: () => room?.status() ?? {},
  });
  room = new Room({ transport, seed: 1337 });
  await room.start();
  return { port: transport.port };
}

function open(port: number, origin?: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, origin ? { origin } : {});
    sockets.push(ws);
    ws.binaryType = 'nodebuffer';
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function nextMessage(ws: WebSocket): Promise<Uint8Array> {
  return new Promise((resolve) => {
    ws.once('message', (data: Buffer) => resolve(new Uint8Array(data)));
  });
}

describe('WebSocket transport', () => {
  it('speaks the protocol over a real socket and serves /status', async () => {
    const { port } = await boot();
    const ws = await open(port, 'http://localhost:5173');
    const w = new Writer(8);
    encodeHello(w);
    const reply = nextMessage(ws);
    ws.send(w.toBytes());
    const bytes = await reply;
    expect(bytes[0]).toBe(S2C.WELCOME);
    let seed = 0;
    const h = {
      welcome: (m: { mapSeed: number }) => (seed = m.mapSeed),
    } as unknown as ServerHandler;
    expect(decodeServer(bytes, h)).toBe(true);
    expect(seed).toBe(1337);

    const res = await fetch(`http://127.0.0.1:${port}/status`);
    const status = (await res.json()) as { room: string; accepting: boolean };
    expect(status.accepting).toBe(true);
    expect(status.room).toBe('room-1');
  });

  it('refuses a foreign Origin', async () => {
    const { port } = await boot();
    await expect(open(port, 'http://evil.example')).rejects.toThrow();
  });

  it('caps connections per IP', async () => {
    const { port } = await boot(2);
    await open(port, 'http://localhost:5173');
    await open(port, 'http://localhost:5173');
    await expect(open(port, 'http://localhost:5173')).rejects.toThrow();
  });

  it('closes a connection that sends an oversized message', async () => {
    const { port } = await boot();
    const ws = await open(port, 'http://localhost:5173');
    const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)));
    ws.send(new Uint8Array(2000));
    expect(await closed).toBe(1009);
  });
});
