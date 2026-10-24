// Converts the cliff and tree packs (COLLADA files with a small color sheet each) into `models/forest_pack.glb`
// (GAME_DESIGN.md §12.5), which `build.mjs` then optimizes like every other model.
//   source: models are read from `cliffmodels/` and `treemodels/` in the repo root (not committed: purchased packs)
//   - `cliffGrey_<Tile>`: the cliff and rock tiles (grass on top, grey rock below) in the pack's own coordinates (a
//     tile is 20 wide along x, its front toward +z, 15 tall); the Red and Yellow sheets are sandy and are not used
//   - `tree_<Type>_<N>`: the trees centered on x/z with their foot at y = 0 (the normal color sheet); the very detailed
//     ones (more than `MAX_TREE_TRIS` triangles) are left out, an island has many trees
//   - the color sheets are flat palettes (15x15 or 16x16 swatches), so they are baked into per-face vertex colors
//     (linear): no texture and no UVs in the result, and the client merges the pieces into its flat-shaded island meshes
// `--if-needed`: does nothing when the sources are missing or the output is newer than all of them and this script.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const cliffDir = join(root, 'cliffmodels');
const treeDir = join(root, 'treemodels');
const outFile = join(root, 'models/forest_pack.glb');

if (!existsSync(join(cliffDir, 'Models')) || !existsSync(join(treeDir, 'Models'))) {
  console.log('forest: cliffmodels/ or treemodels/ is missing, skipping');
  process.exit(0);
}
const files = (dir, ext) =>
  readdirSync(dir)
    .filter((f) => f.endsWith(ext))
    .sort()
    .map((f) => join(dir, f));
const sources = [...files(join(cliffDir, 'Models'), '.dae'), ...files(join(treeDir, 'Models'), '.dae'), ...files(join(cliffDir, 'Textures'), '.png'), ...files(join(treeDir, 'Textures'), '.png')];
if (process.argv.includes('--if-needed') && existsSync(outFile)) {
  const newest = Math.max(...sources.map((f) => statSync(f).mtimeMs), statSync(fileURLToPath(import.meta.url)).mtimeMs);
  if (statSync(outFile).mtimeMs >= newest) process.exit(0);
}

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

/** A palette sheet: a function from UV to the linear color of the swatch under it. */
async function palette(file) {
  const img = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = img.info;
  return (u, v) => {
    const x = Math.min(w - 1, Math.max(0, Math.floor(u * w)));
    const y = Math.min(h - 1, Math.max(0, Math.floor((1 - v) * h)));
    const o = (y * w + x) * 3;
    return [img.data[o], img.data[o + 1], img.data[o + 2]].map((c) => srgbToLinear(c / 255));
  };
}

/**
 * Reads the one mesh of a COLLADA file written by Blender (a `polylist` with POSITION, NORMAL and TEXCOORD inputs) and
 * returns its triangles: positions (3 numbers per corner) and UVs (2 per corner). The mesh data is already Y-up
 * (the node's matrix only turns it for a Z-up scene), so the node matrix is ignored.
 */
function parseDae(text) {
  const arrays = {};
  for (const m of text.matchAll(/<source id="([^"]+)">\s*<float_array id="[^"]+" count="\d+">([^<]*)<\/float_array>/g)) {
    arrays[m[1]] = m[2].trim().split(/\s+/).map(Number);
  }
  const vertices = text.match(/<vertices id="([^"]+)">\s*<input semantic="POSITION" source="#([^"]+)"/);
  if (!vertices) throw new Error('no vertices');
  const poly = text.match(/<polylist[^>]*>([\s\S]*?)<\/polylist>/);
  if (!poly) throw new Error('no polylist');
  const body = poly[1];
  const inputs = {};
  let stride = 0;
  for (const m of body.matchAll(/<input semantic="(\w+)" source="#([^"]+)" offset="(\d+)"/g)) {
    inputs[m[1]] = { source: m[2] === vertices[1] ? vertices[2] : m[2], offset: Number(m[3]) };
    stride = Math.max(stride, Number(m[3]) + 1);
  }
  const vcount = body.match(/<vcount>([^<]*)<\/vcount>/)[1].trim().split(/\s+/).map(Number);
  const p = body.match(/<p>([^<]*)<\/p>/)[1].trim().split(/\s+/).map(Number);
  const pos = arrays[inputs.VERTEX.source];
  const uv = arrays[inputs.TEXCOORD.source];
  const positions = [];
  const uvs = [];
  let at = 0;
  const corner = (c) => {
    const vi = p[(at + c) * stride + inputs.VERTEX.offset];
    const ti = p[(at + c) * stride + inputs.TEXCOORD.offset];
    positions.push(pos[vi * 3], pos[vi * 3 + 1], pos[vi * 3 + 2]);
    uvs.push(uv[ti * 2], uv[ti * 2 + 1]);
  };
  for (const n of vcount) {
    // A polygon of n corners is cut into a fan of triangles.
    for (let k = 1; k < n - 1; k++) {
      corner(0);
      corner(k);
      corner(k + 1);
    }
    at += n;
  }
  return { positions, uvs };
}

