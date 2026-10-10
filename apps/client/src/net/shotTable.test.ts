import { describe, expect, it } from 'vitest';
import { ShotTable } from './shotTable.ts';

describe('ShotTable', () => {
  it('a late END of an old shot does not take a new shot that reuses the id', () => {
    const t = new ShotTable(16);
    // Another player's shot, id 7, in slot 3 of the delayed set.
    t.noteSpawn(7, false, 1);
    t.bind(7, false, 3);
    // The server ends it and hands id 7 to a shot of yours; both messages arrive together.
    expect(t.isMine(7)).toBe(false); // END(7) is read now: it means the other player's shot
    const endIsMine = t.isMine(7);
    t.noteSpawn(7, true, 2);
    t.bind(7, true, 0);
    // The delayed END runs after your new shot exists: it must only touch the old one.
    expect(t.take(7, endIsMine)).toBe(3);
    // Your shot is untouched until its own END.
    expect(t.isMine(7)).toBe(true);
    expect(t.take(7, true)).toBe(0);
  });

  it('forgets a shot that already left by itself, even if its slot was reused', () => {
    const t = new ShotTable(16);
    t.noteSpawn(4, false, 0);
    t.bind(4, false, 2);
    // The slot is freed locally and given to another shot (id 9).
    t.noteSpawn(9, false, 0);
    t.bind(9, false, 2);
    expect(t.take(4, false)).toBe(-1);
    expect(t.take(9, false)).toBe(2);
    expect(t.take(9, false)).toBe(-1);
  });

  it('remembers the weapon of each id', () => {
    const t = new ShotTable(16);
    t.noteSpawn(1, false, 5);
    t.noteSpawn(2, true, 3);
    expect(t.weaponOf(1)).toBe(5);
    expect(t.weaponOf(2)).toBe(3);
  });
});
