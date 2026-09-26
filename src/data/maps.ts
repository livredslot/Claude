/**
 * Map definitions. Each map is a grid of tile characters:
 *   '.' flat   '^' mountain   '~' deep water   '-' shallow water
 * (what each terrain does is set in TERRAIN in src/config/gameConfig.ts).
 *
 * Maps must be mirror-symmetrical so both sides are equally good. To guarantee that,
 * each map below is written as its LEFT half only (20 columns: column 0 = Blue's back
 * edge, column 19 = next to the centre line); the right half is the mirror image.
 * The first 6 columns (the deployment zone) must stay flat.
 */
import { MAP_RULES } from '../config/gameConfig';
import type { MapDef } from '../sim/types';

/** Build the full rows from the left halves: each row + its mirror image. */
function mirrored(leftHalf: string[]): string[] {
  return leftHalf.map((row) => row + [...row].reverse().join(''));
}

function makeMap(id: string, name: string, description: string, leftHalf: string[]): MapDef {
  return { id, name, description, width: MAP_RULES.width, height: MAP_RULES.height, rows: mirrored(leftHalf) };
}

export const OPEN_PLAINS = makeMap(
  'open-plains',
  'Open Plains',
  'Flat ground everywhere. Pure army against army.',
  Array.from({ length: MAP_RULES.height }, () => '.'.repeat(MAP_RULES.width / 2)),
);

export const RIVER_CROSSING = makeMap(
  'river-crossing',
  'River Crossing',
  'A deep river splits the field. Two shallow fords are the only way across.',
  [
    '..................~~',
    '..................~~',
    '.................-~~',
    '.................---',
    '.................---',
    '.................---',
    '.................-~~',
    '..................~~',
    '..................~~',
    '..................~~',
    '..................~~',
    '..................~~',
    '..................~~',
    '.................-~~',
    '.................---',
    '.................---',
    '.................---',
    '.................-~~',
    '..................~~',
    '..................~~',
  ],
);

export const TWIN_PEAKS = makeMap(
  'twin-peaks',
  'Twin Peaks',
  'Two mountains in the middle. Whoever holds the high ground hits harder.',
  [
    '....................',
    '....................',
    '....................',
    '..................^^',
    '................^^^^',
    '................^^^^',
    '..................^^',
    '....................',
    '....................',
    '....................',
    '....................',
    '....................',
    '....................',
    '..................^^',
    '................^^^^',
    '................^^^^',
    '..................^^',
    '....................',
    '....................',
    '....................',
  ],
);

export const MOUNTAIN_PASS = makeMap(
  'mountain-pass',
  'Mountain Pass',
  'A mountain ridge with one narrow pass. Climbing over is very slow.',
  [
    '...............^^^^^',
    '................^^^^',
    '...............^^^^^',
    '................^^^^',
    '................^^^^',
    '...............^^^^^',
    '................^^^^',
    '.................^^^',
    '....................',
    '....................',
    '....................',
    '....................',
    '.................^^^',
    '................^^^^',
    '...............^^^^^',
    '................^^^^',
    '................^^^^',
    '...............^^^^^',
    '................^^^^',
    '...............^^^^^',
  ],
);

export const LAKE_VALLEY = makeMap(
  'lake-valley',
  'Lake Valley',
  'A lake fills the middle. Go around the top or the bottom, past small hills.',
  [
    '....................',
    '..................^^',
    '...................^',
    '....................',
    '....................',
    '................----',
    '...............---~~',
    '...............-~~~~',
    '..............--~~~~',
    '..............-~~~~~',
    '..............-~~~~~',
    '..............--~~~~',
    '...............-~~~~',
    '...............---~~',
    '................----',
    '....................',
    '....................',
    '...................^',
    '..................^^',
    '....................',
  ],
);

export const MAPS: MapDef[] = [OPEN_PLAINS, RIVER_CROSSING, TWIN_PEAKS, MOUNTAIN_PASS, LAKE_VALLEY];

export function getMap(id: string): MapDef {
  const map = MAPS.find((m) => m.id === id);
  if (!map) throw new Error(`Unknown map: ${id}`);
  return map;
}
