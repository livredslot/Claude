/** Short player-facing descriptions of each unit (text only; numbers come from the config). */
import { UNITS, type UnitType } from '../config/gameConfig';
import type { Stance } from '../sim/types';

export const UNIT_BLURB: Record<UnitType, string> = {
  swordsman: 'Sturdy all-rounder. Shield: takes 25% less arrow damage. Beats Spearmen.',
  spearman: 'Long reach, triple damage vs Horsemen. Weak vs Swordsmen and Archers.',
  horseman: 'Fastest unit. Hunts Archers, Medics and Mages. Weak vs Spearmen.',
  archer: 'Shoots from long range. Fragile when enemies reach it.',
  medic: 'Heals the most injured nearby ally. Only fights back if attacked.',
  mage: 'Area blast every few seconds. Punishes tightly packed enemies.',
  king: 'Strong in melee but slow. Follows behind the army. If your King dies, you LOSE!',
};

export function statLine(type: UnitType): string {
  const s = UNITS[type];
  return `HP ${s.hp} · Damage ${s.damage} · Range ${s.range} · Speed ${s.speed}`;
}

export const STANCE_INFO: Record<Stance, { name: string; badge: string; text: string }> = {
  advance: { name: 'Advance', badge: '', text: 'Moves toward the enemy right away.' },
  hold: { name: 'Hold', badge: 'H', text: 'Stays put until an enemy comes close (ranged units still shoot).' },
  flank: { name: 'Flank', badge: 'F', text: 'Goes along the nearest map edge first, then attacks.' },
};
