import {
  MAX_PROJECTILES,
  SHIPS,
  STEP_MS,
  STEP_SEC,
  TRAINING,
  WEAPONS,
  WEAPON_IDS,
} from '@tidebreaker/shared';
import type { ShipId } from '@tidebreaker/shared';
import { FixedStep } from './frame/fixedStep.ts';
import { aimAngleFromScreen } from './frame/aim.ts';
import { CameraRig } from './frame/cameraRig.ts';
import { Effects } from './frame/effects.ts';
import { ProjectileView } from './frame/projectileView.ts';
import { LocalGame } from './game/localGame.ts';
import { applyI18n, detectLanguage, setLanguage } from './i18n/index.ts';
import { Input } from './input/input.ts';
import { AssetProvider } from './render/assets.ts';
import { BarKit } from './render/barKit.ts';
import { createParticleKit } from './render/particleKit.ts';
import { VISUAL_ORDER, createProjectileMeshes } from './render/projectileMesh.ts';
import { Stage } from './render/stage.ts';
import { Water } from './render/water.ts';
import { DamageNumbers } from './ui/damageNumbers.ts';
import { DebugHud } from './ui/debugHud.ts';
import { Hud } from './ui/hud.ts';
import { MODEL_SPECS } from './render/modelSpecs.ts';
import { ShipPicker } from './ui/shipPicker.ts';

setLanguage(detectLanguage());
applyI18n(document);

const canvas = document.getElementById('game') as HTMLCanvasElement;
const stage = new Stage(canvas);
const water = new Water();
stage.scene.add(water.mesh);

const projectileMeshes = createProjectileMeshes(MAX_PROJECTILES);
stage.scene.add(...projectileMeshes);
const projectileView = new ProjectileView(projectileMeshes, VISUAL_ORDER);

const particleKit = createParticleKit();
stage.scene.add(
  particleKit.foam.mesh,
  particleKit.puff.mesh,
  particleKit.fire.mesh,
  particleKit.spark.mesh,
  particleKit.debris.mesh,
);
const effects = new Effects(particleKit, MAX_PROJECTILES);

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
    onShot(x, y, angle, weaponIdx) {
      effects.muzzle(x, y, angle, WEAPONS[WEAPON_IDS[weaponIdx]!].visual);
    },
    onHit(x, y, damage, shieldHit, killed, target) {
      damageNumbers.show(stage.camera, x, y, damage, shieldHit);
      effects.impact(x, y, shieldHit);
      if (killed) {
        const t = target.combatant;
        effects.explode(t.state.x, t.state.y, t.def.length);
      }
    },
    onMiss(x, y, weaponIdx) {
      effects.splash(x, y, WEAPONS[WEAPON_IDS[weaponIdx]!].visual);
    },
    onCollision(x, y, impact, a, b, damageA, damageB, killedA, killedB) {
      effects.collision(x, y, impact);
      if (damageA > 0) damageNumbers.show(stage.camera, a.pose.x, a.pose.y, damageA, false);
      if (damageB > 0) damageNumbers.show(stage.camera, b.pose.x, b.pose.y, damageB, false);
      if (killedA)
        effects.explode(a.combatant.state.x, a.combatant.state.y, a.combatant.def.length);
      if (killedB)
        effects.explode(b.combatant.state.x, b.combatant.state.y, b.combatant.def.length);
      // The camera rattles when the player is involved.
      if (a === game.player || b === game.player) rig.shake(Math.min(0.9, impact * 0.045));
    },
  },
  previewShip,
);

// The test picker can switch to any model, so fetch them all in the background right away.
void assets.preload(Object.keys(MODEL_SPECS));

const startModel = previewShip ?? SHIPS[TRAINING.playerShip as ShipId].modelKey;
new ShipPicker(
  document.getElementById('picker') as HTMLElement,
  startModel,
  async (key) => {
    await assets.preload([key]);
    // A model that belongs to a ship class switches the whole class; others are visual-only.
    const id = (Object.keys(SHIPS) as ShipId[]).find((k) => SHIPS[k].modelKey === key);
    if (id) game.setPlayerShip(id);
    else game.setPlayerModel(key);
  },
  (key) => assets.failures.get(key),
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
    game.step(input.steer, input.throttle, aim, input.fire);
  }

  const alpha = fixedStep.alpha;
  const timeSec = nowMs / 1000;
  for (const e of game.entities) e.render(alpha, dtSec, stage.camera, timeSec);
  projectileView.update(game.projectiles, STEP_SEC, alpha);
  for (const e of game.entities) effects.ship(e, dtSec);
  effects.trails(game.projectiles, dtSec);
  effects.update(dtSec);

  const p = game.player.pose;
  rig.update(stage.camera, p.x, p.y, dtSec, game.player.combatant.def.tier);
  water.update(timeSec, rig.focusX, rig.focusZ);
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
    assets,
    particleKit,
    advance(frames: number, frameMs = 16.7): void {
      for (let i = 0; i < frames; i++) {
        update(lastMs + frameMs);
      }
    },
  };
}
