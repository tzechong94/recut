// PLAN's coverage pass. TapNow's segmentation is conservative — long beats become one node.
// Ours decides, per story beat, the shot count and sizes following standard editorial grammar
// (establishing, master, coverage, insert, reaction). Deterministic and testable.

import type { CompiledPrompt } from '../gateway/types';

export type ShotRole = 'establishing' | 'master' | 'coverage' | 'insert' | 'reaction';

export interface PlannedShot {
  role: ShotRole;
  shotSize: CompiledPrompt['camera']['shotSize'];
  action: string;
  /** which characters are featured, subset of the beat's characters */
  featured: string[];
}

export interface Beat {
  action: string;
  characters: string[];
  kind: 'dialogue' | 'action' | 'establishing' | 'emotional';
}

/**
 * Coverage grammar:
 *  - establishing → a single wide that sets the geography
 *  - dialogue (2+ chars) → establishing WS + a master + coverage per speaker + a reaction CU
 *  - action → wide master + tighter coverage + an insert
 *  - emotional (single char) → master MS + a CU push
 */
export function planCoverage(beat: Beat): PlannedShot[] {
  const chars = beat.characters;
  if (beat.kind === 'establishing') {
    return [{ role: 'establishing', shotSize: 'WS', action: beat.action, featured: chars }];
  }
  if (beat.kind === 'dialogue' && chars.length >= 2) {
    return [
      { role: 'establishing', shotSize: 'WS', action: `${beat.action} — establish the two`, featured: chars },
      { role: 'master', shotSize: 'MS', action: beat.action, featured: chars },
      ...chars.map((c): PlannedShot => ({ role: 'coverage', shotSize: 'MCU', action: `${c}'s coverage`, featured: [c] })),
      { role: 'reaction', shotSize: 'CU', action: `reaction`, featured: [chars[chars.length - 1]!] },
    ];
  }
  if (beat.kind === 'action') {
    return [
      { role: 'master', shotSize: 'WS', action: beat.action, featured: chars },
      { role: 'coverage', shotSize: 'MS', action: `${beat.action} — closer`, featured: chars },
      { role: 'insert', shotSize: 'ECU', action: `insert detail`, featured: chars.slice(0, 1) },
    ];
  }
  // emotional / single-character default
  return [
    { role: 'master', shotSize: 'MS', action: beat.action, featured: chars.slice(0, 1) },
    { role: 'coverage', shotSize: 'CU', action: `${beat.action} — push in`, featured: chars.slice(0, 1) },
  ];
}
