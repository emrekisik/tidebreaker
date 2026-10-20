import { RANKS } from '@tidebreaker/shared';

/**
 * Rank insignia, drawn in code (no image files): a navy shield-shaped patch with metal stripes, stars and flowers.
 *   rank 0-3    silver diagonal stripes (1-4)
 *   rank 4-7    silver bar on top, an eagle and silver chevrons (1-4)
 *   rank 8-11   red bar, 1-4 silver flowers, emblem, a red arch and a red chevron
 *   rank 12-15  gold bar, 1-4 gold stars, emblem, a gold arch and two gold chevrons
 *   rank 16     its own design (topRankSvg): royal blue with golden rays, double gold border, laurel wreath, five stars, a ruby;
 *               it also glows in the UI (the `rank-top` class). Only one player of a team holds it.
 * The patch is 60 x 80 units; shown about 20 px tall beside a name.
 */

type Metal = 'gold' | 'silver' | 'red';

const METAL_STOPS: Readonly<Record<Metal, readonly [string, string, string, string]>> = {
  gold: ['#fff3b0', '#f6c846', '#d9a024', '#9a6a12'],
  silver: ['#ffffff', '#dde3ea', '#aab3bf', '#78818e'],
  red: ['#ff9a90', '#f03a2e', '#c4170f', '#7d0b07'],
};

function f(v: number): string {
  return String(Math.round(v * 100) / 100);
}

/** A star with `points` points around (cx, cy). */
function star(cx: number, cy: number, r: number, points: number, inner: number, fill: string): string {
  const pts: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    const rad = i % 2 === 0 ? r : r * inner;
    pts.push(`${f(cx + Math.cos(a) * rad)},${f(cy + Math.sin(a) * rad)}`);
  }
  return `<polygon points="${pts.join(' ')}" fill="${fill}" stroke="rgba(0,0,0,.35)" stroke-width=".4"/>`;
}

/** A downward chevron band across the patch: ends at height `y`, point `depth` lower, `thick` thick. */
function vBand(x0: number, x1: number, y: number, depth: number, thick: number, fill: string): string {
  const mid = (x0 + x1) / 2;
  return (
    `<polygon points="${f(x0)},${f(y)} ${f(mid)},${f(y + depth)} ${f(x1)},${f(y)} ${f(x1)},${f(y + thick)} ${f(mid)},${f(y + depth + thick)} ${f(x0)},${f(y + thick)}" fill="${fill}" stroke="rgba(0,0,0,.4)" stroke-width=".5" stroke-linejoin="round"/>` +
    `<polyline points="${f(x0)},${f(y + 0.5)} ${f(mid)},${f(y + depth + 0.5)} ${f(x1)},${f(y + 0.5)}" fill="none" stroke="rgba(255,255,255,.55)" stroke-width=".6"/>`
  );
}

/** An arch (rocker) band: ends at height `y`, its middle `rise` higher. */
function arch(x0: number, x1: number, y: number, rise: number, thick: number, fill: string): string {
  const mid = (x0 + x1) / 2;
  return (
    `<path d="M${f(x0)} ${f(y)} Q${f(mid)} ${f(y - rise * 2)} ${f(x1)} ${f(y)} L${f(x1)} ${f(y + thick)} Q${f(mid)} ${f(y - rise * 2 + thick)} ${f(x0)} ${f(y + thick)}Z" fill="${fill}" stroke="rgba(0,0,0,.4)" stroke-width=".5" stroke-linejoin="round"/>` +
    `<path d="M${f(x0)} ${f(y + 0.5)} Q${f(mid)} ${f(y - rise * 2 + 0.5)} ${f(x1)} ${f(y + 0.5)}" fill="none" stroke="rgba(255,255,255,.55)" stroke-width=".6"/>`
  );
}

/** A diagonal stripe rising to the right, from (x0, y0) to (x1, y1). */
function stripe(x0: number, y0: number, x1: number, y1: number, thick: number, fill: string): string {
  const h = thick / 2;
  return (
    `<polygon points="${f(x0)},${f(y0 - h)} ${f(x1)},${f(y1 - h)} ${f(x1)},${f(y1 + h)} ${f(x0)},${f(y0 + h)}" fill="${fill}" stroke="rgba(0,0,0,.4)" stroke-width=".5" stroke-linejoin="round"/>` +
    `<line x1="${f(x0)}" y1="${f(y0 - h + 0.5)}" x2="${f(x1)}" y2="${f(y1 - h + 0.5)}" stroke="rgba(255,255,255,.6)" stroke-width=".6"/>`
  );
}

