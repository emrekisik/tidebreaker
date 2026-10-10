/**
 * Bookkeeping for the shots the server announces. Server projectile ids are reused as soon as a
 * shot ends, and your own shots are shown at once while the others' are shown 150 ms late, so a
 * late END of an old shot can arrive after the same id was handed to a new one. Two tables (one
 * per set) keep them apart, and the last SPAWN received for an id says whose shot a later END
 * means (the server always ends a shot before it reuses the id).
 */
export class ShotTable {
  private readonly lastMine: Uint8Array;
  private readonly weapons: Uint8Array;
  private readonly powers: Uint8Array;
  private readonly slotMine: Int16Array;
  private readonly slotOthers: Int16Array;
  /** Which id currently lives in each slot of a set (a slot can be freed and reused locally). */
  private readonly holderMine: Int16Array;
  private readonly holderOthers: Int16Array;

  constructor(capacity: number) {
    this.lastMine = new Uint8Array(capacity);
    this.weapons = new Uint8Array(capacity);
    this.powers = new Uint8Array(capacity);
    this.slotMine = new Int16Array(capacity).fill(-1);
    this.slotOthers = new Int16Array(capacity).fill(-1);
    this.holderMine = new Int16Array(capacity).fill(-1);
    this.holderOthers = new Int16Array(capacity).fill(-1);
  }

  /** A SPAWN message arrived (in message order, before any delay). */
  noteSpawn(id: number, mine: boolean, weapon: number, power = 0): void {
    this.lastMine[id] = mine ? 1 : 0;
    this.weapons[id] = weapon;
    this.powers[id] = power;
  }

  /** The shot now lives in `slot` of its set. */
  bind(id: number, mine: boolean, slot: number): void {
    (mine ? this.slotMine : this.slotOthers)[id] = slot;
    (mine ? this.holderMine : this.holderOthers)[slot] = id;
  }

  /** Whose shot the id meant when the latest SPAWN for it arrived. */
  isMine(id: number): boolean {
    return this.lastMine[id] === 1;
  }

  weaponOf(id: number): number {
    return this.weapons[id]!;
  }

  /** Damage upgrade level of the shooter when the shot was fired. */
  powerOf(id: number): number {
    return this.powers[id]!;
  }

  /**
   * The slot to remove when the shot ends, or -1 when it is already gone (it reached its range or
   * a coast here first, and the slot may hold another shot by now). Forgets the binding.
   */
  take(id: number, mine: boolean): number {
    const slots = mine ? this.slotMine : this.slotOthers;
    const holders = mine ? this.holderMine : this.holderOthers;
    const slot = slots[id]!;
    slots[id] = -1;
    return slot >= 0 && holders[slot] === id ? slot : -1;
  }
}
