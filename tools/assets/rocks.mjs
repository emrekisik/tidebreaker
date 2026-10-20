// Converts the rock pack `models/rocks.fbx` (+ `models/Textures/color_atlas.png`) into `models/rocks_pack.glb`
// (GAME_DESIGN.md §12.5), which `build.mjs` then optimizes like every other model.
//   - one node per rock (the FBX name), centered on x/z with its lowest point at y = 0, units as in the FBX
//   - the pack's color atlas is a flat palette, so it is baked into per-face vertex colors (linear): no texture
//     and no UVs in the result, and the client can merge the rocks into its flat-shaded island meshes
// `--if-needed`: does nothing when the source is missing or the output is newer than the source and this script.
import { existsSync, readFileSync, statSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const fbxFile = join(root, 'models/rocks.fbx');
const atlasFile = join(root, 'models/Textures/color_atlas.png');
const outFile = join(root, 'models/rocks_pack.glb');

if (!existsSync(fbxFile) || !existsSync(atlasFile)) {
  console.log('rocks: models/rocks.fbx or models/Textures/color_atlas.png is missing, skipping');
  process.exit(0);
}
if (process.argv.includes('--if-needed') && existsSync(outFile)) {
  const newest = Math.max(
    statSync(fbxFile).mtimeMs,
    statSync(atlasFile).mtimeMs,
    statSync(fileURLToPath(import.meta.url)).mtimeMs,
  );
  if (statSync(outFile).mtimeMs >= newest) process.exit(0);
}

// three's FBXLoader wants a DOM only to create <img> elements for textures; the atlas is read from the file here.
globalThis.document = {
  createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, style: {}, set src(_v) {} }),
};
const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

const atlas = await sharp(atlasFile).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: aw, height: ah } = atlas.info;
const texel = (u, v) => {
  const x = Math.min(aw - 1, Math.max(0, Math.floor(u * aw)));
  const y = Math.min(ah - 1, Math.max(0, Math.floor((1 - v) * ah)));
  const o = (y * aw + x) * 3;
  return [atlas.data[o], atlas.data[o + 1], atlas.data[o + 2]];
};

const bytes = readFileSync(fbxFile);
const scene = new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
scene.updateMatrixWorld(true);

const doc = new Document();
const buffer = doc.createBuffer();
const sceneNode = doc.createScene('rocks');
const material = doc.createMaterial('rock');
let meshes = 0;
let tris = 0;
const meshesIn = [];
scene.traverse((o) => {
  if (o.isMesh) meshesIn.push(o);
});
meshesIn.sort((a, b) => a.name.localeCompare(b.name));
// (Pebbles, debris and the low wall pieces are not used by the game.)
const USED = (name) => !/^(pebbles|debris|rockwall)/.test(name);

for (const m of meshesIn) {
  if (!USED(m.name)) continue;
  const g = m.geometry.clone();
  g.applyMatrix4(m.matrixWorld);
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  const index = g.index;
  const corners = index ? index.count : pos.count;
  const at = (c) => (index ? index.getX(c) : c);
  // Center on x/z, lowest point at y = 0.
  g.computeBoundingBox();
  const b = g.boundingBox;
  const cx = (b.min.x + b.max.x) / 2;
  const cz = (b.min.z + b.max.z) / 2;
  const positions = new Float32Array(corners * 3);
  const colors = new Float32Array(corners * 3);
  for (let c = 0; c < corners; c += 3) {
    // The pack's atlas is a palette: one color per face (the average of its three corners).
    let r = 0;
    let gr = 0;
    let bl = 0;
    for (let k = 0; k < 3; k++) {
      const i = at(c + k);
      const [tr, tg, tb] = texel(uv.getX(i), uv.getY(i));
      r += tr;
      gr += tg;
      bl += tb;
    }
    const lin = [r, gr, bl].map((s) => srgbToLinear(s / 3 / 255));
    for (let k = 0; k < 3; k++) {
      const i = at(c + k);
      positions[(c + k) * 3] = pos.getX(i) - cx;
      positions[(c + k) * 3 + 1] = pos.getY(i) - b.min.y;
      positions[(c + k) * 3 + 2] = pos.getZ(i) - cz;
      colors[(c + k) * 3] = lin[0];
      colors[(c + k) * 3 + 1] = lin[1];
      colors[(c + k) * 3 + 2] = lin[2];
    }
  }
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(positions).setBuffer(buffer))
    .setAttribute('COLOR_0', doc.createAccessor().setType('VEC3').setArray(colors).setBuffer(buffer))
    .setMaterial(material);
  const mesh = doc.createMesh(m.name).addPrimitive(prim);
  sceneNode.addChild(doc.createNode(m.name).setMesh(mesh));
  meshes++;
  tris += corners / 3;
}

mkdirSync(dirname(outFile), { recursive: true });
await new NodeIO().write(outFile, doc);
console.log(`rocks: ${meshes} rocks, ${tris} triangles -> models/rocks_pack.glb (${(statSync(outFile).size / 1024).toFixed(0)} KB)`);
