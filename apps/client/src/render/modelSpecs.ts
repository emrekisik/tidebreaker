/**
 * Data describing how each GLB model maps onto the game (GAME_DESIGN.md §12.5). The loader uses
 * this to normalize any model: orient the bow to +x, scale to `length`, put the waterline at y=0,
 * and find the turret nodes that should follow the aim.
 *
 * Node names are the ones exported from Blender; dots are optional (three.js strips them).
 */
export interface ModelSpec {
  /** File in `public/models/` (produced by `pnpm assets:build`). */
  file: string;
  /** Name of the node that holds the hull mesh. Its own mesh defines length/waterline. */
  hullNode: string;
  /** Which way the bow points in the exported file's world frame. */
  bow: '+z' | '-z';
  /** Hull length in world units after normalization. */
  length: number;
  /** Fraction of hull height (from the keel) that is below the waterline. */
  draft: number;
  /** Nodes that rotate toward the aim direction. Everything else stays fixed to the hull. */
  aimNodes: readonly string[];
}

export const MODEL_SPECS: Readonly<Record<string, ModelSpec>> = {
  // T1: used for the player ship (ships.ts modelKey).
  assault_boat: {
    file: 'assault_boat.glb',
    hullNode: 'assault_boat',
    bow: '+z',
    length: 5,
    draft: 0.3,
    aimNodes: ['assault_boat.MachineGun'],
  },
  // The entries below are visual previews only (`?ship=<key>`); lengths are placeholders until
  // each model is assigned to a tier in the class table.
  hovercraft: {
    file: 'hovercraft.glb',
    hullNode: 'hovercraft',
    bow: '+z',
    length: 7,
    draft: 0.2,
    aimNodes: ['hovercraft.MachineGun1', 'hovercraft.MachineGun2'],
  },
  landing_craft: {
    file: 'landing_craft.glb',
    hullNode: 'landing_craft',
    bow: '+z',
    length: 7,
    draft: 0.25,
    aimNodes: ['landing_craft.MachineGun1', 'landing_craft.MachineGun2'],
  },
  frigate1: {
    file: 'frigate1.glb',
    hullNode: 'frigate1',
    bow: '+z',
    length: 9,
    draft: 0.3,
    aimNodes: ['frigate1.BackTurret', 'frigate1.FrontTurrent'],
  },
  frigate2: {
    file: 'frigate2.glb',
    hullNode: 'frigate2',
    bow: '+z',
    length: 9,
    draft: 0.3,
    aimNodes: [
      'frigate2.BackTurret1',
      'frigate2.BackTurret2',
      'frigate2.FrontTurret',
      'frigate2.TopMachineGun',
    ],
  },
  cruiser: {
    file: 'cruiser.glb',
    hullNode: 'cruiser',
    bow: '+z',
    length: 12,
    draft: 0.3,
    aimNodes: ['cruiser.FrontTurret.1', 'cruiser.FrontTurret.2', 'cruiser.TopMachineGun'],
  },
  battleship: {
    file: 'battleship.glb',
    hullNode: 'battleship',
    bow: '-z',
    length: 15,
    draft: 0.3,
    aimNodes: ['HeavyBackTurret.001', 'HeavyFrontTurret.002', 'HeavyFrontTurret.003'],
  },
  submarine: {
    file: 'submarine.glb',
    hullNode: 'submarnie',
    bow: '+z',
    length: 9,
    draft: 0.5,
    aimNodes: [],
  },
};
