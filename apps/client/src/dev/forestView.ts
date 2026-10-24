import {
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  Mesh,
  MeshLambertMaterial,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { BufferGeometry, Float32BufferAttribute } from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Dev tool (open /forest-view.html?show=cliffGrey|cliffRed|cliffYellow|tree&top=1): lays the pieces of the cliff and tree
 * pack out in a grid, so they can be looked at. `top=1` looks straight down. Not part of the game.
 */
const log = document.getElementById('log') as HTMLElement;
const params = new URLSearchParams(location.search);
const show = params.get('show') ?? 'cliffGrey';
const top = params.get('top') === '1';

const renderer = new WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
document.body.append(renderer.domElement);
const scene = new Scene();
scene.background = new Color(0x1e566f);
scene.add(new HemisphereLight(0xa9d4f5, 0x2c7898, 1.4), new AmbientLight(0xffffff, 0.3));
const sun = new DirectionalLight(0xfff0d2, 3);
sun.position.set(-30, 50, 20);
scene.add(sun);

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const gltf = await loader.loadAsync('/models/forest_pack.glb');
gltf.scene.updateMatrixWorld(true);
const mat = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide, flatShading: true });
const names: string[] = [];
const group = new Group();
scene.add(group);
let x = 0;
let z = 0;
let rowDepth = 0;
const rowWidth = show === 'tree' ? 70 : 150;
gltf.scene.traverse((o) => {
  const m = o as Mesh;
  if (!m.isMesh || !m.name.startsWith(show === 'tree' ? 'tree' : show)) return;
  // (The packed file stores positions as normalized integers: read them out as plain numbers before moving them.)
  const src = m.geometry as BufferGeometry;
  const pa = src.attributes['position']!;
  const ca = src.attributes['color']!;
  const pos = new Float32Array(pa.count * 3);
  const col = new Float32Array(pa.count * 3);
  for (let i = 0; i < pa.count; i++) {
    pos[i * 3] = pa.getX(i);
    pos[i * 3 + 1] = pa.getY(i);
    pos[i * 3 + 2] = pa.getZ(i);
    col[i * 3] = ca.getX(i);
    col[i * 3 + 1] = ca.getY(i);
    col[i * 3 + 2] = ca.getZ(i);
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new Float32BufferAttribute(col, 3));
  geo.applyMatrix4(m.matrixWorld);
  geo.computeVertexNormals();
  const mesh = new Mesh(geo, mat);
  const b = new Box3().setFromObject(new Mesh(geo));
  const size = b.getSize(new Vector3());
  mesh.position.set(x - b.min.x, 0, z - b.min.z);
  group.add(mesh);
  names.push(`${m.name}  ${size.x.toFixed(1)} x ${size.y.toFixed(1)} x ${size.z.toFixed(1)}`);
  x += size.x + 4;
  rowDepth = Math.max(rowDepth, size.z);
  if (x > rowWidth) {
    x = 0;
    z += rowDepth + 4;
    rowDepth = 0;
  }
});
const camera = new PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 2000);
const mid = new Vector3(rowWidth / 2, 0, z / 2 + 10);
if (top) {
  camera.position.set(mid.x, 260, mid.z + 0.01);
} else {
  camera.position.set(mid.x, 130 + z * 0.4, mid.z + 130 + z * 0.5);
}
camera.lookAt(mid);
renderer.render(scene, camera);
log.textContent = names.join('\n');
(window as unknown as { viewDone: boolean }).viewDone = true;