/** One wing of the eagle (the right one; the left is its mirror): a smooth underside, feathers fanning up along the top. */
const EAGLE_WING =
  'M1.6 1.6C4.6 2.6 9.4 0.6 11.9 -5.8L9.7 -4.5L10 -7.9L7.8 -5.3L7.3 -8.3L5.6 -5.4L4.7 -7.9L3.5 -5L2 -6.7L1.2 -3.4Z';
const EAGLE_BODY =
  'M0 -3.7C2 -3.6 2.7 -1.5 2.4 0.5L1.8 2.7L3.2 7.4L0.9 6.4L0 8L-0.9 6.4L-3.2 7.4L-1.8 2.7L-2.4 0.5C-2.7 -1.5 -2 -3.6 0 -3.7Z';

/**
 * The emblem: an eagle with spread wings, its head turned to the right, a small shield on its chest. Centered on
 * (30, cy); `k` scales it (the eagle is about 24 x 16 units at k = 1).
 */
function emblem(cy: number, fill: string, k = 1.4): string {
  const wing = (mirror: boolean): string => {
    const t = mirror ? ' transform="scale(-1 1)"' : '';
    return (
      `<g${t}><path d="${EAGLE_WING}" fill="${fill}" stroke="rgba(0,0,0,.5)" stroke-width=".45" stroke-linejoin="round"/>` +
      // the feather lines
      `<path d="M2.4 -0.8L9.6 -4.6M2.8 0.4L7.6 -5.2M3.2 1.2L5.5 -5.3M3.4 1.7L4.7 -7.8" fill="none" stroke="rgba(0,0,0,.28)" stroke-width=".3"/></g>`
    );
  };
  return (
    `<g transform="translate(30 ${f(cy)}) scale(${f(k)})">` +
    wing(false) +
    wing(true) +
    `<path d="${EAGLE_BODY}" fill="${fill}" stroke="rgba(0,0,0,.5)" stroke-width=".45" stroke-linejoin="round"/>` +
    // head with a flat brow and a hooked beak, and the eye
    `<path d="M-1 -3.7C-1.2 -5.6 0 -7 1.7 -6.8L2.7 -6.2L4.3 -5.2L2.9 -4.7L2.4 -3.9C1.2 -3.3 -.2 -3.3 -1 -3.7Z" fill="${fill}" stroke="rgba(0,0,0,.5)" stroke-width=".4" stroke-linejoin="round"/>` +
    `<path d="M.6 -6.2L2.4 -5.6" fill="none" stroke="rgba(0,0,0,.55)" stroke-width=".4"/>` +
    `<circle cx="1.4" cy="-5.5" r=".32" fill="#10182f"/>` +
    // the shield on the chest
    `<path d="M-1.6 -1.5H1.6V1.2Q1.6 2.7 0 3.4Q-1.6 2.7 -1.6 1.2Z" fill="#14296a" stroke="rgba(0,0,0,.55)" stroke-width=".35"/>` +
    `<path d="M-1.6 -0.3H1.6M0 -1.5V3.3" fill="none" stroke="${fill}" stroke-width=".45"/>` +
    `</g>`
  );
}

function defs(metal: Metal): string {
  const [a, b, c, d] = METAL_STOPS[metal];
  return (
    `<defs>` +
    `<linearGradient id="n" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1c3270"/><stop offset="1" stop-color="#0b1740"/></linearGradient>` +
    `<linearGradient id="m" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset=".35" stop-color="${b}"/><stop offset=".7" stop-color="${c}"/><stop offset="1" stop-color="${d}"/></linearGradient>` +
    `<linearGradient id="e" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".5" stop-color="#cfd6de"/><stop offset="1" stop-color="#8d96a3"/></linearGradient>` +
    `<pattern id="p" width="2.4" height="4" patternUnits="userSpaceOnUse"><rect width="1" height="4" fill="#fff" opacity=".07"/></pattern>` +
    `</defs>`
  );
}

const PATCH = 'M3 3H57V59Q57 61 55 62L31 77Q30 77.6 29 77L5 62Q3 61 3 59Z';

