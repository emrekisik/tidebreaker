import {
  DRONE,
  FX,
  KIND,
  MATCH_STATE,
  MAX_PROJECTILES,
  CHEAT,
  MISSILE,
  MINE,
  MINE_BLOCK,
  MINE_CAPACITY,
  mineBlocked,
  NO_WEAPON,
  SHIPS,
  STEP_MS,
  STEP_SEC,
  TEAM_BLUE,
  TEAM_PIRATE,
  TEAM_RED,
  TRAINING,
  WEAPONS,
  WEAPON_IDS,
  WORLD_CENTER,
  boundaryDepth,
  generateMap,
  hullDistance,
  lockRange,
  mapHash,
} from '@tidebreaker/shared';
import type { Combatant, ShipId, WorldMap } from '@tidebreaker/shared';
import { Vector3 } from 'three';
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
import '@fontsource/oxanium/latin-500.css';
import '@fontsource/oxanium/latin-700.css';
import '@fontsource/oxanium/latin-ext-500.css';
import '@fontsource/oxanium/latin-ext-700.css';
import './ui/theme.css';
import { applyI18n, detectLanguage, setLanguage, t } from './i18n/index.ts';
import type { MessageKey } from './i18n/index.ts';
import { Input } from './input/input.ts';
import { AssetProvider, setHologramTime } from './render/assets.ts';
import { BarKit } from './render/barKit.ts';
import { IslandView } from './render/islands.ts';
import type { IslandModel } from './render/islands.ts';
import { ISLAND_FOOTPRINTS } from './render/islandFootprints.ts';
import { createParticleKit } from './render/particleKit.ts';
import { VISUAL_ORDER, createProjectileMeshes } from './render/projectileMesh.ts';
import { Stage } from './render/stage.ts';
import { WakeMap } from './render/wakeMap.ts';
import { Water } from './render/water.ts';
import { DamageNumbers } from './ui/damageNumbers.ts';
import { DebugHud } from './ui/debugHud.ts';
import { Hud } from './ui/hud.ts';
import { MODEL_SPECS, PROP_SPECS } from './render/modelSpecs.ts';
import { LookPanel } from './ui/lookPanel.ts';
import { audio } from './audio/engine.ts';
import { sfx } from './audio/gameSounds.ts';
import { MineView } from './frame/mineView.ts';
import { PickupView } from './frame/pickupView.ts';
import { makePickupMeshes } from './render/pickupMeshes.ts';
import { Announcer } from './ui/announcer.ts';
import { SoundSettings } from './ui/soundSettings.ts';
import { BaseShop } from './ui/baseShop.ts';
import { MissileBadge, MissileLock } from './ui/missileLock.ts';
import { Crosshair, KICK } from './ui/crosshair.ts';
import type { LockProjector } from './ui/missileLock.ts';
import { WreckMarks } from './ui/wreckMarks.ts';
import { EmoteBubbles, EmoteWheel } from './ui/emotes.ts';
import { RigView } from './render/rigs.ts';
import { RigHud } from './ui/rigHud.ts';
import { KillFeed } from './ui/killFeed.ts';
import { MatchHud } from './ui/matchHud.ts';
import { ProgressHud } from './ui/progressHud.ts';
import { NamePlates } from './ui/namePlates.ts';
import { preloadRankIcons } from './ui/rankBadge.ts';
import { RankBook } from './ui/rankBook.ts';
import { RankUp } from './ui/rankUp.ts';
import { ShopButton } from './ui/shopButton.ts';
import { Scoreboard } from './ui/scoreboard.ts';
import { Menu } from './ui/menu.ts';
import { Minimap } from './ui/minimap.ts';
import { ShipPicker } from './ui/shipPicker.ts';

setLanguage(detectLanguage());

/** The HUD is drawn for a 1600 x 900 window and scaled from there (see theme.css). */
function fitUi(): void {
  const k = Math.min(innerWidth / 1600, innerHeight / 900);
  document.documentElement.style.setProperty('--ui-scale', String(Math.min(1.3, Math.max(0.6, k))));
}
addEventListener('resize', fitUi);
fitUi();
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
  particleKit.smoke.mesh,
  particleKit.blaze.mesh,
  particleKit.slick.mesh,
);
const effects = new Effects(particleKit, MAX_PROJECTILES, wakeMap);

