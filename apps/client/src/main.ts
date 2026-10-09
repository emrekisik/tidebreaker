import {
  MAX_PROJECTILES,
  SHIPS,
  STEP_MS,
  STEP_SEC,
  TRAINING,
  WEAPONS,
  WEAPON_IDS,
} from '@tidebreaker/shared';
import { boundaryDepth, generateMap, mapHash } from '@tidebreaker/shared';
import type { ShipId } from '@tidebreaker/shared';
import type { Color } from 'three';
import { FixedStep } from './frame/fixedStep.ts';
import { aimFromScreen } from './frame/aim.ts';
import { CameraRig } from './frame/cameraRig.ts';
import { Effects } from './frame/effects.ts';
import { ProjectileView } from './frame/projectileView.ts';
import { LocalGame } from './game/localGame.ts';
import { applyI18n, detectLanguage, setLanguage } from './i18n/index.ts';
import { Input } from './input/input.ts';
import { AssetProvider } from './render/assets.ts';
import { BarKit } from './render/barKit.ts';
import { IslandView } from './render/islands.ts';
import { createParticleKit } from './render/particleKit.ts';
import { VISUAL_ORDER, createProjectileMeshes } from './render/projectileMesh.ts';
import { Stage } from './render/stage.ts';
import { WakeMap } from './render/wakeMap.ts';
import { Water } from './render/water.ts';
import { DamageNumbers } from './ui/damageNumbers.ts';
import { DebugHud } from './ui/debugHud.ts';
import { Hud } from './ui/hud.ts';
import { MODEL_SPECS } from './render/modelSpecs.ts';
import { LookPanel } from './ui/lookPanel.ts';
import { ShipPicker } from './ui/shipPicker.ts';

setLanguage(detectLanguage());
applyI18n(document);

const canvas = document.getElementById('game') as HTMLCanvasElement;
const stage = new Stage(canvas);
const water = new Water();
const wakeMap = new WakeMap();
stage.scene.add(water.mesh);

// The practice map comes from a seed (`?seed=<n>` picks another one).
const params = new URLSearchParams(location.search);
const seedParam = Number(params.get('seed'));
const mapSeed =
  Number.isFinite(seedParam) && params.has('seed') ? seedParam >>> 0 : TRAINING.mapSeed;
const worldMap = generateMap(mapSeed);
const islands = new IslandView(worldMap);
stage.scene.add(...islands.objects);

const projectileMeshes = createProjectileMeshes(MAX_PROJECTILES);
stage.scene.add(...projectileMeshes);
const projectileView = new ProjectileView(projectileMeshes, VISUAL_ORDER);

const particleKit = createParticleKit();
stage.scene.add(
  particleKit.foam.mesh,
  particleKit.puff.mesh,
  particleKit.fire.mesh,
  particleKit.glow.mesh,
  particleKit.spark.mesh,
  particleKit.tracer.mesh,
  particleKit.debris.mesh,
);
const effects = new Effects(particleKit, MAX_PROJECTILES, wakeMap);

