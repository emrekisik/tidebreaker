// Receives the PNGs drawn by apps/client/ship-icons.html (dev server) and writes them to
// apps/client/public/icons/ships/. Run `pnpm icons`, then open http://localhost:5173/ship-icons.html
// (the client dev server must be running). Stops itself a few seconds after the last icon.
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = join(root, 'apps/client/public/icons/ships');
let idle;
const server = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.end();
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.searchParams.get('path') ?? '';
  // Only plain "orientation/color/name.png" under the output directory.
  if (!/^[a-z]+\/[a-z]+\/[a-z0-9_]+\.png$/.test(path)) {
    res.statusCode = 400;
    return res.end('bad path');
  }
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const text = Buffer.concat(chunks).toString('utf8');
    const png = Buffer.from(text.replace(/^data:image\/png;base64,/, ''), 'base64');
    const file = join(outDir, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, png);
    console.log(`saved ${path} (${png.length} bytes)`);
    res.end('ok');
    clearTimeout(idle);
    idle = setTimeout(() => server.close(), 8000);
  });
});
server.listen(9099, () => console.log(`icon saver on :9099, writing to ${outDir}`));