const damageNumbers = new DamageNumbers(document.getElementById('dmg-layer') as HTMLElement);
effects.onRepair = (x, y) => damageNumbers.showWrench(stage.camera, x, y);
const assets = new AssetProvider();
// Fleets are built from every ship class and the carrier, so all models load before anything starts.
// (Name plates are drawn into canvases, so the font must be there first.)
await Promise.all([
  document.fonts.load("700 30px 'Oxanium'"),
  document.fonts.load("500 14px 'Oxanium'"),
]);
await assets.preload(Object.keys(MODEL_SPECS));
await assets.preloadProps(Object.keys(PROP_SPECS));
await assets.preloadRocks();
preloadRankIcons();
const bars = new BarKit();

const input = new Input(canvas);
const rig = new CameraRig();
const fixedStep = new FixedStep(STEP_MS);
const hud = new Hud();
const debugHud = debug ? new DebugHud(document.getElementById('debug') as HTMLElement) : null;
const matchHud = new MatchHud();
const pickups = new PickupView(makePickupMeshes(stage.scene, assets));
// Floating things darken the water where they touch it and leave a faint lace of foam.
pickups.contact = (x, z, r) => wakeMap.capsule(x, z, x + 0.02, z, r, 0, 0, 0, 0, FX.pickupContact.shadow, FX.pickupContact.foam);
// The sea mines: one mesh per team, floating like everything else (and leaving a little foam).
const mines = new MineView([assets.createMineMesh('blue', MINE_CAPACITY), assets.createMineMesh('red', MINE_CAPACITY)]);
for (const mesh of mines.meshList) stage.scene.add(mesh);
mines.contact = pickups.contact;
/** Where the shop button hovers above the carrier's deck (world units). */
const SHOP_BUTTON_HEIGHT = 9;
const shopSpot = new Vector3();
/** Height (world units) of the top of a ship's health bar: the name plate sits just above it. */
const PLATE_HEIGHT = 5.1;
const plateSpot = new Vector3();
const plateOut = new Float32Array(2);

/** The screen spot for the name plate of ship `id`; false when it is gone, sunk or off screen. */
function projectPlate(id: number, out: Float32Array): boolean {
  const e = online?.entityOf(id);
  if (!e || !e.combatant.state.alive) return false;
  plateSpot.set(e.pose.x, PLATE_HEIGHT, e.pose.y).project(stage.camera);
  if (plateSpot.z > 1) return false;
  const x = (plateSpot.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-plateSpot.y * 0.5 + 0.5) * window.innerHeight - 4;
  if (x < -160 || x > window.innerWidth + 160 || y < -60 || y > window.innerHeight + 80) return false;
  out[0] = x;
  out[1] = y;
  return true;
}

/** Over the own ship, a little higher than the plate (the promotion pops up there). */
function projectRankUp(out: Float32Array): boolean {
  const me = session?.player;
  if (!me) return false;
  plateSpot.set(me.pose.x, PLATE_HEIGHT + 2, me.pose.y).project(stage.camera);
  if (plateSpot.z > 1) return false;
  out[0] = (plateSpot.x * 0.5 + 0.5) * window.innerWidth;
  out[1] = (-plateSpot.y * 0.5 + 0.5) * window.innerHeight - 30;
  return true;
}

