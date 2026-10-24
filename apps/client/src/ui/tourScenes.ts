import { t } from '../i18n/index.ts';
import droneIcon from './icons/drone.svg?raw';
import mineIcon from './icons/mine.svg?raw';
import missileIcon from './icons/missile.svg?raw';
import rigIcon from './icons/rig.svg?raw';

/**
 * The little animated pictures of the how-to-play tour, one per step. Plain HTML with the ship pictures of the game
 * and CSS animations (see menu.css, `.tr-scene` and `.sN-*`): nothing is drawn per frame by script.
 */

const icon = (svg: string): string => svg.replace(/ width="\d+" height="\d+"/, '');
const side = (team: 'blue' | 'red', ship: string): string => `${import.meta.env.BASE_URL}icons/ships/side/${team}/${ship}.png`;
const img = (cls: string, src: string): string => `<img class="a ${cls}" alt="" src="${src}" />`;

/** Scene 1: the goal. Allied ships shell the enemy carrier until it goes up. */
function goal(): string {
  return [
    img('s1-blue', side('blue', 'aircraft_carrier')),
    img('s1-red', side('red', 'aircraft_carrier')),
    '<div class="a s1-bar blue"><i></i></div>',
    '<div class="a s1-bar red"><i></i></div>',
    img('s1-ship p1', side('blue', 'frigate')),
    img('s1-ship p2', side('blue', 'corvette')),
    img('s1-ship p3', side('blue', 'frigate')),
    '<div class="a s1-shell p1"></div>',
    '<div class="a s1-shell p2"></div>',
    '<div class="a s1-shell p3"></div>',
    '<div class="a s1-boom"></div>',
  ].join('');
}

/** Scene 2: steering with the keys and shooting with the mouse; the space bar turns auto fire on. */
function drive(): string {
  return [
    `<div class="a s2-ship"><div class="s2-wake"></div><img alt="" src="${side('blue', 'corvette')}" /><div class="a s2-shell"></div><div class="a s2-shell b"></div></div>`,
    img('s2-target', side('red', 'frigate')),
    '<div class="a s2-ring"></div>',
    '<div class="a s2-keys"><kbd class="w">W</kbd><kbd class="ka">A</kbd><kbd class="s">S</kbd><kbd class="d">D</kbd></div>',
    '<div class="a s2-mouse"><i></i></div>',
    `<div class="a s2-mouse-label">${t('tour.s2.fire')}</div>`,
    `<div class="a s2-space">${t('tour.s2.space')}</div>`,
  ].join('');
}

/** Scene 3: a ship sails over crates and banknotes (the money pops up), a red barrel waits to blow up. */
function money(): string {
  // The ship reaches x at about (x + 90) / 770 of the 7 second loop; each pile vanishes then.
  const at = (x: number): string => `animation-delay:${(((x + 40) / 770) * 7 - 0.3).toFixed(2)}s`;
  const item = (cls: string, x: number): string => `<div class="a s3-item ${cls}" style="left:${x}px;${at(x)}"></div>`;
  const pop = (text: string, x: number, gold = false): string =>
    `<div class="a s3-pop${gold ? ' gold' : ''}" style="left:${x}px;${at(x)}">${text}</div>`;
  return [
    item('s3-crate', 110),
    item('s3-cash', 165),
    item('s3-crate', 215),
    item('s3-cash', 320),
    item('s3-gold', 390),
    pop('+10', 110),
    pop('+35', 165),
    pop('+10', 215),
    pop('+35', 320),
    pop('+40', 390, true),
    img('s3-ship', side('blue', 'frigate')),
    '<div class="a s3-warn"></div><div class="a s3-barrel"></div>',
    `<div class="a s3-label">${t('tour.s3.barrel')}</div>`,
    `<div class="a s3-gold-label">${t('tour.s3.gold')}</div>`,
  ].join('');
}

/** Scene 4: the upgrade bars fill, then the ship goes up a class. */
function upgrade(): string {
  const rows = [
    ['1', '#15fffb', '78%'],
    ['2', '#ffd015', '60%'],
    ['3', '#ff6f6f', '88%'],
    ['4', '#6fbfff', '48%'],
    ['5', '#bebcff', '66%'],
    ['6', '#0dff5e', '40%'],
  ] as const;
  const bars = rows
    .map(
      ([key, color, w], i) =>
        `<div class="s4-row"><kbd>${key}</kbd><div class="s4-bar"><i style="--c:${color};--w:${w};animation-delay:${(i * 0.25).toFixed(2)}s"></i></div></div>`,
    )
    .join('');
  return [
    `<div class="a s4-rows">${bars}</div>`,
    `<div class="a s4-class"><div class="a s4-tier">T<b>1</b> → T<b>2</b></div>` +
      '<div class="a s4-burst"></div>' +
      img('s4-ship t1', `${import.meta.env.BASE_URL}icons/ships/card/coast_guard_boat_thalor.png`) +
      img('s4-ship t2', `${import.meta.env.BASE_URL}icons/ships/card/gunboat_thalor.png`) +
      `<div class="a s4-btn">${t('tour.s4.button')} [T]</div></div>`,
  ].join('');
}

/** Scene 5: the capture ring of an oil rig fills for the team that holds it, then the money comes in. */
function rigs(): string {
  return [
    '<svg class="a s5-ring" viewBox="0 0 140 140"><circle class="track" cx="70" cy="70" r="68" /><circle class="gauge" cx="70" cy="70" r="68" /></svg>',
    `<div class="a s5-rig">${icon(rigIcon)}</div>`,
    img('s5-ship a', side('blue', 'frigate')),
    img('s5-ship b', side('blue', 'corvette')),
    '<div class="a s5-cash c1">+1</div><div class="a s5-cash c2">+1</div><div class="a s5-cash c3">+1</div>',
    '<div class="a s5-meter"><i></i></div>',
    `<div class="a s5-meter-label">${t('tour.s5.meter')}</div>`,
  ].join('');
}

/** Scene 6: a ship stands beside the carrier (it mends), the shop button appears, three things to buy. */
function base(): string {
  return [
    img('s6-carrier', side('blue', 'aircraft_carrier')),
    `<div class="a s6-shop">${t('tour.s6.shop')} <kbd>B</kbd></div>`,
    img('s6-ship', side('blue', 'corvette')),
    '<div class="a s6-hp"><i></i></div>',
    `<div class="a s6-repair">${t('tour.s6.repair')}</div>`,
    '<div class="a s6-tiles">' +
      `<div class="s6-tile t1">${icon(droneIcon)}${t('tour.s6.drone')}</div>` +
      `<div class="s6-tile t2">${icon(missileIcon)}${t('tour.s6.missile')} <kbd>Q</kbd></div>` +
      `<div class="s6-tile t3">${icon(mineIcon)}${t('tour.s6.mine')} <kbd>F</kbd></div>` +
      '</div>',
  ].join('');
}

/** The pictures of the tour, in the order of its steps. */
export const TOUR_SCENES: readonly (() => string)[] = [goal, drive, money, upgrade, rigs, base];
