import {
  AmbientLight,
  Box3,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShadowMaterial,
  Vector3,
  WebGLRenderer,
} from 'three';
import { CARRIER, FX, PIRATE_TYPES, SHIPS } from '@tidebreaker/shared';
import { AssetProvider } from '../render/assets.ts';
import type { Team } from '../render/assets.ts';
import { MODEL_SPECS } from '../render/modelSpecs.ts';

/**
 * Dev tool (open /ship-icons.html while `tools/assets/icon-saver.mjs` runs; see `pnpm icons`):
 * renders every ship model from straight above, bow pointing up, on a transparent background, and
 * sends the PNGs to the saver, which writes them to `apps/client/public/icons/ships/`.
 *   up/<color>/<id>.png    128x128, bow pointing up
 *   side/<color>/<id>.png  128x64, bow pointing right (fits a row of text)
 * where color is blue or red (the model in that team's paint; the pirate ship is the same in both)
 * or white (a flat silhouette, to tint with CSS `mask-image` or in an editor).
 * Open it with `?only=card` to draw just the class cards: card/<id>.png, 288x192, the ship in blue paint seen from an
 * angle (a perspective camera like the game's, lit like the game, with a soft shadow on a transparent background).
 */

const CARD_W = 288;
const CARD_H = 192;
/** Where the card camera looks from: height above the water and the turn from the beam toward the bow (degrees). */
const CARD_ELEVATION = 42;
const CARD_TURN = 30;
/** The ship fills this much of the card (the larger of its width and height). */
const FILL_CARD = 0.86;

const SIZE = 128;
/** The ship's length fills this much of the icon height. */
const FILL = 0.94;
const SAVER = 'http://localhost:9099/save';

const log = document.getElementById('log') as HTMLElement;
const say = (line: string): void => {
  log.textContent += `\n${line}`;
};

interface Icon {
  id: string;
  modelKey: string;
  length: number;
  /** Takes no team paint. */
  plain: boolean;
}

const icons: Icon[] = [
  ...Object.values(SHIPS).map((d) => ({
    id: d.id,
    modelKey: d.modelKey,
    length: d.length,
    plain: false,
  })),
  { id: CARRIER.id, modelKey: CARRIER.modelKey, length: CARRIER.length, plain: false },
  {
    id: 'pirate_ship',
    modelKey: PIRATE_TYPES[2]!.def.modelKey,
    length: PIRATE_TYPES[2]!.def.length,
    plain: true,
  },
];

const renderer = new WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setClearColor(0x000000, 0);
document.body.append(renderer.domElement);

const scene = new Scene();
const sun = new DirectionalLight(0xfff4e0, 2.4);
sun.position.set(-30, 80, 20);
scene.add(sun, new AmbientLight(0x9dc4e0, 1.6));

const assets = new AssetProvider();
await assets.preload(icons.map((i) => i.modelKey).filter((k) => MODEL_SPECS[k]));

const white = new MeshBasicMaterial({ color: 0xffffff });

async function save(path: string): Promise<void> {
  const url = renderer.domElement.toDataURL('image/png');
  const res = await fetch(`${SAVER}?path=${encodeURIComponent(path)}`, {
    method: 'POST',
    body: url,
  });
  if (!res.ok) throw new Error(`saver said ${res.status}`);
}

if (new URLSearchParams(location.search).get('only') === 'card') {
  for (const icon of icons) if (icon.id !== CARRIER.id && icon.id !== 'pirate_ship') await renderCard(icon);
} else {
  for (const icon of icons) {
    for (const orient of ['up', 'side'] as const) {
      await renderIcon(icon, orient);
    }
  }
}
say('done');
(window as unknown as { iconsDone: boolean }).iconsDone = true;