const damageNumbers = new DamageNumbers(document.getElementById('dmg-layer') as HTMLElement);
// `?ship=<model key>` swaps only the player's visual model (preview); the sim is unchanged.
const previewShip = params.get('ship') ?? undefined;
const assets = new AssetProvider();
// The enemy fleet is built from every ship class, so all models must be here before the game starts.
await assets.preload(Object.keys(MODEL_SPECS));
const game = new LocalGame(
  stage.scene,
  assets,
  new BarKit(),
  {
    onShot(x, y, angle, weaponIdx) {
      effects.muzzle(x, y, angle, WEAPONS[WEAPON_IDS[weaponIdx]!].visual);
    },
    onHit(x, y, damage, shieldHit, killed, target, weaponIdx) {
      damageNumbers.show(stage.camera, x, y, damage, shieldHit);
      effects.impact(x, y, shieldHit, WEAPONS[WEAPON_IDS[weaponIdx]!].visual);
      if (killed) {
        const t = target.combatant;
        effects.explode(t.state.x, t.state.y, t.def.length);
      }
    },
    onMiss(x, y, weaponIdx) {
      effects.splash(x, y, WEAPONS[WEAPON_IDS[weaponIdx]!].visual);
    },
    onBlocked(x, y, weaponIdx) {
      effects.blocked(x, y, WEAPONS[WEAPON_IDS[weaponIdx]!].visual);
    },
    onIslandHit(x, y, impact, ship) {
      effects.shore(x, y, impact);
      if (ship === game.player) rig.shake(Math.min(0.8, impact * 0.05));
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
  worldMap,
  previewShip,
);

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

// Test panel: live colors for the ocean, team paint and rings, plus the hull outline switch.
new LookPanel(document.getElementById('look') as HTMLElement, (look) => {
  water.setColors(look.oceanDeep, look.oceanShallow);
  (stage.scene.background as Color).set(look.oceanDeep);
  assets.setTeamColor('blue', look.blue);
  assets.setTeamColor('red', look.red);
  assets.setRingColor('blue', look.ringBlue);
  assets.setRingColor('red', look.ringRed);
  assets.setTeamBoost(look.boost);
  assets.setTeamGlow(look.glow);
  assets.setOutline(look.outline);
});

const input = new Input(canvas);
const rig = new CameraRig();
const fixedStep = new FixedStep(STEP_MS);
const hud = new Hud();
const debug = params.get('debug') === '1';
const debugHud = debug ? new DebugHud(document.getElementById('debug') as HTMLElement) : null;
debugHud?.setMapInfo(
  `map seed ${mapSeed}  hash ${mapHash(worldMap).toString(16)}  ${worldMap.islandCount} islands, ${worldMap.reefCount} reefs`,
);

const stormEl = document.getElementById('storm') as HTMLElement;
let lastStorm = -1;
let aim = 0;
let aimDist = 0;
const aimOut = new Float32Array(2);
let lastMs = performance.now();

function update(nowMs: number): void {
  const frameMs = nowMs - lastMs;
  lastMs = nowMs;
  const dtSec = Math.max(0, Math.min(frameMs, 100)) / 1000;

  const wheel = input.consumeWheel();
  if (wheel !== 0) rig.zoomBy(wheel);

  const steps = fixedStep.advance(frameMs);
  const ps = game.player.combatant.state;
  for (let i = 0; i < steps; i++) {
    if (aimFromScreen(stage.camera, input.ndcX, input.ndcY, ps.x, ps.y, aimOut)) {
      aim = aimOut[0]!;
      aimDist = aimOut[1]!;
    }
    game.step(input.steer, input.throttle, aim, aimDist, input.fire);
  }

  const alpha = fixedStep.alpha;
  const timeSec = nowMs / 1000;
  for (const e of game.entities) e.render(alpha, dtSec, stage.camera, timeSec);
  projectileView.update(game.projectiles, STEP_SEC, alpha);
  wakeMap.begin(rig.focusX, rig.focusZ, dtSec);
  for (const e of game.entities) effects.ship(e, dtSec);
  effects.trails(game.projectiles, dtSec, STEP_SEC * (1 - alpha));
  effects.update(dtSec);

  const p = game.player.pose;
  rig.update(stage.camera, p.x, p.y, dtSec, game.player.combatant.def.tier);
  wakeMap.render(stage.renderer);
  water.setWake(wakeMap.texture, wakeMap.origin.x, wakeMap.origin.y);
  water.update(timeSec, rig.focusX, rig.focusZ);
  islands.update(timeSec);
  const storm = boundaryDepth(p.x, p.y);
  if (storm !== lastStorm) {
    lastStorm = storm;
    stormEl.style.opacity = String(Math.min(1, storm * 1.25));
  }
  stage.render();

  hud.update(ps, game.player.combatant.def, game.kills, nowMs, dtSec);
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
    stage,
    water,
    worldMap,
    islands,
    wakeMap,
    effects,
    /** GPU/CPU probe for docs/perf.md: await __tb.probe(1920, 1080). */
    probe: async (w: number, h: number) => {
      const { runProbe } = await import('./ui/perfProbe.ts');
      return runProbe(
        {
          stage,
          wakeMap,
          groups: {
            water: [water.mesh],
            islands: islands.objects,
            ships: game.entities.map((e) => e.model.root),
            particles: [
              particleKit.foam.mesh,
              particleKit.puff.mesh,
              particleKit.fire.mesh,
              particleKit.glow.mesh,
              particleKit.spark.mesh,
              particleKit.tracer.mesh,
              particleKit.debris.mesh,
            ],
            projectiles: projectileMeshes,
          },
          advance: (frames: number, frameMs = 16.7) => {
            for (let i = 0; i < frames; i++) update(lastMs + frameMs);
          },
        },
        w,
        h,
      );
    },
    advance(frames: number, frameMs = 16.7): void {
      for (let i = 0; i < frames; i++) {
        update(lastMs + frameMs);
      }
    },
  };
}
