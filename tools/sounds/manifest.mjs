// Builds apps/client/public/sounds/manifest.json from the sound files in that folder.
//
// Name a file after the sound id (see apps/client/src/audio/recipes.ts, or the buttons of /sounds.html):
//   cannon.ogg            -> replaces the cannon sound
//   cannon_1.ogg, cannon_2.ogg  -> two takes of it (one is picked at random each time)
//   ambient_sea.ogg       -> the sea loop     engine.ogg -> the engine loop
// Files whose name matches no sound are listed as a warning. Run: pnpm sounds (also part of pnpm dev).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dir = path.join(root, 'apps/client/public/sounds');
const recipes = fs.readFileSync(path.join(root, 'apps/client/src/audio/recipes.ts'), 'utf8');
const ids = new Set(['ambient_sea', 'engine']);
for (const m of recipes.matchAll(/^ {2}(\w+): \{$/gm)) ids.add(m[1]);

const manifest = {};
const unknown = [];
for (const file of fs.readdirSync(dir).sort()) {
  const m = /^(.+?)(?:_(\d+))?\.(ogg|mp3|wav|m4a)$/i.exec(file);
  if (!m) continue;
  const id = ids.has(m[1] + (m[2] ? `_${m[2]}` : '')) ? m[1] + (m[2] ? `_${m[2]}` : '') : m[1];
  if (!ids.has(id)) {
    unknown.push(file);
    continue;
  }
  (manifest[id] ??= []).push(file);
}
// (Gain and pitch per sound: edit manifest.json by hand after this, e.g. { "files": ["a.ogg"], "gain": 0.7 };
// this script keeps entries that already have extras.)
const out = path.join(dir, 'manifest.json');
let old = {};
try {
  old = JSON.parse(fs.readFileSync(out, 'utf8'));
} catch {
  // none yet
}
for (const [id, files] of Object.entries(manifest)) {
  const prev = old[id];
  if (prev && typeof prev === 'object' && !Array.isArray(prev)) manifest[id] = { ...prev, files };
}
fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n');
console.log(`sounds: ${Object.keys(manifest).length} replaced by files${unknown.length ? `; unknown names: ${unknown.join(', ')}` : ''}`);
