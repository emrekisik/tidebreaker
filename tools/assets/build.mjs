// Optimizes source GLB models (GAME_DESIGN.md §12.5): `models/*.glb` -> `apps/client/public/models/*.glb`.
//   - drops the pack's "floor" helper plane
//   - shrinks the shared color atlas (it is a smooth palette, so 256 px loses nothing visible)
//   - prunes/dedupes and applies meshopt compression
// Node names, transforms and pivots are left untouched: the client reads turret pivots from them.
// Each part keeps its exported node as a pure transform node; its mesh sits in a child node.
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, textureCompress } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const srcDir = join(root, 'models');
const outDir = join(root, 'apps/client/public/models');
// `--if-needed`: used before dev/build; does nothing when the sources are missing or the outputs
// are already newer than both the sources and this script.
const ifNeeded = process.argv.includes('--if-needed');
if (ifNeeded && !existsSync(srcDir)) {
  console.log('assets: no models/ folder, skipping (placeholders will be used)');
  process.exit(0);
}

const SKIP = new Set(['aircraft_carrier.glb']);
const ATLAS_PX = 256;

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

mkdirSync(outDir, { recursive: true });
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
let total = 0;

for (const file of readdirSync(srcDir)
  .filter((f) => f.endsWith('.glb'))
  .sort()) {
  if (SKIP.has(file)) continue;
  if (ifNeeded) {
    const out = join(outDir, file);
    const newest = Math.max(
      statSync(join(srcDir, file)).mtimeMs,
      statSync(fileURLToPath(import.meta.url)).mtimeMs,
    );
    if (existsSync(out) && statSync(out).mtimeMs >= newest) continue;
  }
  const doc = await io.read(join(srcDir, file));
  const sceneRoot = doc.getRoot();

  for (const node of sceneRoot.listNodes()) {
    if (node.getName() === 'floor') {
      const mesh = node.getMesh();
      node.dispose();
      mesh?.dispose();
    }
  }

  // Move every mesh into a child node. Quantization (part of meshopt) rewrites the transform of
  // the node that holds a mesh; doing this keeps the named node's origin, i.e. the turret pivot.
  for (const node of sceneRoot.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const child = doc.createNode(`${node.getName()}.mesh`).setMesh(mesh);
    node.setMesh(null);
    node.addChild(child);
  }

  await doc.transform(
    prune(),
    dedup(),
    textureCompress({
      encoder: sharp,
      targetFormat: 'jpeg',
      resize: [ATLAS_PX, ATLAS_PX],
      quality: 90,
    }),
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  );

  const out = join(outDir, file);
  await io.write(out, doc);
  const size = statSync(out).size;
  total += size;
  const tris = sceneRoot
    .listMeshes()
    .flatMap((m) => m.listPrimitives())
    .reduce((n, p) => n + (p.getIndices()?.getCount() ?? 0) / 3, 0);
  console.log(
    `${file.padEnd(20)} ${kb(statSync(join(srcDir, file)).size).padStart(10)} -> ${kb(size).padStart(9)}  ${tris} tris`,
  );
}
console.log(`total output ${kb(total)} (budget: models <= 400 KB)`);
