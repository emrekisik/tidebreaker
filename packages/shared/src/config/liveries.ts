/**
 * Liveries: where the team colour goes on a ship. The colour itself comes from the team's country (config/countries.ts);
 * a livery only decides how much of the hull wears it and in what pattern. They are the base for skins later (a skin is
 * a livery a player picks).
 *
 * A point of a ship is written as (u, v, w) in the box around the parts that can take paint (the grey "hull paint" of the
 * model, see render/assets.ts): u from the stern (-1) to the bow (+1), v from the lowest (0) to the highest (1) painted
 * part, w from the port edge (-1) to the starboard edge (+1). A livery is a few zones, each a box in that space: a point is
 * painted where it lies in any of them. `w` is measured as |w| (a zone covers both sides). A missing range means "all".
 * Edges are soft, `soft` wide (in the same units).
 */
export interface Zone {
  u?: readonly [number, number];
  v?: readonly [number, number];
  /** On |w|: 0 is the middle line of the ship, 1 the edge. */
  w?: readonly [number, number];
  soft?: number;
}

export interface Livery {
  id: string;
  /** A name for lists (not shown to players yet). */
  name: string;
  zones: readonly Zone[];
}

/** The most zones a livery may have (the shader has this many slots). */
export const LIVERY_ZONES = 4;
/** The softness of an edge when a zone does not say. */
export const LIVERY_SOFT = 0.03;

export const LIVERIES: readonly Livery[] = [
  {
    id: 'standard',
    name: 'Hull and bow',
    // The lower hull, below the deck line, and a cap on the bow; deck and structures stay grey.
    zones: [{ v: [-1, 0.42] }, { u: [0.5, 2] }],
  },
  {
    id: 'boot',
    name: 'Boot topping',
    zones: [{ v: [-1, 0.42] }],
  },
  {
    id: 'stripe',
    name: 'Sheer stripe',
    // A stripe along each flank and a cap on the bow.
    zones: [{ w: [0.62, 2], v: [0.18, 0.62] }, { u: [0.55, 2] }],
  },
  {
    id: 'bookends',
    name: 'Bow and stern',
    zones: [{ u: [0.5, 2] }, { u: [-2, -0.62] }],
  },
  {
    id: 'belts',
    name: 'Belts',
    zones: [{ u: [0.18, 0.4] }, { u: [-0.52, -0.3] }, { u: [0.78, 2] }],
  },
  {
    id: 'foredeck',
    name: 'Foredeck',
    // The forward half of the ship.
    zones: [{ u: [0.05, 2] }],
  },
  {
    id: 'solid',
    name: 'Solid',
    zones: [{}],
  },
];

export const DEFAULT_LIVERY = 'standard';

export function liveryById(id: string): Livery {
  return LIVERIES.find((l) => l.id === id) ?? LIVERIES.find((l) => l.id === DEFAULT_LIVERY)!;
}
