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
  /**
   * Between two emotes of one player (seconds). What comes sooner waits: only the LAST one pressed in
   * that time is shown when it is over, so the player always ends up showing the latest emote.
   */
  cooldownSec: 0.8,
  /** How long a bubble stays over the ship (seconds). */
  showSec: 3.5,
} as const;