const emoteBubbles = new EmoteBubbles();
const wreckMarks = new WreckMarks();
const crosshair = new Crosshair();
/** The mouse is over the sea (not over a panel or the menu): the crosshair is shown there. */
let overSea = false;
window.addEventListener('pointermove', (e) => {
  overSea = e.target === canvas;
});
document.addEventListener('mouseleave', () => {
  overSea = false;
});
const announcer = new Announcer(document.getElementById('announce') as HTMLElement);
// Sound: the browser only allows audio after the player did something, so the first click or key opens it.
for (const type of ['pointerdown', 'keydown'] as const) {
  window.addEventListener(type, () => audio.unlock(), { capture: true });
}
new SoundSettings(document.getElementById('menu-sound') as HTMLElement);
const soundCtl = document.getElementById('sound-ctl') as HTMLElement;
new SoundSettings(soundCtl);
const emoteWheel = new EmoteWheel((index) => online?.net.emote(index));
const missileLock = new MissileLock(
  document.getElementById('lock-layer') as HTMLElement,
  document.getElementById('missile-warning') as HTMLElement,
  () => online?.net.lock(0),
);
(document.getElementById('missile-warning') as HTMLElement).textContent = t('missile.incoming');
const missileBadge = new MissileBadge(document.getElementById('missile-hud') as HTMLElement);
const baseShop = new BaseShop((item, arg) => {
  if (item === 0) online?.net.buyDrone(arg);
  else online?.net.baseBuy(arg);
});
const progressHud = new ProgressHud(
  (stat) => online?.net.upgrade(stat),
  (choice) => online?.net.tierUp(choice),
);
const rigView = new RigView(stage.scene, assets.prop('oil_rig'));
const rigHud = new RigHud();
const killFeed = new KillFeed(document.getElementById('killfeed') as HTMLElement);
const ranks = new RankBook();
const scoreboard = new Scoreboard(document.getElementById('scoreboard') as HTMLElement, ranks);
ranks.onOwnRank = (rank) => progressHud.setRank(rank);
const plateLayer = document.getElementById('plate-layer') as HTMLElement;
const plates = new NamePlates(plateLayer);
const rankUp = new RankUp(plateLayer);
ranks.onPromoted = (rank) => {
  announcer.rankUp(rank, online?.myTeam ?? TEAM_BLUE);
  rankUp.show(rank, performance.now());
  // The same burst of light as a new class, around the own ship.
  const me = session?.player;
  if (me) {
    effects.upgrade(me.pose.x, me.pose.y, me.combatant.def.length);
    sfx.tierUp(me.pose.x, me.pose.y, true);
  }
};
progressHud.setRank(0);
const shopButton = new ShopButton(document.getElementById('shop-layer') as HTMLElement, () => baseShop.toggle());
baseShop.onToggle = (open) => shopButton.setOpen(open);
const stormEl = document.getElementById('storm') as HTMLElement;
const minimapEl = document.getElementById('minimap') as HTMLElement;
const pickerEl = document.getElementById('picker') as HTMLElement;

// ---- the world the current session plays in (islands, minimap)

let session: GameSession | null = null;
let online: OnlineGame | null = null;
/** The island models that loaded (none: the islands are generated procedurally). */
function islandModels(): IslandModel[] {
  const out: IslandModel[] = [];
  for (const key of ['island_tropical']) {
    const prop = assets.prop(key);
    const footprint = ISLAND_FOOTPRINTS[key];
    if (prop && footprint) out.push({ ...prop, footprint });
  }
  return out;
}

let islands: IslandView | null = null;
let minimap: Minimap | null = null;
let mapSeed = 0;
let worldMap: WorldMap | null = null;

function setWorld(map: WorldMap): void {
  if (islands) for (const o of islands.objects) stage.scene.remove(o);
  worldMap = map;
  islands = new IslandView(map, islandModels(), assets.rocks());
  stage.scene.add(...islands.objects);
  minimapEl.replaceChildren();
  minimap = new Minimap(minimapEl, map);
  mapSeed = map.seed;
  debugHud?.setMapInfo(
    `map seed ${map.seed}  hash ${mapHash(map).toString(16)}  ${map.islandCount} islands, ${map.reefCount} reefs`,
  );
}

