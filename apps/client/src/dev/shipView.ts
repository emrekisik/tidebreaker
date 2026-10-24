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
import { CAMERA, CARRIER, COUNTRIES, DEFAULT_LIVERY, DEG2RAD, FX, LIVERIES, SHIPS } from '@tidebreaker/shared';
import { AssetProvider } from '../render/assets.ts';

/**
 * Dev tool (open /ship-view.html?ships=frigate,cruiser&country=0&liveries=standard,boot): the ships in a row each for every
 * livery listed (`all` lists them all; see `LIVERIES` in config/liveries.ts), in the paint of one country, seen the way the
 * game's camera sees them, to judge how much of the hull the team paint covers. `zoom` and `spread` set the framing; `turn`
 * how far the ships are turned (radians). Not part of the game.
 */
const params = new URLSearchParams(location.search);
const ids = (params.get('ships') ?? 'coast_guard_boat,gunboat,landing_craft,corvette,frigate,cruiser,heavy_frigate').split(',');
const country = COUNTRIES[Number(params.get('country') ?? 0)]!;
const wanted = params.get('liveries') ?? DEFAULT_LIVERY;
const liveries = wanted === 'all' ? LIVERIES.map((l) => l.id) : wanted.split(',');
const pitch = Number(params.get('pitch') ?? CAMERA.pitchDeg);
const spread = Number(params.get('spread') ?? 24);
const rowGap = Number(params.get('rowgap') ?? spread * 0.62);
const turn = Number(params.get('turn') ?? -0.45);

const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(innerWidth, innerHeight);
document.body.append(renderer.domElement);
const scene = new Scene();
scene.background = new Color(0x1e566f);
const L = FX.light;
const sun = new DirectionalLight(L.sunColor, L.sunIntensity);
sun.position.set(...L.sunDir).multiplyScalar(300);
scene.add(sun, sun.target, new HemisphereLight(L.skyColor, L.groundColor, L.hemiIntensity));
const sea = new Mesh(new PlaneGeometry(4000, 4000), new MeshBasicMaterial({ color: 0x2b6a86 }));
sea.rotation.x = -Math.PI / 2;
sea.position.y = -0.3;
scene.add(sea);

/** A ship of the game by its id (`aircraft_carrier` is the team base). */
const modelOf = (id: string): string => (id === CARRIER.id ? CARRIER.modelKey : SHIPS[id as keyof typeof SHIPS].modelKey);

// A row for every livery: each has its own asset provider, because the livery belongs to the team material.
const cols = ids.length;
const rows = liveries.length;
for (let r = 0; r < rows; r++) {
  const assets = new AssetProvider();
  await assets.preload(ids.map(modelOf));
  assets.setTeamCountry('a', country);
  assets.setLivery('a', liveries[r]!);
  ids.forEach((id, i) => {
    const model = assets.createShip(modelOf(id), 'a', false);
    model.root.position.set((i - (cols - 1) / 2) * spread, 0, (r - (rows - 1) / 2) * rowGap);
    model.root.rotation.y = turn;
    scene.add(model.root);
  });
}

const camera = new PerspectiveCamera(CAMERA.fovDeg, innerWidth / innerHeight, CAMERA.near, CAMERA.far);
const zoom = Number(params.get('zoom') ?? 1.6);
const width = cols * spread;
const d = Math.max(30, width / (2 * Math.tan((CAMERA.fovDeg / 2) * DEG2RAD) * camera.aspect) / zoom * 1.6);
camera.position.set(0, d * Math.sin(pitch * DEG2RAD), d * Math.cos(pitch * DEG2RAD));
camera.lookAt(0, 0, 0);
renderer.render(scene, camera);
(document.getElementById('log') as HTMLElement).textContent = `${country.name}: ${liveries.join(', ')} (top to bottom)`;
