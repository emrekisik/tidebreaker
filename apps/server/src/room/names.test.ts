import { describe, expect, it } from 'vitest';
import { sanitizeName } from './names.ts';

describe('sanitizeName', () => {
  it('keeps normal names, including Turkish letters', () => {
    expect(sanitizeName('Kaptan Çınar')).toBe('Kaptan Çınar');
    expect(sanitizeName('  Deniz   Kurdu  ')).toBe('Deniz Kurdu');
    expect(sanitizeName('Player_1-x')).toBe('Player_1-x');
  });

  it('removes symbols and control characters', () => {
    expect(sanitizeName('<b>Bold</b>')).toBe('bBoldb');
    expect(sanitizeName('A\u0000B‮C')).toBe('ABC');
    expect(sanitizeName('🚢Ship🚢')).toBe('Ship');
  });

  it('cuts to 16 characters', () => {
    expect(sanitizeName('abcdefghijklmnopqrstuvwxyz')).toBe('abcdefghijklmnop');
  });

  it('rejects empty results and blocked or impersonating names', () => {
    expect(sanitizeName('')).toBeNull();
    expect(sanitizeName('🚢🚢')).toBeNull();
    expect(sanitizeName('Admin')).toBeNull();
    expect(sanitizeName('xx_ADMIN_xx')).toBeNull();
    expect(sanitizeName('Moderator')).toBeNull();
    expect(sanitizeName('mod')).toBeNull();
    // Short blocked words only match whole, so these are fine.
    expect(sanitizeName('Modern')).toBe('Modern');
    expect(sanitizeName('Sikke')).toBe('Sikke');
  });

  it('normalizes unicode to NFC', () => {
    expect(sanitizeName('é')).toBe('é');
  });
});