window.addEventListener('keydown', (e) => {
  if (online && !e.repeat && (e.target as HTMLElement).tagName !== 'INPUT') {
    if (e.code >= 'Digit1' && e.code <= 'Digit6')
      progressHud.pressStat(Number(e.code.slice(5)) - 1);
    else if (e.code === 'KeyT') progressHud.pressTierUp(0);
    else if (e.code === 'KeyY') progressHud.pressTierUp(1);
    else if (e.code >= 'Digit7' && e.code <= 'Digit9') baseShop.press(Number(e.code.slice(5)) - 7);
    else if (e.code === 'Digit0') baseShop.press(3);
    else if (e.code === 'KeyE') baseShop.press(4);
    else if (e.code === 'KeyR') baseShop.press(5);
    else if (e.code === 'KeyF') pressLayMine();
    else if (e.code === 'KeyB') baseShop.toggle();
    else if (e.code === 'F9') online.net.cheat(CHEAT.MONEY);
    else if (e.code === 'KeyQ') pressLock();
  }
  if (e.code === 'Tab') {
    // The scoreboard replaces the browser's focus change.
    e.preventDefault();
    if (online) scoreboard.hold(true);
  }
  if (e.code === 'KeyC' && !e.repeat && online && (e.target as HTMLElement).tagName !== 'INPUT') {
    emoteWheel.press();
    sfx.click();
  }
  if (e.code === 'KeyM' && !e.repeat && minimap && (e.target as HTMLElement).tagName !== 'INPUT') {
    minimap.toggle();
    minimapEl.classList.toggle('big');
  }
});

window.addEventListener('keyup', (e) => {
  if (e.code === 'KeyC') emoteWheel.release();
  if (e.code === 'Tab') scoreboard.hold(false);
});
window.addEventListener('blur', () => scoreboard.hold(false));

// ---- effects shared by the sandbox and online matches

/** The match is over (so its end sounds once). */
let matchEnded = false;

