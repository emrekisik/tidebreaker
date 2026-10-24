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
import { CAMERA, CARRIER, COUNTRIES, DEG2RAD, FX, SHIPS } from '@tidebreaker/shared';
import { AssetProvider } from '../render/assets.ts';

/**
 * Dev tool (open /ship-view.html?ships=frigate,cruiser&countries=0,1&flank=0.8&lo=0.5&hi=0.85&bow=0.6&stern=9&soft=0.06): the
 * ships of the two countries (a row each; the first is team A, the second team B), seen the way the game's camera sees them, to judge how much of the hull the
 * team paint covers (`FX.livery`; the numbers in the address override it). Not part of the game.
 */
const params = new URLSearchParams(location.search);
const ids = (params.get('ships') ?? 'coast_guard_boat,gunboat,landing_craft,corvette,frigate,cruiser,heavy_frigate').split(',') as string[];
const countries = (params.get('countries') ?? '0,1').split(',').map(Number).slice(0, 2);
const pitch = Number(params.get('pitch') ?? CAMERA.pitchDeg);
const spread = Number(params.get('spread') ?? 26);

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

const assets = new AssetProvider();
/** A ship of the game by its id (`aircraft_carrier` is the team base). */
const modelOf = (id: string): string => (id === CARRIER.id ? CARRIER.modelKey : SHIPS[id as keyof typeof SHIPS].modelKey);
await assets.preload(ids.map(modelOf));
const v = assets.style.livery.value;
const number = (key: string, fallback: number): number => Number(params.get(key) ?? fallback);
v.set(number('flank', v.x), number('bow', v.y), number('stern', v.z), number('soft', v.w));
assets.style.liveryBand.value.set(number('lo', assets.style.liveryBand.value.x), number('hi', assets.style.liveryBand.value.y));

// The first row is team A, the second team B, each painted in its country.
const rows = countries.length;
const cols = ids.length;
countries.forEach((c, r) => assets.setTeamCountry(r === 0 ? 'a' : 'b', COUNTRIES[c]!));
ids.forEach((id, i) => {
  countries.forEach((_, r) => {
    const model = assets.createShip(modelOf(id), r === 0 ? 'a' : 'b', false);
    model.root.position.set((i - (cols - 1) / 2) * spread, 0, (r - (rows - 1) / 2) * spread * 0.62);
    // Bow to the right on screen, a little turned so the side of the hull shows.
    model.root.rotation.y = -0.45;
    scene.add(model.root);
  });
});

const camera = new PerspectiveCamera(CAMERA.fovDeg, innerWidth / innerHeight, CAMERA.near, CAMERA.far);
const zoom = Number(params.get('zoom') ?? 2.2);
const d = Math.max(30, (cols * spread * 0.62) / (Math.tan((CAMERA.fovDeg / 2) * DEG2RAD) * camera.aspect) / zoom);
camera.position.set(0, d * Math.sin(pitch * DEG2RAD), d * Math.cos(pitch * DEG2RAD));
camera.lookAt(0, 0, 0);
renderer.render(scene, camera);
(document.getElementById('log') as HTMLElement).textContent =
  `livery flank ${v.x} bow ${v.y} stern ${v.z} soft ${v.w} band ${assets.style.liveryBand.value.x}-${assets.style.liveryBand.value.y}  (${countries.map((c) => COUNTRIES[c]!.name).join(', ')})`;
