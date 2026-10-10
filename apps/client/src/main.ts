import {
  MATCH_STATE,
  MAX_PROJECTILES,
  SHIPS,
  STEP_MS,
  STEP_SEC,
  TRAINING,
  WEAPONS,
  WEAPON_IDS,
  WORLD_CENTER,
  boundaryDepth,
  generateMap,
  mapHash,
} from '@tidebreaker/shared';
import type { Combatant, ShipId, WorldMap } from '@tidebreaker/shared';
import type { Color } from 'three';
import { FixedStep } from './frame/fixedStep.ts';
import { aimFromScreen } from './frame/aim.ts';
import { CameraRig } from './frame/cameraRig.ts';
import { Effects } from './frame/effects.ts';
import { ProjectileView } from './frame/projectileView.ts';
import { LocalGame } from './game/localGame.ts';
import { OnlineGame } from './game/onlineGame.ts';
import type { ConnectError, OnlineEvents } from './game/onlineGame.ts';
import type { GameSession } from './game/session.ts';
import { applyI18n, detectLanguage, setLanguage, t } from './i18n/index.ts';
import type { MessageKey } from './i18n/index.ts';
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
import { KillFeed } from './ui/killFeed.ts';
import { MatchHud } from './ui/matchHud.ts';
import { Scoreboard } from './ui/scoreboard.ts';
import { Menu } from './ui/menu.ts';
import { Minimap } from './ui/minimap.ts';
import { ShipPicker } from './ui/shipPicker.ts';

setLanguage(detectLanguage());
applyI18n(document);

const params = new URLSearchParams(location.search);
// `?offline=1`: the single-player sandbox (target ships, no server). Otherwise: menu, then a match.
const offline = params.has('offline');
const serverUrl = params.get('server') ?? `ws://${location.hostname}:9001`;
const debug = params.get('debug') === '1';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const stage = new Stage(canvas);
const water = new Water();
const wakeMap = new WakeMap();
stage.scene.add(water.mesh);

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
const assets = new AssetProvider();
// Fleets are built from every ship class and the carrier, so all models load before anything starts.
await assets.preload(Object.keys(MODEL_SPECS));
const bars = new BarKit();

const input = new Input(canvas);
const rig = new CameraRig();
const fixedStep = new FixedStep(STEP_MS);
const hud = new Hud();
const debugHud = debug ? new DebugHud(document.getElementById('debug') as HTMLElement) : null;
const matchHud = new MatchHud();
const killFeed = new KillFeed(document.getElementById('killfeed') as HTMLElement);
const scoreboard = new Scoreboard(document.getElementById('scoreboard') as HTMLElement);
const stormEl = document.getElementById('storm') as HTMLElement;
const minimapEl = document.getElementById('minimap') as HTMLElement;
const pickerEl = document.getElementById('picker') as HTMLElement;

// ---- the world the current session plays in (islands, minimap)

let session: GameSession | null = null;
let online: OnlineGame | null = null;
let islands: IslandView | null = null;
let minimap: Minimap | null = null;
let mapSeed = 0;
let worldMap: WorldMap | null = null;

function setWorld(map: WorldMap): void {
  if (islands) for (const o of islands.objects) stage.scene.remove(o);
  worldMap = map;
  islands = new IslandView(map);
  stage.scene.add(...islands.objects);
  minimapEl.replaceChildren();
  minimap = new Minimap(minimapEl, map);
  mapSeed = map.seed;
  debugHud?.setMapInfo(
    `map seed ${map.seed}  hash ${mapHash(map).toString(16)}  ${map.islandCount} islands, ${map.reefCount} reefs`,
  );
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'Tab') {
    // The scoreboard replaces the browser's focus change.
    e.preventDefault();
    if (online) scoreboard.hold(true);
  }
  if (e.code === 'KeyM' && !e.repeat && minimap && (e.target as HTMLElement).tagName !== 'INPUT') {
    minimap.toggle();
    minimapEl.classList.toggle('big');
  }
});

window.addEventListener('keyup', (e) => {
  if (e.code === 'Tab') scoreboard.hold(false);
});
window.addEventListener('blur', () => scoreboard.hold(false));

// ---- effects shared by the sandbox and online matches

