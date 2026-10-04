import { createServer } from 'node:http';
import { TICK_RATE } from '@tidebreaker/shared/config';

const port = Number(process.env['PORT'] ?? 9001);

const server = createServer((req, res) => {
  if (req.url === '/status') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ room: 'dev', tickRate: TICK_RATE, players: 0 }));
    return;
  }
  res.writeHead(404).end();
});

server.listen(port, () => {
  console.log(`server shell listening on :${port}`);
});