/** One class card: the ship in the game's light, seen from an angle, with its shadow on the water. */
async function renderCard(icon: Icon): Promise<void> {
  renderer.setSize(CARD_W, CARD_H);
  renderer.shadowMap.enabled = true;
  const L = FX.light;
  const cardScene = new Scene();
  const sunLight = new DirectionalLight(L.sunColor, L.sunIntensity);
  const dir = new Vector3(...L.sunDir).normalize();
  sunLight.position.copy(dir).multiplyScalar(80);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(1024, 1024);
  const reach = icon.length * 0.8;
  Object.assign(sunLight.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 1, far: 200 });
  sunLight.shadow.bias = L.bias;
  sunLight.shadow.normalBias = L.normalBias;
  cardScene.add(sunLight, sunLight.target, new HemisphereLight(L.skyColor, L.groundColor, L.hemiIntensity));
  // (Only its shadow shows: the water behind the card is drawn by the page.)
  const water = new Mesh(new PlaneGeometry(400, 400), new ShadowMaterial({ opacity: 0.4 }));
  water.rotation.x = -Math.PI / 2;
  water.receiveShadow = true;
  cardScene.add(water);

  const model = assets.createShip(icon.modelKey, 'blue', false);
  model.root.traverse((o) => {
    if ((o as Mesh).isMesh) (o as Mesh).castShadow = true;
  });
  cardScene.add(model.root);

  const fov = 26;
  const camera = new PerspectiveCamera(fov, CARD_W / CARD_H, 1, 500);
  const el = (CARD_ELEVATION * Math.PI) / 180;
  const az = (CARD_TURN * Math.PI) / 180;
  const dirToCamera = new Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
  // Fit the camera to the ship itself (a wide hovercraft needs more room than a long frigate): the eight corners of
  // its box are projected and the camera pulled back and shifted until they fill the middle of the card.
  const box = new Box3().setFromObject(model.root);
  const corners: Vector3[] = [];
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(new Vector3(x, y, z));
  }
  const target = box.getCenter(new Vector3());
  let distance = icon.length * 2;
  const right = new Vector3();
  const up = new Vector3();
  const spot = new Vector3();
  for (let pass = 0; pass < 8; pass++) {
    camera.position.copy(target).addScaledVector(dirToCamera, distance);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const c of corners) {
      spot.copy(c).project(camera);
      minX = Math.min(minX, spot.x);
      maxX = Math.max(maxX, spot.x);
      minY = Math.min(minY, spot.y);
      maxY = Math.max(maxY, spot.y);
    }
    const halfH = distance * Math.tan(((fov / 2) * Math.PI) / 180);
    right.setFromMatrixColumn(camera.matrixWorld, 0);
    up.setFromMatrixColumn(camera.matrixWorld, 1);
    // Shift toward the middle of what is drawn, and scale so the larger side fills `FILL_CARD` of the card.
    target.addScaledVector(right, ((minX + maxX) / 2) * halfH * (CARD_W / CARD_H));
    target.addScaledVector(up, ((minY + maxY) / 2) * halfH);
    distance *= Math.max((maxX - minX) / 2, (maxY - minY) / 2) / FILL_CARD;
  }
  camera.position.copy(target).addScaledVector(dirToCamera, distance);
  camera.lookAt(target);
  renderer.render(cardScene, camera);
  const path = `card/${icon.id}.png`;
  await save(path);
  say(path);
  cardScene.remove(model.root);
  sunLight.dispose();
}

async function renderIcon(icon: Icon, orient: 'up' | 'side'): Promise<void> {
  // The bow is +x in the game. Looking straight down, "up" = +x puts it at the top of the
  // screen; "up" = -z puts it on the right.
  const half = (icon.length * 0.5) / FILL;
  const side = orient === 'side';
  renderer.setSize(SIZE, side ? SIZE / 2 : SIZE);
  const camera = new OrthographicCamera(
    -half,
    half,
    side ? half / 2 : half,
    side ? -half / 2 : -half,
    0.1,
    500,
  );
  camera.up.set(side ? 0 : 1, 0, side ? -1 : 0);
  camera.position.set(0, 100, 0);
  camera.lookAt(0, 0, 0);

  const variants: [string, Team][] = icon.plain
    ? [
        ['blue', 'pirate'],
        ['red', 'pirate'],
      ]
    : [
        ['blue', 'blue'],
        ['red', 'red'],
      ];
  const root = new Group();
  scene.add(root);
  for (const [folder, team] of [...variants, ['white', 'blue'] as [string, Team]]) {
    root.clear();
    const model = assets.createShip(icon.modelKey, team, false);
    root.add(model.root);
    if (folder === 'white') {
      model.root.traverse((o) => {
        if ((o as Mesh).isMesh) (o as Mesh).material = white;
      });
    }
    renderer.render(scene, camera);
    const path = `${orient}/${folder}/${icon.id}.png`;
    await save(path);
    say(path);
  }
  scene.remove(root);
}