/** Sparkle: a small four-pointed star. */
function sparkle(cx: number, cy: number, r: number, opacity: number): string {
  const q = r * 0.22;
  return `<polygon points="${f(cx)},${f(cy - r)} ${f(cx + q)},${f(cy - q)} ${f(cx + r)},${f(cy)} ${f(cx + q)},${f(cy + q)} ${f(cx)},${f(cy + r)} ${f(cx - q)},${f(cy + q)} ${f(cx - r)},${f(cy)} ${f(cx - q)},${f(cy - q)}" fill="#fff" opacity="${opacity}"/>`;
}

/** One side of a laurel wreath (the other side is its mirror): leaves along a curve up the edge of the patch. */
function laurel(): string {
  const leaves: string[] = [];
  const n = 8;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = 13 - 3.2 * Math.sin(Math.PI * t) + 1.5 * t;
    const y = 66 - 38 * t;
    const size = 1 - 0.28 * t;
    // An outer leaf (pointing up and out) and an inner one (up and in).
    leaves.push(`<ellipse cx="${f(4.4 * size)}" cy="0" rx="${f(4.4 * size)}" ry="${f(1.8 * size)}" transform="translate(${f(x)} ${f(y)}) rotate(${f(-128 + 18 * t)})" fill="url(#m)" stroke="rgba(0,0,0,.45)" stroke-width=".35"/>`);
    leaves.push(`<ellipse cx="${f(4.2 * size)}" cy="0" rx="${f(4.2 * size)}" ry="${f(1.7 * size)}" transform="translate(${f(x)} ${f(y)}) rotate(${f(-52 - 10 * t)})" fill="url(#m)" stroke="rgba(0,0,0,.45)" stroke-width=".35"/>`);
  }
  return leaves.join('');
}

/** The top rank: a patch of its own: royal blue with golden rays, a double gold border, a laurel wreath, five stars and a ruby. */
function topRankSvg(): string {
  const [a, b, c, d] = METAL_STOPS.gold;
  const rays: string[] = [];
  for (let i = 0; i < 18; i++) {
    const a0 = (i / 18) * Math.PI * 2;
    const a1 = a0 + Math.PI / 36;
    rays.push(`<polygon points="30,38 ${f(30 + Math.cos(a0) * 70)},${f(38 + Math.sin(a0) * 70)} ${f(30 + Math.cos(a1) * 70)},${f(38 + Math.sin(a1) * 70)}" fill="#ffe9a0" opacity=".13"/>`);
  }
  const body: string[] = [
    `<path d="${PATCH}" fill="url(#bg)"/>`,
    `<g clip-path="url(#clip)">${rays.join('')}</g>`,
    `<g transform="translate(30 40) scale(.9) translate(-30 -40)"><path d="${PATCH}" fill="none" stroke="url(#m)" stroke-width=".9"/></g>`,
    laurel(),
    `<g transform="matrix(-1 0 0 1 60 0)">${laurel()}</g>`,
    `<rect x="3" y="3" width="54" height="5" fill="url(#m)" stroke="rgba(0,0,0,.5)" stroke-width=".4"/>`,
  ];
  const stars: readonly [number, number, number][] = [
    [12, 19, 3.2],
    [21, 15, 3.6],
    [30, 12.5, 5],
    [39, 15, 3.6],
    [48, 19, 3.2],
  ];
  for (const [x, y, r] of stars) body.push(star(x, y, r, 5, 0.42, 'url(#m)'));
  body.push(emblem(35, 'url(#m)', 1.35));
  // The ruby on a gold setting.
  body.push(
    `<polygon points="30,46.5 37.5,54.5 30,64 22.5,54.5" fill="url(#ruby)" stroke="url(#m)" stroke-width="1.3" stroke-linejoin="round"/>` +
      `<polygon points="30,46.5 37.5,54.5 30,54.5" fill="#fff" opacity=".28"/>` +
      `<polygon points="30,49 33.6,54.5 30,52.6" fill="#fff" opacity=".35"/>`,
  );
  body.push(sparkle(46, 33, 2.6, 0.9), sparkle(14, 47, 2, 0.8), sparkle(40, 70, 1.8, 0.7));
  body.push(`<path d="${PATCH}" fill="none" stroke="url(#m)" stroke-width="2" stroke-linejoin="round"/>`);
  body.push(`<path d="${PATCH}" fill="none" stroke="#050a1f" stroke-width=".6" stroke-linejoin="round" transform="translate(30 40) scale(.985) translate(-30 -40)"/>`);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 80"><defs>` +
    `<linearGradient id="m" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset=".35" stop-color="${b}"/><stop offset=".7" stop-color="${c}"/><stop offset="1" stop-color="${d}"/></linearGradient>` +
    `<radialGradient id="bg" cx=".5" cy=".42" r=".75"><stop offset="0" stop-color="#3a52c4"/><stop offset=".55" stop-color="#1a2a78"/><stop offset="1" stop-color="#080d30"/></radialGradient>` +
    `<radialGradient id="ruby" cx=".38" cy=".3" r=".8"><stop offset="0" stop-color="#ffb3bd"/><stop offset=".35" stop-color="#ee1c36"/><stop offset="1" stop-color="#650212"/></radialGradient>` +
    `<clipPath id="clip"><path d="${PATCH}"/></clipPath>` +
    `</defs>${body.join('')}</svg>`
  );
}

