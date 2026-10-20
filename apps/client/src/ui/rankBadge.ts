import { RANKS } from '@tidebreaker/shared';

/**
 * Rank insignia in the colors and style of DarkOrbit's ranks, drawn in code as smooth vector pictures (no image files):
 * flat two- and three-tone metal (a lit band, a shaded band), a dark brown outline, stitched edges on the gold shields
 * and brushed streaks on the bronze ones. Each picture is square (48 x 48 units) and is shown about 21 px tall.
 *   rank 0-2    1 to 3 narrow silver chevrons
 *   rank 3-7    1 to 5 wide silver chevrons
 *   rank 8-11   a gold shield with a silver tab: plain, with a band, with three columns, with three columns and a point
 *   rank 12-15  a bronze shield with 1, 2 or 3 stars, then one big star
 *   rank 16     its own design: the bronze shield with a gold rim, a laurel and a big star (it also glows in the UI: `rank-top`)
 */

const OUTLINE = '#17110c';
/** DarkOrbit's metals: silver, gold, bronze and star gold (light to dark). */
const C = {
  w: '#ffffff',
  l: '#dfe4ea',
  m: '#aeb7c2',
  d: '#767f8d',
  Y: '#fbf1a8',
  y: '#e1cc58',
  o: '#a98f28',
  O: '#6a5612',
  B: '#f2c19c',
  b: '#d08a5e',
  n: '#97583a',
  N: '#5f3322',
  S: '#fff0b0',
  s: '#f5cb4c',
  z: '#c78e1e',
} as const;

function f(v: number): string {
  return String(Math.round(v * 100) / 100);
}

const GOLD_SHIELD = 'M7 9H41V30Q41 39 24 44.5Q7 39 7 30Z';
const BRONZE_SHIELD = 'M6.5 6.5H41.5V33Q41.5 40.5 24 45Q6.5 40.5 6.5 33Z';

function defs(): string {
  return (
    `<defs>` +
    // star gold in three hard bands, bronze in soft bands
    `<linearGradient id="st" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.S}"/><stop offset=".45" stop-color="${C.S}"/><stop offset=".45" stop-color="${C.s}"/><stop offset=".78" stop-color="${C.s}"/><stop offset=".78" stop-color="${C.z}"/><stop offset="1" stop-color="${C.z}"/></linearGradient>` +
    `<linearGradient id="br" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.B}"/><stop offset=".22" stop-color="${C.b}"/><stop offset=".62" stop-color="${C.b}"/><stop offset="1" stop-color="${C.n}"/></linearGradient>` +
    `<clipPath id="gs"><path d="${GOLD_SHIELD}"/></clipPath>` +
    `<clipPath id="bs"><path d="${BRONZE_SHIELD}"/></clipPath>` +
    `</defs>`
  );
}

// ---------- chevrons

/** One silver chevron ("V" pointing down): its upper corners at height `y`, `half` to each side, `depth` deep, `t` thick. */
function chevron(y: number, half: number, depth: number, t: number): string {
  const x0 = 24 - half;
  const x1 = 24 + half;
  const all = `${f(x0)},${f(y)} 24,${f(y + depth)} ${f(x1)},${f(y)} ${f(x1)},${f(y + t)} 24,${f(y + depth + t)} ${f(x0)},${f(y + t)}`;
  const h = t / 2;
  return (
    `<polygon class="ch" points="${all}" fill="${C.m}" stroke="${OUTLINE}" stroke-width="2.2" stroke-linejoin="round"/>` +
    // the lit upper half and the shaded lower half
    `<polygon points="${f(x0)},${f(y)} 24,${f(y + depth)} ${f(x1)},${f(y)} ${f(x1)},${f(y + h)} 24,${f(y + depth + h)} ${f(x0)},${f(y + h)}" fill="${C.l}"/>` +
    `<polygon points="${f(x0)},${f(y + h)} 24,${f(y + depth + h)} ${f(x1)},${f(y + h)} ${f(x1)},${f(y + t)} 24,${f(y + depth + t)} ${f(x0)},${f(y + t)}" fill="${C.m}"/>` +
    `<polyline points="${f(x0 + 0.6)},${f(y + 0.7)} 24,${f(y + depth + 0.7)} ${f(x1 - 0.6)},${f(y + 0.7)}" fill="none" stroke="${C.w}" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<polyline points="${f(x0 + 0.6)},${f(y + t - 0.7)} 24,${f(y + depth + t - 0.7)} ${f(x1 - 0.6)},${f(y + t - 0.7)}" fill="none" stroke="${C.d}" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>`
  );
}

