// Imports recorded sound effects from a source folder (default: ./sfx) into apps/client/public/sounds.
//
// Each source file is mapped to a sound id below, then cleaned with ffmpeg: silence cut at both ends, mono,
// peak at -3 dB, a short fade-out, Vorbis. The result is named after the sound id (cannon.ogg, hit_hull_1.ogg, ...) and
// manifest.json is rebuilt with the per-sound extras (gain / pitch) from the table.
// Run: node tools/sounds/import.mjs [source-folder]      (needs ffmpeg on the PATH)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const src = path.resolve(process.argv[2] ?? path.join(root, 'sfx'));
const dir = path.join(root, 'apps/client/public/sounds');

/** source file (without extension) -> [output name, extras written to manifest.json for that sound id] */
const MAP = {
  cannon: ['cannon', { gain: 0.85 }],
  'cannon-hit-water': ['splash', { gain: 0.8 }],
  'missile-hit-water': ['splash_big', { gain: 0.8 }],
  cannonhit1: ['hit_cannon_1', { gain: 0.8 }],
  cannonhit2: ['hit_cannon_2', { gain: 0.8 }],
  hit1: ['hit_hull_1', { gain: 0.7 }],
  hit2: ['hit_hull_2', { gain: 0.7 }],
  hit3: ['hit_hull_3', { gain: 0.7 }],
  'hit-machinegun1': ['hit_hull_4', { gain: 0.7 }],
  'missile-hit1': ['hit_missile', { gain: 0.85 }],
  destruction: ['sink', { gain: 0.75 }],
  missile1: ['rocket_launch_1', { gain: 0.75 }],
  missile2: ['rocket_launch_2', { gain: 0.75 }],
  // (the guided missile gets the same two takes, a little lower)
  'missile1>': ['missile_launch_1', { gain: 0.7, pitch: 0.92 }],
  'missile2>': ['missile_launch_2', { gain: 0.7, pitch: 0.92 }],
  'missile-long-range': ['heavy_launch', { gain: 0.75 }],
  'ship-collision1': ['bump_1', { gain: 0.85 }],
  'ship-collision2': ['bump_2', { gain: 0.85 }],
};

const CLEAN =
  'silenceremove=start_periods=1:start_threshold=-55dB:start_silence=0.01,' +
  'areverse,silenceremove=start_periods=1:start_threshold=-60dB:start_silence=0.05,areverse';

function ffmpeg(args) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-y', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr.split('\n').slice(-6).join('\n')}`);
  return r.stderr;
}

/** The loudest sample of a clip, in dB. */
function peak(file) {
  const log = ffmpeg(['-i', file, '-af', 'volumedetect', '-f', 'null', '-']);
  const m = /max_volume: (-?[\d.]+) dB/.exec(log);
  return m ? Number(m[1]) : 0;
}

const extras = {};
let total = 0;
for (const [key, [name, extra]] of Object.entries(MAP)) {
  const file = path.join(src, key.replace(/>$/, '') + '.mp3');
  if (!fs.existsSync(file)) {
    console.warn(`missing: ${path.basename(file)}`);
    continue;
  }
  const tmp = path.join(dir, `.tmp-${name}.wav`);
  ffmpeg(['-i', file, '-af', `${CLEAN},pan=mono|c0=0.5*c0+0.5*c1`, tmp]);
  const gain = -3 - peak(tmp);
  const out = path.join(dir, `${name}.ogg`);
  const dur = Number(/Duration: (\d+):(\d+):([\d.]+)/.exec(ffmpeg(['-i', tmp, '-f', 'null', '-']))?.slice(1).reduce((a, v) => a * 60 + Number(v), 0));
  ffmpeg(['-i', tmp, '-af', `volume=${gain.toFixed(2)}dB,afade=t=out:st=${Math.max(0, dur - 0.04).toFixed(3)}:d=0.04`, '-ar', '44100', '-c:a', 'libvorbis', '-q:a', '3', out]);
  fs.rmSync(tmp);
  total += fs.statSync(out).size;
  const id = name.replace(/_\d+$/, '');
  extras[id] = { ...extras[id], ...extra };
  console.log(`${path.basename(file)} -> ${name}.ogg (${dur.toFixed(2)} s, ${fs.statSync(out).size} bytes)`);
}
console.log(`total ${(total / 1024).toFixed(0)} KB`);

// Rebuild manifest.json from the files, then add the extras.
const manifestScript = path.join(root, 'tools/sounds/manifest.mjs');
const r = spawnSync(process.execPath, [manifestScript], { encoding: 'utf8' });
process.stdout.write(r.stdout);
const manifestFile = path.join(dir, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
for (const [id, extra] of Object.entries(extras)) {
  const entry = manifest[id];
  if (!entry) continue;
  manifest[id] = { files: Array.isArray(entry) ? entry : entry.files, ...extra };
}
fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
