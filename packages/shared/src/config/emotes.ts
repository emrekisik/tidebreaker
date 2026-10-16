/**
 * Emotes (GAME_DESIGN.md §12.6): small speech bubbles a player shows over their ship. The index in
 * this list is the id on the wire; the pictures and the keys are the client's.
 */
export const EMOTE_IDS = [
  'a',
  'b',
  'c',
  'angry',
  'attack',
  'base',
  'defend',
  'gg',
  'happy',
  'help',
  'hmm',
  'laugh',
  'love',
  'me',
  'sad',
  'thanks',
  'wait',
  'you',
] as const;

export type EmoteId = (typeof EMOTE_IDS)[number];

export const EMOTE = {
  /** A player can send one emote this often (seconds): the server drops the rest. */
  cooldownSec: 1.2,
  /** How long a bubble stays over the ship (seconds). */
  showSec: 3.5,
} as const;