function chevrons(n: number, wide: boolean): string {
  const half = wide ? 18.3 : 9.2;
  const depth = 9.1;
  const t = 4.6;
  const step = 6.9;
  const total = (n - 1) * step + depth + t;
  const top = (48 - total) / 2;
  const out: string[] = [];
  // The lowest chevron first, so each one overlaps the one below.
  for (let i = n - 1; i >= 0; i--) out.push(chevron(top + i * step, half, depth, t));
  return out.join('');
}

// ---------- gold shields

/** The silver tab on top of the gold shields. */
function tab(): string {
  return (
    `<polygon points="11,3.5 37,3.5 37,8 33,12.5 15,12.5 11,8" fill="${C.m}" stroke="${OUTLINE}" stroke-width="2.2" stroke-linejoin="round"/>` +
    `<polygon points="11,3.5 37,3.5 37,8 11,8" fill="${C.l}"/>` +
    `<polygon points="11,8 37,8 33,12.5 15,12.5" fill="${C.m}"/>` +
    `<line x1="12.5" y1="4.7" x2="35.5" y2="4.7" stroke="${C.w}" stroke-width="1.1" stroke-linecap="round"/>`
  );
}

function goldShield(kind: 0 | 1 | 2 | 3): string {
  const out: string[] = [
    `<path d="${GOLD_SHIELD}" fill="${C.y}" stroke="${OUTLINE}" stroke-width="2.4" stroke-linejoin="round"/>`,
    // lit upper left, shaded lower right
    `<g clip-path="url(#gs)"><polygon points="7,9 30,9 7,34" fill="${C.Y}"/><polygon points="41,22 41,50 14,50" fill="${C.o}"/></g>`,
    // the stitched edge
    `<path d="M10.2 12.2H37.8V30Q37.8 36.5 24 41.2Q10.2 36.5 10.2 30Z" fill="none" stroke="${C.w}" stroke-opacity=".9" stroke-width="1.1" stroke-dasharray="2.2 1.8"/>`,
  ];
  if (kind === 1) {
    out.push(
      `<rect class="band" x="9" y="22" width="30" height="7" fill="${C.Y}" stroke="${C.O}" stroke-width="1.1"/>`,
      `<rect x="9" y="26" width="30" height="3" fill="${C.y}"/>`,
    );
  } else if (kind >= 2) {
    for (let i = 0; i < 3; i++) {
      const x = 12.5 + i * 8.7;
      out.push(
        `<rect class="col" x="${f(x)}" y="19" width="7" height="19" rx="1" fill="${C.y}" stroke="${C.O}" stroke-width="1.1"/>`,
        `<rect x="${f(x + 0.6)}" y="19.6" width="2.6" height="17.8" fill="${C.Y}"/>`,
        `<rect x="${f(x + 5)}" y="19.6" width="1.5" height="17.8" fill="${C.o}"/>`,
      );
    }
  }
  if (kind === 3) {
    out.push(
      `<polygon class="tri" points="15,14 33,14 24,25" fill="${C.l}" stroke="${OUTLINE}" stroke-width="1.6" stroke-linejoin="round"/>`,
      `<polygon points="24,25 33,14 29,14" fill="${C.m}"/>`,
    );
  }
  out.push(tab());
  return out.join('');
}

// ---------- bronze shields

