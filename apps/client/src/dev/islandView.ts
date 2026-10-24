import {
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  WebGLRenderer,
} from 'three';
import { CAMERA, DEG2RAD, FX, generateMap } from '@tidebreaker/shared';
import { AssetProvider } from '../render/assets.ts';
import { IslandView } from '../render/islands.ts';

/**
 * Dev tool (open /island-view.html?seed=1337&i=3&pitch=58&dist=2.6): draws island `i` of the map of a seed the way the
 * game does (same light, same camera angle), to check how the island generator looks. `i` may be a list ("3,4,5"): they
 * are drawn one after the other (one picture each, press nothing: read `window.shot(k)`). Not part of the game.
 */
const log = document.getElementById('log') as HTMLElement;
const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed') ?? 1337);
const list = (params.get('i') ?? '0').split(',').map(Number);
const pitch = Number(params.get('pitch') ?? CAMERA.pitchDeg);
const dist = Number(params.get('dist') ?? 2.6);

const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(innerWidth, innerHeight);
document.body.append(renderer.domElement);
const scene = new Scene();
scene.background = new Color(0x1e566f);
const L = FX.light;
const sun = new DirectionalLight(L.sunColor, L.sunIntensity);
sun.position.set(...L.sunDir).multiplyScalar(300);
scene.add(sun, sun.target, new HemisphereLight(L.skyColor, L.groundColor, L.hemiIntensity));
const sea = new Mesh(new PlaneGeometry(4000, 4000), new MeshBasicMaterial({ color: 0x347392 }));
sea.rotation.x = -Math.PI / 2;
sea.position.y = -0.3;
scene.add(sea);

const assets = new AssetProvider();
await assets.preloadRocks();
await assets.preloadForest();
const map = generateMap(seed);
const view = new IslandView(map, [], assets.rocks(), assets.forest());
for (const o of view.objects) scene.add(o);

const camera = new PerspectiveCamera(CAMERA.fovDeg, innerWidth / innerHeight, 1, 1500);
const types = ['port', 'fort', 'treasure', 'flat'];
function shot(k: number): string {
  const i = list[k]!;
  const cx = map.islandX[i]!;
  const cz = map.islandY[i]!;
  const R = map.islandR[i]!;
  const d = R * dist + 25;
  camera.position.set(cx, d * Math.sin(pitch * DEG2RAD), cz + d * Math.cos(pitch * DEG2RAD));
  camera.lookAt(cx, 0, cz);
  view.update(0);
  renderer.render(scene, camera);
  log.textContent = `seed ${seed}  island ${i} (${types[map.islandType[i]!]}) radius ${R.toFixed(1)}  pitch ${pitch}`;
  return log.textContent;
}
(window as unknown as { shot: (k: number) => string }).shot = shot;
shot(0);
