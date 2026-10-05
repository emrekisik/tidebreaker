import { MAX_PROJECTILES, SHIPS, STEP_MS, STEP_SEC, TRAINING } from '@tidebreaker/shared';
import type { ShipId } from '@tidebreaker/shared';
import { FixedStep } from './frame/fixedStep.ts';
import { aimAngleFromScreen } from './frame/aim.ts';
import { CameraRig } from './frame/cameraRig.ts';
import { ProjectileView } from './frame/projectileView.ts';
import { LocalGame } from './game/localGame.ts';
import { applyI18n, detectLanguage, setLanguage } from './i18n/index.ts';
import { Input } from './input/input.ts';
import { AssetProvider } from './render/assets.ts';
import { BarKit } from './render/barKit.ts';
import { createProjectileMesh } from './render/projectileMesh.ts';
import { Stage } from './render/stage.ts';
import { Water } from './render/water.ts';
import { DamageNumbers } from './ui/damageNumbers.ts';
import { DebugHud } from './ui/debugHud.ts';
import { Hud } from './ui/hud.ts';

setLanguage(detectLanguage());
applyI18n(document);

const canvas = document.getElementById('game') as HTMLCanvasElement;
const stage = new Stage(canvas);
const water = new Water();
stage.scene.add(water.mesh);

const projectileMesh = createProjectileMesh(MAX_PROJECTILES);
stage.scene.add(projectileMesh);
const projectileView = new ProjectileView(projectileMesh);

const damageNumbers = new DamageNumbers(document.getElementById('dmg-layer') as HTMLElement);
const params = new URLSearchParams(location.search);
// `?ship=<model key>` swaps only the player's visual model (preview); the sim is unchanged.
const previewShip = params.get('ship') ?? undefined;
const assets = new AssetProvider();
await assets.preload([
  SHIPS[TRAINING.playerShip as ShipId].modelKey,
  ...(previewShip ? [previewShip] : []),
]);
const game = new LocalGame(
  stage.scene,
  assets,
  new BarKit(),
  {
    onHit(x, y, damage, shieldHit) {
      damageNumbers.show(stage.camera, x, y, damage, shieldHit);
    },
  },
  previewShip,
);

const input = new Input(canvas);
const rig = new CameraRig();
const fixedStep = new FixedStep(STEP_MS);
const hud = new Hud();
const debug = params.get('debug') === '1';
const debugHud = debug ? new DebugHud(document.getElementById('debug') as HTMLElement) : null;

let aim = 0;
let lastMs = performance.now();
let lastHudMs = 0;

function update(nowMs: number): void {
  const frameMs = nowMs - lastMs;
  lastMs = nowMs;
  const dtSec = Math.max(0, Math.min(frameMs, 100)) / 1000;

  const steps = fixedStep.advance(frameMs);
  const ps = game.player.combatant.state;
  for (let i = 0; i < steps; i++) {
    const a = aimAngleFromScreen(stage.camera, input.ndcX, input.ndcY, ps.x, ps.y);
    if (!Number.isNaN(a)) aim = a;
    game.step(input.moveX, input.moveY, aim, input.fire);
  }

  const alpha = fixedStep.alpha;
  for (const e of game.entities) e.render(alpha, dtSec, stage.camera);
  projectileView.update(game.projectiles, STEP_SEC, alpha);

  const p = game.player.pose;
  rig.update(stage.camera, p.x, p.y, dtSec, game.player.combatant.def.tier);
  water.update(nowMs / 1000, rig.focusX, rig.focusZ);
  stage.render();

  if (nowMs - lastHudMs > 100) {
    hud.update(ps, game.player.combatant.def, game.kills, nowMs);
    lastHudMs = nowMs;
  }
  debugHud?.frame(frameMs, nowMs, stage.renderer, game.projectiles.activeCount, game.ticks);
}

function frame(nowMs: number): void {
  requestAnimationFrame(frame);
  update(nowMs);
}

requestAnimationFrame(frame);

if (debug) {
  // Debug-only hook (?debug=1): drive the loop with synthetic time, for automated checks in
  // environments where requestAnimationFrame is throttled.
  (window as unknown as Record<string, unknown>)['__tb'] = {
    game,
    input,
    camera: stage.camera,
    advance(frames: number, frameMs = 16.7): void {
      for (let i = 0; i < frames; i++) {
        update(lastMs + frameMs);
      }
    },
  };
}