/** The SVG text of the insignia of `rank` (0 = lowest). */
export function rankSvg(rank: number): string {
  const r = Math.max(0, Math.min(RANKS.count - 1, Math.floor(rank)));
  if (r === RANKS.count - 1) return topRankSvg();
  const metal: Metal = r >= 12 ? 'gold' : r >= 8 ? 'red' : 'silver';
  const m = 'url(#m)';
  const body: string[] = [`<path d="${PATCH}" fill="url(#n)"/>`, `<path d="${PATCH}" fill="url(#p)"/>`];
  if (r < 4) {
    // Diagonal stripes, centered low on the patch.
    const n = r + 1;
    const base = 48 - (n - 1) * 4;
    for (let i = 0; i < n; i++) body.push(stripe(8, base + i * 8, 52, base + i * 8 - 13, 4.2, m));
  } else {
    const silverRow = r < 8;
    body.push(`<rect x="3" y="3" width="54" height="3.6" fill="${m}" stroke="rgba(0,0,0,.4)" stroke-width=".4"/>`);
    const emblemFill = silverRow || metal === 'red' ? 'url(#e)' : m;
    if (silverRow) {
      const n = r - 3;
      body.push(emblem(22, emblemFill, 1.4));
      for (let i = 0; i < n; i++) body.push(vBand(5, 55, 36 + i * 6.2, 9, 4, m));
    } else if (metal === 'red') {
      const n = r - 7;
      for (let i = 0; i < n; i++) body.push(star(30 + (i - (n - 1) / 2) * 11, 14, 3.6, 8, 0.55, 'url(#e)'));
      body.push(emblem(29, emblemFill, 1.3));
      body.push(arch(5, 55, 49, 6, 4.6, m));
      body.push(vBand(5, 55, 56, 7, 3.6, m));
      body.push(star(30, 54, 2.2, 8, 0.55, 'url(#e)'));
    } else {
      const n = r - 11;
      for (let i = 0; i < n; i++) body.push(star(30 + (i - (n - 1) / 2) * 11, 13.5, 3.8, 5, 0.42, m));
      body.push(emblem(29, emblemFill, 1.3));
      body.push(arch(7, 53, 46, 5.5, 4.2, m));
      body.push(vBand(7, 53, 51.5, 6.5, 3.4, m));
      body.push(vBand(7, 53, 57, 6.5, 3.2, m));
      body.push(star(30, 52.5, 2.1, 5, 0.42, m));
    }
  }
  body.push(`<path d="${PATCH}" fill="none" stroke="#050a1f" stroke-width="1.4" stroke-linejoin="round"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 80">${defs(metal)}${body.join('')}</svg>`;
}

const urls: string[] = [];

/** A `data:` URL of the insignia of `rank` (made once). */
export function rankIconUrl(rank: number): string {
  const r = Math.max(0, Math.min(RANKS.count - 1, Math.floor(rank)));
  urls[r] ??= `data:image/svg+xml,${encodeURIComponent(rankSvg(r))}`;
  return urls[r]!;
}

/** An <img> of the insignia of `rank`, for the left of a name. `title`: the tooltip. */
export function rankBadge(rank: number, title: string): HTMLImageElement {
  const img = document.createElement('img');
  img.className = rank >= RANKS.count - 1 ? 'rank-badge rank-top' : 'rank-badge';
  img.src = rankIconUrl(rank);
  img.alt = title;
  img.title = title;
  img.draggable = false;
  return img;
}
