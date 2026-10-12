import {
  AmbientLight,
  DirectionalLight,
  Group,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  Scene,
  WebGLRenderer,
} from 'three';
import { CARRIER, PIRATE_TYPES, SHIPS } from '@tidebreaker/shared';
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
 */

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

for (const icon of icons) {
  for (const orient of ['up', 'side'] as const) {
    await renderIcon(icon, orient);
  }
}
say('done');
(window as unknown as { iconsDone: boolean }).iconsDone = true;

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