const events: OnlineEvents = {
  onShot(x, y, angle, weaponIdx) {
    effects.muzzle(x, y, angle, WEAPONS[WEAPON_IDS[weaponIdx]!].visual);
  },
  onHit(x, y, damage, shieldHit, killed, target, weaponIdx, showNumber = true) {
    if (showNumber) damageNumbers.show(stage.camera, x, y, damage, shieldHit);
    effects.impact(x, y, shieldHit, WEAPONS[WEAPON_IDS[weaponIdx]!].visual);
    if (killed) {
      const c = target.combatant;
      effects.explode(c.state.x, c.state.y, c.def.length);
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
    if (ship === session?.player) rig.shake(Math.min(0.8, impact * 0.05));
  },
  onCollision(x, y, impact, a, b, damageA, damageB, killedA, killedB) {
    effects.collision(x, y, impact);
    if (damageA > 0) damageNumbers.show(stage.camera, a.pose.x, a.pose.y, damageA, false);
    if (damageB > 0) damageNumbers.show(stage.camera, b.pose.x, b.pose.y, damageB, false);
    if (killedA) effects.explode(a.combatant.state.x, a.combatant.state.y, a.combatant.def.length);
    if (killedB) effects.explode(b.combatant.state.x, b.combatant.state.y, b.combatant.def.length);
    // The camera rattles when the player is involved.
    const me = session?.player;
    if (a === me || b === me) rig.shake(Math.min(0.9, impact * 0.045));
  },
  onSunk(entity, x, y) {
    effects.explode(x, y, entity.combatant.def.length);
  },
  onDied(killerId, killerName, respawnSec) {
    // Carriers are entities 1 and 2.
    matchHud.died(killerId <= 2 ? t('death.byCarrier') : killerName, respawnSec);
    rig.shake(0.9);
  },
  onMatch(state, winner, restartSec) {
    matchHud.setMatch(state, winner, restartSec);
    scoreboard.pin(state === MATCH_STATE.ENDED);
  },
  onKill(killerId, victimId, killerTeam, victimTeam, weapon, killerName, victimName) {
    const me = online?.myId ?? 0;
    killFeed.add(
      killerId <= 2 ? t('feed.carrier') : killerName,
      victimName,
      killerTeam,
      victimTeam,
      weapon,
      killerId === me || victimId === me,
    );
  },
  onScores(rows, myId) {
    scoreboard.update(rows, myId);
  },
  onJoined() {
    matchHud.respawned();
  },
  onClosed() {
    matchHud.connectionLost();
  },
};

// ---- starting a session

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

function startOffline(): void {
  // The practice map comes from a seed (`?seed=<n>` picks another one).
  const seedParam = Number(params.get('seed'));
  const seed =
    Number.isFinite(seedParam) && params.has('seed') ? seedParam >>> 0 : TRAINING.mapSeed;
  const map = generateMap(seed);
  setWorld(map);
  // `?ship=<model key>` swaps only the player's visual model (preview); the sim is unchanged.
  const previewShip = params.get('ship') ?? undefined;
  const game = new LocalGame(stage.scene, assets, bars, events, map, previewShip);
  session = game;
  const startModel = previewShip ?? SHIPS[TRAINING.playerShip as ShipId].modelKey;
  new ShipPicker(
    pickerEl,
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
}

const menu = new Menu((name, shipIdx) => void startOnline(name, shipIdx));

async function startOnline(name: string, shipIdx: number): Promise<void> {
  menu.setBusy(true);
  const game = new OnlineGame({
    scene: stage.scene,
    assets,
    bars,
    events,
    url: serverUrl,
    name,
    shipIdx,
  });
  try {
    await game.connect();
  } catch (e) {
    menu.setError(`menu.err.${e as ConnectError}` as MessageKey);
    return;
  }
  setWorld(game.land);
  session = game;
  online = game;
  pickerEl.classList.add('hidden');
  matchHud.show(true);
  menu.hide();
  document.body.classList.remove('in-menu');
}

if (offline) {
  startOffline();
  document.body.classList.remove('in-menu');
} else {
  menu.show();
}

// ---- the frame loop

let lastStorm = -1;
let aim = 0;
let aimDist = 0;
const aimOut = new Float32Array(2);
let lastMs = performance.now();
let lastNetInfoMs = 0;
const others: Combatant[] = [];
const carriers: (Combatant | undefined)[] = [undefined, undefined];

function update(nowMs: number): void {
  const frameMs = nowMs - lastMs;
  lastMs = nowMs;
  const dtSec = Math.max(0, Math.min(frameMs, 100)) / 1000;
  const timeSec = nowMs / 1000;

  const wheel = input.consumeWheel();
  if (wheel !== 0) rig.zoomBy(wheel);

  if (!session) {
    // Menu screen: the open sea, a slowly turning view.
    wakeMap.begin(rig.focusX, rig.focusZ, dtSec);
    effects.update(dtSec);
    rig.update(stage.camera, WORLD_CENTER + Math.cos(timeSec * 0.05) * 60, WORLD_CENTER, dtSec, 3);
    wakeMap.render(stage.renderer);
    water.setWake(wakeMap.texture, wakeMap.origin.x, wakeMap.origin.y);
    water.update(timeSec, rig.focusX, rig.focusZ);
    stage.render();
    debugHud?.frame(frameMs, nowMs, stage.renderer, 0, 0);
    return;
  }

  const game = session;
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
  game.frame(nowMs, dtSec, alpha);
  for (const e of game.entities) e.render(alpha, dtSec, stage.camera, timeSec);
  projectileView.begin();
  for (const layer of game.layers) projectileView.add(layer.set, STEP_SEC, layer.alpha);
  projectileView.end();
  wakeMap.begin(rig.focusX, rig.focusZ, dtSec);
  for (const e of game.entities) effects.ship(e, dtSec);
  for (let l = 0; l < game.layers.length; l++) {
    const layer = game.layers[l]!;
    effects.trails(layer.set, dtSec, STEP_SEC * (1 - layer.alpha), l);
  }
  effects.update(dtSec);

  const p = game.player.pose;
  rig.update(stage.camera, p.x, p.y, dtSec, game.player.combatant.def.tier);
  wakeMap.render(stage.renderer);
  water.setWake(wakeMap.texture, wakeMap.origin.x, wakeMap.origin.y);
  water.update(timeSec, rig.focusX, rig.focusZ);
  islands?.update(timeSec);

  others.length = 0;
  carriers[0] = undefined;
  carriers[1] = undefined;
  for (const e of game.entities) {
    if (e === game.player) continue;
    others.push(e.combatant);
    if (e.combatant.def.vMax === 0) carriers[e.combatant.team] = e.combatant;
  }
  minimap?.update(ps, others, stage.camera);
  const storm = boundaryDepth(p.x, p.y);
  if (storm !== lastStorm) {
    lastStorm = storm;
    stormEl.style.opacity = String(Math.min(1, storm * 1.25));
  }
  stage.render();

  hud.update(ps, game.player.combatant.def, game.kills, nowMs, dtSec);
  if (online) {
    matchHud.update(carriers, online.teamKills[0]!, online.teamKills[1]!);
    matchHud.frame(dtSec);
  }
  debugHud?.frame(frameMs, nowMs, stage.renderer, game.layers[0]!.set.activeCount, game.ticks);
  if (online && debugHud && nowMs - lastNetInfoMs > 500) {
    lastNetInfoMs = nowMs;
    const s = online.net.stats;
    const pr = online.predictor;
    debugHud.setExtra(
      `ping ${online.clock.rtt.toFixed(0)} ms  snapshots ${s.snapshotsPerSec.toFixed(1)}/s  ` +
        `down ${s.rxBytesPerSec.toFixed(0)} B/s  up ${s.txBytesPerSec.toFixed(0)} B/s\n` +
        `prediction error ${pr.lastError.toFixed(3)} (peak ${pr.peakError.toFixed(2)})  ` +
        `server tick ${online.latestTick}  bad msgs ${s.bad}`,
    );
    pr.peakError = 0;
  }
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
    get game() {
      return session;
    },
    get online() {
      return online;
    },
    input,
    camera: stage.camera,
    assets,
    particleKit,
    stage,
    water,
    get worldMap() {
      return worldMap;
    },
    get mapSeed() {
      return mapSeed;
    },
    get islands() {
      return islands;
    },
    wakeMap,
    effects,
    menu,
    /** GPU/CPU probe for docs/perf.md: await __tb.probe(1920, 1080). */
    probe: async (w: number, h: number) => {
      const { runProbe } = await import('./ui/perfProbe.ts');
      return runProbe(
        {
          stage,
          wakeMap,
          groups: {
            water: [water.mesh],
            islands: islands?.objects ?? [],
            ships: session?.entities.map((e) => e.model.root) ?? [],
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