/** Trees with more triangles than this are skipped. */
const MAX_TREE_TRIS = 1000;

const doc = new Document();
const buffer = doc.createBuffer();
const scene = doc.createScene('forest');
const material = doc.createMaterial('forest');
let pieces = 0;
let tris = 0;

/** Adds one piece: `center`: center it on x/z and put its lowest point at y = 0 (trees); otherwise keep the pack's own coordinates. */
function addPiece(name, mesh, color, center) {
  const { positions, uvs } = mesh;
  const n = positions.length / 3;
  let minY = Infinity;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, positions[i * 3]);
    maxX = Math.max(maxX, positions[i * 3]);
    minY = Math.min(minY, positions[i * 3 + 1]);
    minZ = Math.min(minZ, positions[i * 3 + 2]);
    maxZ = Math.max(maxZ, positions[i * 3 + 2]);
  }
  const cx = center ? (minX + maxX) / 2 : 0;
  const cz = center ? (minZ + maxZ) / 2 : 0;
  const base = center ? minY : 0;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  for (let f = 0; f < n; f += 3) {
    // The sheets are palettes: one color per face (the average of its three corners).
    let r = 0;
    let g = 0;
    let b = 0;
    for (let k = 0; k < 3; k++) {
      const c = color(uvs[(f + k) * 2], uvs[(f + k) * 2 + 1]);
      r += c[0];
      g += c[1];
      b += c[2];
    }
    for (let k = 0; k < 3; k++) {
      const i = f + k;
      pos[i * 3] = positions[i * 3] - cx;
      pos[i * 3 + 1] = positions[i * 3 + 1] - base;
      pos[i * 3 + 2] = positions[i * 3 + 2] - cz;
      col[i * 3] = r / 3;
      col[i * 3 + 1] = g / 3;
      col[i * 3 + 2] = b / 3;
    }
  }
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buffer))
    .setAttribute('COLOR_0', doc.createAccessor().setType('VEC3').setArray(col).setBuffer(buffer))
    .setMaterial(material);
  scene.addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim)));
  pieces++;
  tris += n / 3;
}

const clean = (file) => file.replace(/^.*[\\/]/, '').replace(/\.dae$/, '').replace(/\s+/g, '_');

for (const sheet of ['Grey']) {
  const color = await palette(join(cliffDir, 'Textures', `Colorscheme ${sheet}.png`));
  for (const f of files(join(cliffDir, 'Models'), '.dae')) {
    addPiece(`cliff${sheet}_${clean(f)}`, parseDae(readFileSync(f, 'utf8')), color, false);
  }
}
const treeColor = await palette(join(treeDir, 'Textures', 'Colorsheet Tree Normal.png'));
for (const f of files(join(treeDir, 'Models'), '.dae')) {
  const mesh = parseDae(readFileSync(f, 'utf8'));
  if (mesh.positions.length / 9 > MAX_TREE_TRIS) continue;
  addPiece(`tree_${clean(f).replace(/^Tree_/, '')}`, mesh, treeColor, true);
}

mkdirSync(dirname(outFile), { recursive: true });
await new NodeIO().write(outFile, doc);
console.log(`forest: ${pieces} pieces, ${tris} triangles -> models/forest_pack.glb (${(statSync(outFile).size / 1024).toFixed(0)} KB)`);
