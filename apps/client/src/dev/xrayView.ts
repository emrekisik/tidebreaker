import {
  AlwaysDepth,
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
import { CAMERA, COUNTRIES, DEG2RAD, FX, SHIPS, generateMap } from '@tidebreaker/shared';
import type { ShipId } from '@tidebreaker/shared';
import { AssetProvider } from '../render/assets.ts';
import { IslandView } from '../render/islands.ts';
import { XRay } from '../render/xray.ts';
import type { ShaderMaterial } from 'three';

/**
 * Dev tool (open /xray-view.html?seed=1337&i=3&a=0&b=1): an island of the map with ships behind it (to the north, where
 * the camera cannot see them) and in front of it, drawn the way the game draws them, to check the X-ray silhouettes.
 * `a` and `b` are the countries (0-4) of the two teams; `always=1` draws all silhouettes. Not part of the game.
 */
const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed') ?? 1337);
const island = Number(params.get('i') ?? 3);
const pitch = Number(params.get('pitch') ?? CAMERA.pitchDeg);
const dist = Number(params.get('dist') ?? 1.7);
const ca = COUNTRIES[Number(params.get('a') ?? 0)]!;
const cb = COUNTRIES[Number(params.get('b') ?? 1)]!;

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
const ids: ShipId[] = ['coast_guard_boat', 'gunboat', 'corvette', 'frigate', 'cruiser', 'heavy_frigate'];
await assets.preload(ids.map((id) => SHIPS[id].modelKey));
assets.setTeamCountry('a', ca);
assets.setTeamCountry('b', cb);
const map = generateMap(seed);
const view = new IslandView(map, [], assets.rocks(), assets.forest());
for (const o of view.objects) scene.add(o);
const xray = new XRay();
xray.setTeamColors(ca.ui, cb.ui);
// `?always=1` draws every silhouette (also where nothing hides the ship), to check that it lies over the ship exactly.
if (params.get('always') === '1') (xray.mesh.material as ShaderMaterial).depthFunc = AlwaysDepth;
scene.add(xray.mesh);

const cx = map.islandX[island]!;
const cz = map.islandY[island]!;
const R = map.islandR[island]!;
const camera = new PerspectiveCamera(CAMERA.fovDeg, innerWidth / innerHeight, CAMERA.near, CAMERA.far);
const d = R * dist + 30;
camera.position.set(cx, d * Math.sin(pitch * DEG2RAD), cz + d * Math.cos(pitch * DEG2RAD));
camera.lookAt(cx, 0, cz);
camera.updateMatrixWorld();

// Ships: a row behind the island (north), a row in front of it (south) and a couple at its sides.
const placed: { x: number; z: number; heading: number; id: ShipId; team: 'a' | 'b' }[] = [];
ids.forEach((id, k) => {
  const x = cx + (k - 2.5) * (R * 0.34);
  placed.push({ x, z: cz - R * (0.35 + 0.1 * (k % 2)), heading: 0.3 * (k - 2), id, team: k % 2 === 0 ? 'a' : 'b' });
  placed.push({ x, z: cz + R * 1.45, heading: Math.PI + 0.2 * (k - 2), id, team: k % 2 === 0 ? 'b' : 'a' });
});
const ships = placed.map((p) => {
  const model = assets.createShip(SHIPS[p.id].modelKey, p.team, false);
  model.root.position.set(p.x, 0, p.z);
  model.root.rotation.y = -p.heading;
  scene.add(model.root);
  return { p, model };
});

function frame(): void {
  view.update(0);
  xray.begin(camera.position.x, camera.position.y, camera.position.z);
  for (const { p, model } of ships) {
    xray.add(p.x, p.z, p.heading, model.hullLength, model.hullWidth, model.hullTop, p.team === 'a' ? 0 : 1);
  }
  xray.end();
  renderer.render(scene, camera);
}
frame();
(window as unknown as { redraw: () => void }).redraw = frame;
(document.getElementById('log') as HTMLElement).textContent = `seed ${seed} island ${island} radius ${R.toFixed(1)}  ${ca.name} (a) vs ${cb.name} (b)`;