/** A five-pointed star around (cx, cy), gold in three bands with a dark outline. */
function star(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 === 0 ? r : r * 0.45;
    pts.push(`${f(cx + Math.cos(a) * rad)},${f(cy + Math.sin(a) * rad)}`);
  }
  return `<polygon class="st" points="${pts.join(' ')}" fill="url(#st)" stroke="${OUTLINE}" stroke-width="1.6" stroke-linejoin="round"/>`;
}

function bronzeBase(rim: 'bronze' | 'gold'): string {
  const out: string[] = [`<path d="${BRONZE_SHIELD}" fill="url(#br)" stroke="${OUTLINE}" stroke-width="2.4" stroke-linejoin="round"/>`];
  // brushed streaks
  out.push('<g clip-path="url(#bs)" stroke="#fff" stroke-opacity=".2" stroke-width=".9" stroke-dasharray="7 4 3 5">');
  for (let y = 12; y < 44; y += 5) out.push(`<line x1="${6 + (y % 3) * 2}" y1="${y}" x2="43" y2="${y + 0.5}"/>`);
  out.push('</g>');
  if (rim === 'gold') {
    out.push(
      `<path d="${BRONZE_SHIELD}" fill="none" stroke="${C.y}" stroke-width="3.2" stroke-linejoin="round"/>`,
      `<path d="M8.6 8.6H39.4V33Q39.4 38.6 24 42.8Q8.6 38.6 8.6 33Z" fill="none" stroke="${C.Y}" stroke-width="1" stroke-dasharray="2.2 1.8"/>`,
      `<path d="${BRONZE_SHIELD}" fill="none" stroke="${OUTLINE}" stroke-width="1" stroke-linejoin="round"/>`,
    );
  } else {
    out.push(`<path d="M9 9H39V33Q39 38 24 42Q9 38 9 33Z" fill="none" stroke="${C.B}" stroke-opacity=".7" stroke-width="1.2"/>`);
  }
  return out.join('');
}

function bronzeShield(stars: 1 | 2 | 3 | 4): string {
  const out: string[] = [bronzeBase('bronze')];
  if (stars === 1) out.push(star(24, 23.5, 12));
  else if (stars === 2) out.push(star(15.5, 23, 8.2), star(32.5, 23, 8.2));
  else if (stars === 3) out.push(star(24, 15.5, 7.6), star(15, 31, 7.6), star(33, 31, 7.6));
  else out.push(star(24, 23, 15.5));
  return out.join('');
}

/** One side of the laurel wreath (the other is its mirror). */
function laurel(): string {
  const leaves: string[] = [];
  for (let i = 0; i < 5; i++) {
    const a = ((120 + i * 21) * Math.PI) / 180;
    const x = 24 + Math.cos(a) * 18.5;
    const y = 25 + Math.sin(a) * 17;
    const rot = (a * 180) / Math.PI + 90 + 30;
    leaves.push(`<ellipse cx="0" cy="-3" rx="1.9" ry="3.4" transform="translate(${f(x)} ${f(y)}) rotate(${f(rot)})" fill="${C.S}" stroke="${OUTLINE}" stroke-width=".9"/>`);
  }
  return leaves.join('');
}

function topRank(): string {
  return bronzeBase('gold') + `<g class="laurel">${laurel()}<g transform="matrix(-1 0 0 1 48 0)">${laurel()}</g></g>` + star(24, 22.5, 13.4);
}

/** The SVG text of the insignia of `rank` (0 = lowest). */
export function rankSvg(rank: number): string {
  const r = Math.max(0, Math.min(RANKS.count - 1, Math.floor(rank)));
  const body =
    r < 3
      ? chevrons(r + 1, false)
      : r < 8
        ? chevrons(r - 2, true)
        : r < 12
          ? goldShield((r - 8) as 0 | 1 | 2 | 3)
          : r < 16
            ? bronzeShield((r - 11) as 1 | 2 | 3 | 4)
            : topRank();
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">${defs()}${body}</svg>`;
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
