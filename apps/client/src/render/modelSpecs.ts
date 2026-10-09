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
  /** Fraction of hull height (from the keel) below the waterline; negative lifts the hull out. */
  draft: number;
  /**
   * Nodes that rotate toward the aim direction, in fire-priority order. Index i is mount i of the
   * matching ShipDef (packages/shared/src/config/ships.ts). Everything else stays fixed.
   */
  aimNodes: readonly string[];
}

export const MODEL_SPECS: Readonly<Record<string, ModelSpec>> = {
  // T1: used for the player ship (ships.ts modelKey).
  assault_boat: {
    file: 'assault_boat.glb',
    hullNode: 'assault_boat',
    bow: '+z',
    length: 5.8,
    draft: -0.1,
    aimNodes: ['assault_boat.MachineGun'],
  },
  // The entries below are visual previews only (`?ship=<key>`); lengths are placeholders until
  // each model is assigned to a tier in the class table.
  hovercraft: {
    file: 'hovercraft.glb',
    hullNode: 'hovercraft',
    bow: '+z',
    length: 7,
    draft: -0.1,
    aimNodes: ['hovercraft.MachineGun1', 'hovercraft.MachineGun2'],
  },
  landing_craft: {
    file: 'landing_craft.glb',
    hullNode: 'landing_craft',
    bow: '+z',
    length: 8,
    draft: -0.1,
    aimNodes: ['landing_craft.MachineGun1', 'landing_craft.MachineGun2'],
  },
  frigate1: {
    file: 'frigate1.glb',
    hullNode: 'frigate1',
    bow: '+z',
    length: 12.5,
    draft: -0.1,
    aimNodes: [
      'frigate1.FrontTurrent',
      'frigate1.BackTurret',
      'frigate1.TopLauncher1',
      'frigate1.TopLauncher2',
    ],
  },
  frigate2: {
    file: 'frigate2.glb',
    hullNode: 'frigate2',
    bow: '+z',
    length: 12.5,
    draft: -0.1,
    aimNodes: [
      'frigate2.FrontTurret',
      'frigate2.BackTurret1',
      'frigate2.BackTurret2',
      'frigate2.TopMachineGun',
    ],
  },
  cruiser: {
    file: 'cruiser.glb',
    hullNode: 'cruiser',
    bow: '+z',
    length: 16.5,
    draft: -0.1,
    aimNodes: [
      'cruiser.FrontTurret.1',
      'cruiser.FrontTurret.2',
      'cruiser.TopMachineGun',
      'cruiser.TopLauncher.01',
      'cruiser.TopLauncher.002',
    ],
  },
  battleship: {
    file: 'battleship.glb',
    hullNode: 'battleship',
    bow: '-z',
    length: 20.5,
    draft: -0.1,
    aimNodes: [
      'HeavyFrontTurret.002',
      'HeavyFrontTurret.003',
      'HeavyBackTurret.001',
      'TopLauncher.01',
      'TopLauncher.02',
    ],
  },
  // The team base: stationary, defended by its own turrets (GAME_DESIGN.md §4.5).
  aircraft_carrier: {
    file: 'aircraft_carrier.glb',
    hullNode: 'aircraft_carrier',
    bow: '+z',
    length: 60,
    draft: -0.1,
    aimNodes: ['aircraft_carrier.MachineGun1', 'aircraft_carrier.MachineGun2'],
  },
  submarine: {
    file: 'submarine.glb',
    hullNode: 'submarnie',
    bow: '+z',
    length: 10,
    draft: 0.45,
    aimNodes: [],
  },
};
