/**
 * Map definitions. Each map is a grid of tile characters:
 *   '.' flat   '^' mountain   '~' deep water   '-' shallow water
 * Maps must be mirror-symmetrical (left half = mirrored right half).
 * More maps (River Crossing, Twin Peaks, ...) arrive in Phase 3.
 */
import { MAP_RULES } from '../config/gameConfig';
import type { MapDef } from '../sim/types';

function filled(width: number, height: number, ch: string): string[] {
  return Array.from({ length: height }, () => ch.repeat(width));
}

export const OPEN_PLAINS: MapDef = {
  id: 'open-plains',
  name: 'Open Plains',
  width: MAP_RULES.width,
  height: MAP_RULES.height,
  rows: filled(MAP_RULES.width, MAP_RULES.height, '.'),
};

export const MAPS: MapDef[] = [OPEN_PLAINS];

export function getMap(id: string): MapDef {
  const map = MAPS.find((m) => m.id === id);
  if (!map) throw new Error(`Unknown map: ${id}`);
  return map;
}