const events: OnlineEvents = {
  onShot(x, y, angle, weaponIdx, power = 0, own = false) {
    const visual = WEAPONS[WEAPON_IDS[weaponIdx]!].visual;
    effects.muzzle(x, y, angle, visual, power);
    // The player's own shots kick the crosshair, the heavier the shot the harder.
    if (own) crosshair.shot(KICK[visual]);
    sfx.shot(weaponIdx, x, y, own);
  },
  onHit(x, y, damage, shieldHit, killed, target, weaponIdx, showNumber = true, power = 0) {
    if (showNumber && damage > 0) damageNumbers.show(stage.camera, x, y, damage, shieldHit);
    // (A barrel blast hurts without a weapon: its own effect is played by onBlast.)
    if (weaponIdx === NO_WEAPON) return;
    effects.impact(x, y, shieldHit, WEAPONS[WEAPON_IDS[weaponIdx]!].visual, power);
    // (A ship that goes down is heard in onSunk.)
    if (!killed) sfx.hit(x, y, damage, showNumber, weaponIdx);
    if (killed) {
      const c = target.combatant;
      effects.explode(c.state.x, c.state.y, c.def.length, c.def.flying !== true);
    }
  },
  onMiss(x, y, weaponIdx, power = 0) {
    effects.splash(x, y, WEAPONS[WEAPON_IDS[weaponIdx]!].visual, power);
    sfx.splash(x, y, weaponIdx);
  },
  onBlocked(x, y, weaponIdx, power = 0) {
    effects.blocked(x, y, WEAPONS[WEAPON_IDS[weaponIdx]!].visual, power);
    sfx.blocked(x, y);
  },
  onIslandHit(x, y, impact, ship) {
    effects.shore(x, y, impact);
    sfx.shore(x, y, impact);
    if (ship === session?.player) rig.shake(Math.min(0.8, impact * 0.05));
  },
  onCollision(x, y, impact, a, b, damageA, damageB, killedA, killedB) {
    effects.collision(x, y, impact);
    sfx.collision(x, y, impact, a === session?.player || b === session?.player);
    if (damageA > 0) damageNumbers.show(stage.camera, a.pose.x, a.pose.y, damageA, false);
    if (damageB > 0) damageNumbers.show(stage.camera, b.pose.x, b.pose.y, damageB, false);
    if (killedA) effects.explode(a.combatant.state.x, a.combatant.state.y, a.combatant.def.length);
    if (killedB) effects.explode(b.combatant.state.x, b.combatant.state.y, b.combatant.def.length);
    // The camera rattles when the player is involved.
    const me = session?.player;
    if (a === me || b === me) rig.shake(Math.min(0.9, impact * 0.045));
  },
  onUpgrade(x, y, length) {
    effects.upgrade(x, y, length);
    const me = session?.player;
    sfx.tierUp(x, y, me !== undefined && Math.hypot(me.pose.x - x, me.pose.y - y) < 6);
    damageNumbers.showArrows(stage.camera, x, y);
  },
  onScore(x, y, points) {
    damageNumbers.showScore(stage.camera, x, y, points);
    sfx.scored();
  },
  onMissile(id, owner, target) {
    if (owner === online?.myId) missileLock.launched(id, target);
    if (target === online?.myId && owner !== online?.myId) missileLock.warn(id);
  },
  onSplash(x, y, radius) {
    // The area of a splash weapon: a small fireball and shock ring over the area it hurts.
    effects.blast(x, y, radius * 1.6);
    sfx.blast(x, y, radius * 2.4);
  },
  onAnnounce(kind, arg, team, name) {
    announcer.show(kind, arg, team, name);
    sfx.announce(kind, team === online?.myTeam);
  },
  onIntercept(x, y, weaponIdx, missile) {
    // A shot hit the missile: sparks; a destroyed missile also goes off in a small fireball.
    effects.impact(x, y, false, WEAPONS[WEAPON_IDS[weaponIdx]!].visual);
    if (missile) effects.blast(x, y, 4);
    sfx.intercept(x, y, missile);
  },
  onMissileEnd(id) {
    missileLock.ended(id);
  },
  onLockBreak() {
    missileLock.cancel();
  },
  onEmote(shipId, emote) {
    emoteBubbles.show(shipId, emote, performance.now());
    const at = online?.entityOf(shipId);
    if (at) sfx.emote(at.pose.x, at.pose.y, shipId === online?.myId);
  },
  onBlast(x, y, R) {
    effects.blast(x, y, R);
    sfx.blast(x, y, R);
    // The camera jolts when it goes off near the player.
    const me = session?.player;
    if (me) {
      const d = Math.hypot(me.pose.x - x, me.pose.y - y);
      if (d < R * 3) rig.shake(Math.min(0.9, (1 - d / (R * 3)) * 0.9));
    }
  },
  onSunk(entity, x, y, name, id) {
    if (name) {
      const team = entity.combatant.team;
      const ranked = team === TEAM_BLUE || team === TEAM_RED;
      wreckMarks.add(x, y, name, teamNameOf(team), performance.now(), ranked ? ranks.of(id) : null);
    }
    effects.explode(x, y, entity.combatant.def.length, entity.combatant.def.flying !== true);
    sfx.sunk(x, y, entity.combatant.def.length, entity.combatant.def.flying === true);
  },
  onDied(killerId, killerName, respawnSec) {
    // Carriers are entities 1 and 2.
    matchHud.died(killerId <= 2 ? t('death.byCarrier') : killerName, respawnSec);
    rig.shake(0.9);
    sfx.died();
  },
  onMatch(state, winner, restartSec) {
    matchHud.setMatch(state, winner, restartSec);
    if (state === MATCH_STATE.ENDED && !matchEnded) sfx.matchEnded(winner === online?.myTeam);
    matchEnded = state === MATCH_STATE.ENDED;
    scoreboard.pin(state === MATCH_STATE.ENDED);
  },
  onStats(m) {
    progressHud.update(m);
    sfx.stats(m);
    baseShop.setStats(m.cash, m.drones, m.baseGuns, m.missiles, m.mines, m.tier);
    missileBadge.set(m.missiles, m.mines, m.tier >= MISSILE.minTier);
  },
  onRigs(rows) {
    rigView.set(rows);
    rigHud.update(rows);
  },
  onPickup(kind, value, x, y) {
    damageNumbers.showGain(stage.camera, x, y, value);
    damageNumbers.flyCash(stage.camera, x, y, value);
    sfx.pickup(kind === KIND.GOLD);
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
      killerId > 2 && killerTeam !== TEAM_PIRATE ? ranks.of(killerId) : null,
      victimId > 2 && victimTeam !== TEAM_PIRATE ? ranks.of(victimId) : null,
    );
  },
  onScores(rows, myId) {
    ranks.update(rows, myId);
    plates.applyRanks((id) => ranks.of(id));
    scoreboard.update(rows, myId);
  },
  onJoined() {
    ranks.reset();
    progressHud.setRank(0);
    matchHud.respawned();
    missileLock.reset();
    sfx.appeared();
    audio.startAmbient();
    soundCtl.classList.remove('hidden');
  },
  onClosed() {
    plates.clear();
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
  audio.startAmbient();
  soundCtl.classList.remove('hidden');
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

const menu = new Menu((name, shipIdx) => void startOnline(name, shipIdx), debug);

async function startOnline(name: string, shipIdx: number): Promise<void> {
  menu.setBusy(true);
  const game = new OnlineGame({
    scene: stage.scene,
    assets,
    bars,
    pickups,
    mines,
    events,
    url: serverUrl,
    name,
    shipIdx,
    plates,
    rankOf: (id) => ranks.of(id),
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
  progressHud.show(true);
  rigHud.show(true);
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
const emoteSpot = new Vector3();
/** World position of ship `id` (for the emote bubbles); false when the ship is gone. */
function whereEmote(id: number, out: Float32Array): boolean {
  const e = online?.entityOf(id);
  if (!e) return false;
  out[0] = e.pose.x;
  out[1] = e.pose.y;
  return true;
}
/** Screen position (pixels) of the point over a world position, for the emote bubbles. */
function projectEmote(x: number, y: number, out: Float32Array): boolean {
  emoteSpot.set(x, 7, y).project(stage.camera);
  if (emoteSpot.z > 1) return false;
  out[0] = (emoteSpot.x * 0.5 + 0.5) * window.innerWidth;
  out[1] = (-emoteSpot.y * 0.5 + 0.5) * window.innerHeight - 6;
  return true;
}
/** Screen position (pixels) of a world position on the water, for the marks of sunk ships. */
function projectWreck(x: number, y: number, out: Float32Array): boolean {
  emoteSpot.set(x, 1, y).project(stage.camera);
  if (emoteSpot.z > 1) return false;
  out[0] = (emoteSpot.x * 0.5 + 0.5) * window.innerWidth;
  out[1] = (-emoteSpot.y * 0.5 + 0.5) * window.innerHeight;
  return true;
}
const lockSpot = new Vector3();
const lockEdge = new Vector3();
/** Where ship `id` is on the screen (pixels) and half its size, for the lock-on reticle; false when it is off the screen. */
const lockProjector: LockProjector = {
  project(id, out) {
    const e = online?.entityOf(id);
    if (!e || !e.combatant.state.alive) return false;
    const x = e.pose.x;
    const y = e.pose.y;
    lockSpot.set(x, 0.8, y).project(stage.camera);
    if (lockSpot.z > 1 || Math.abs(lockSpot.x) > 1 || Math.abs(lockSpot.y) > 1) return false;
    lockEdge.set(x + e.combatant.def.length * 0.5, 0.8, y).project(stage.camera);
    const w = window.innerWidth;
    const h = window.innerHeight;
    out[0] = (lockSpot.x * 0.5 + 0.5) * w;
    out[1] = (-lockSpot.y * 0.5 + 0.5) * h;
    out[2] = Math.hypot((lockEdge.x - lockSpot.x) * 0.5 * w, (lockEdge.y - lockSpot.y) * 0.5 * h);
    return true;
  },
};
const lockProbe = new Float32Array(3);
/** The enemy ship nearest to the mouse that is on the screen and within lock range (entity id, 0 = none). */
function pickLockTarget(me: Combatant): number {
  if (!online) return 0;
  const reach = lockRange(online.progress.tier);
  const mx = (input.ndcX * 0.5 + 0.5) * window.innerWidth;
  const my = (-input.ndcY * 0.5 + 0.5) * window.innerHeight;
  let best = 0;
  let bestDist = 240;
  for (const e of online.entities) {
    const c = e.combatant;
    if (e === online.player || c.team === me.team || c.def.vMax === 0 || c.def.flying) continue;
    if (!c.state.alive || Math.hypot(e.pose.x - me.state.x, e.pose.y - me.state.y) > reach) continue;
    if (!lockProjector.project(c.id, lockProbe)) continue;
    const d = Math.hypot(lockProbe[0]! - mx, lockProbe[1]! - my);
    if (d < bestDist) {
      bestDist = d;
      best = c.id;
    }
  }
  return best;
}
/** The lock key: starts locking a missile onto the ship under the mouse, or cancels a lock in progress. */
function pressLock(): void {
  if (!online || !session) return;
  if (missileLock.locking) {
    missileLock.cancel();
    online.net.lock(0);
    return;
  }
  const mine = online.progress;
  if (!session.player.combatant.state.alive) return;
  if (mine.tier < MISSILE.minTier) return missileBadge.flash(t('lock.tier'));
  if (mine.missiles <= 0) return missileBadge.flash(t('lock.empty'));
  const target = pickLockTarget(session.player.combatant);
  if (target === 0) return missileBadge.flash(t('lock.none'));
  missileLock.begin(target);
  online.net.lock(target);
}
/** The lay key: puts a sea mine in the water where the ship is (the server has the last word on place and limits). */
function pressLayMine(): void {
  if (!online || !session) return;
  const me = session.player.combatant;
  if (!me.state.alive) return;
  const mine = online.progress;
  if (mine.tier < MINE.minTier) return missileBadge.flash(t('lock.tier'));
  if (mine.mines <= 0) return missileBadge.flash(t('mine.empty'));
  const blocked = mineBlocked(me.state.x, me.state.y, me.team);
  if (blocked === MINE_BLOCK.RIG) return missileBadge.flash(t('mine.blockedRig'));
  if (blocked === MINE_BLOCK.CARRIER) return missileBadge.flash(t('mine.blockedCarrier'));
  online.net.layMine();
}
const teamNameOf = (team: number): string => (team === 0 ? 'blue' : team === 1 ? 'red' : 'pirate');
const carriers: (Combatant | undefined)[] = [undefined, undefined];

function update(nowMs: number): void {
  const frameMs = nowMs - lastMs;
  lastMs = nowMs;
  const dtSec = Math.max(0, Math.min(frameMs, 100)) / 1000;
  const timeSec = nowMs / 1000;
  setHologramTime(timeSec);

  crosshair.update(
    dtSec,
    (input.ndcX * 0.5 + 0.5) * window.innerWidth,
    (-input.ndcY * 0.5 + 0.5) * window.innerHeight,
    overSea && !document.body.classList.contains('in-menu'),
  );

  const wheel = input.consumeWheel();
  if (wheel !== 0) rig.zoomBy(wheel);

  if (!session) {
    // Menu screen: the open sea, a slowly turning view.
    baseShop.show(false);
    wakeMap.begin(rig.focusX, rig.focusZ, dtSec);
    effects.update(dtSec);
    rig.update(stage.camera, WORLD_CENTER + Math.cos(timeSec * 0.05) * 60, WORLD_CENTER, dtSec, 3);
    stage.followSun(rig.focusX, rig.focusZ);
    wakeMap.render(stage.renderer);
    water.setWake(wakeMap.texture, wakeMap.origin.x, wakeMap.origin.y);
    water.update(timeSec, rig.focusX, rig.focusZ);
    water.setShadow(stage.sunShadowMap, stage.sunShadowMatrix);
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
  audio.setListener(p.x, p.y);
  audio.setEngine(Math.abs(ps.speed) / game.player.combatant.def.vMax, ps.alive);
  rig.update(stage.camera, p.x, p.y, dtSec, game.player.combatant.def.tier);
  // (The reticles, bubbles and the wheel are projected with this frame's camera.)
  stage.camera.updateMatrixWorld();
  stage.followSun(rig.focusX, rig.focusZ);
  // (The pickups stamp where they touch the water into the foam map, so they come before it is drawn.)
  pickups.update(timeSec, rig.focusX, rig.focusZ);
  wakeMap.render(stage.renderer);
  water.setWake(wakeMap.texture, wakeMap.origin.x, wakeMap.origin.y);
  water.update(timeSec, rig.focusX, rig.focusZ);
  water.setShadow(stage.sunShadowMap, stage.sunShadowMatrix);
  islands?.update(timeSec);

  others.length = 0;
  carriers[0] = undefined;
  carriers[1] = undefined;
  for (const e of game.entities) {
    if (e === game.player) continue;
    others.push(e.combatant);
    if (e.combatant.def.vMax === 0) carriers[e.combatant.team] = e.combatant;
  }
  minimap?.update(ps, others, online?.rigState ?? null, stage.camera);
  emoteBubbles.update(nowMs, whereEmote, projectEmote);
  wreckMarks.update(nowMs, projectWreck);
  missileLock.update(dtSec, lockProjector);
  mines.update(timeSec, rig.focusX, rig.focusZ);
  missileBadge.update(dtSec);
  if (emoteWheel.isOpen) {
    // The wheel is drawn around the player's own ship, where the camera sees it (the smoothed pose,
    // not the 20 Hz tick state, and the camera matrices of this very frame, else it shakes).
    emoteSpot.set(p.x, 1, p.y).project(stage.camera);
    emoteWheel.update((emoteSpot.x * 0.5 + 0.5) * window.innerWidth, (-emoteSpot.y * 0.5 + 0.5) * window.innerHeight);
  }
  // The base shop can be opened while the player's ship is at its own carrier: a button shows over the carrier.
  const ownCarrier = online ? carriers[online.myTeam] : undefined;
  if (ownCarrier) baseShop.setCarrierHull(ownCarrier.state.hull / ownCarrier.def.hull);
  const atCarrier =
    ownCarrier !== undefined &&
    ps.alive &&
    hullDistance(ownCarrier.state, ownCarrier.def, ps.x, ps.y) <= DRONE.buyRadius;
  baseShop.show(atCarrier);
  if (atCarrier && ownCarrier) {
    // The button sits on the deck, toward the player's ship (the carrier's middle can be off screen).
    const cs = ownCarrier.state;
    const dx = ps.x - cs.x;
    const dy = ps.y - cs.y;
    const d = Math.hypot(dx, dy) || 1;
    const reach = Math.min(d, ownCarrier.def.length * 0.3);
    shopSpot.set(cs.x + (dx / d) * reach, SHOP_BUTTON_HEIGHT, cs.y + (dy / d) * reach).project(stage.camera);
    const bx = Math.max(70, Math.min(window.innerWidth - 70, (shopSpot.x * 0.5 + 0.5) * window.innerWidth));
    const by = Math.max(40, Math.min(window.innerHeight - 40, (-shopSpot.y * 0.5 + 0.5) * window.innerHeight));
    shopButton.update(shopSpot.z < 1, bx, by);
  } else {
    shopButton.update(false, 0, 0);
  }
  plates.update(projectPlate);
  rankUp.update(nowMs, projectRankUp, plateOut);
  const storm = boundaryDepth(p.x, p.y);
  if (storm !== lastStorm) {
    lastStorm = storm;
    stormEl.style.opacity = String(Math.min(1, storm * 1.25));
  }
  stage.render();

  hud.update(
    ps,
    game.player.combatant.def,
    game.kills,
    nowMs,
    dtSec,
    online ? online.progress.maxShield : undefined,
  );
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
    audio,
    /** Lock-on pieces, for checks from the console. */
    lock: {
      ui: missileLock,
      project: lockProjector,
      pick: () => (session ? pickLockTarget(session.player.combatant) : 0),
    },
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
              particleKit.smoke.mesh,
              particleKit.blaze.mesh,
              particleKit.slick.mesh,
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
