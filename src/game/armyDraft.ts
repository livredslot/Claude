/**
 * The army a player is building on the setup screen (not part of the simulation).
 *
 * Soldiers are picked and placed in GROUPS of 5 identical units, standing in a
 * vertical line (5 rows in one column). The King is a single unit on its own.
 * Always stored in Blue/left-side coordinates: columns 0..5, column 5 = front.
 */
import { ARMY_RULES, SETUP_RULES, UNIT_TYPES, UNITS, type UnitType } from '../config/gameConfig';
import type { ArmySetup, Stance } from '../sim/types';

/** Number of GROUPS per type (King: always 1, and a "group" of one). */
export type Counts = Record<UnitType, number>;

/** A placed group: `size` units in one column, rows ty .. ty+size-1. */
export interface PlacedGroup {
  type: UnitType;
  stance: Stance;
  tx: number;
  /** Top row of the group. */
  ty: number;
}

export interface ArmyDraft {
  counts: Counts;
  groups: PlacedGroup[];
}

export const ZONE_COLS = ARMY_RULES.deployColumns;
export const GROUP_SIZE = ARMY_RULES.groupSize;

/** Units in one pick of this type (the King is on its own). */
export function groupSize(type: UnitType): number {
  return type === 'king' ? 1 : GROUP_SIZE;
}

export function newDraft(): ArmyDraft {
  return { counts: { ...SETUP_RULES.defaultCounts }, groups: [] };
}

/** Total soldier groups chosen (the King is not counted). */
export function totalGroups(counts: Counts): number {
  return UNIT_TYPES.reduce((sum, t) => sum + (t === 'king' ? 0 : counts[t]), 0);
}

/** Lowest and highest allowed number of groups for a type. */
export function countLimits(type: UnitType): [number, number] {
  if (type === 'king') return [1, 1];
  return [0, ARMY_RULES.maxGroups[type]];
}

export function canIncrease(counts: Counts, type: UnitType): boolean {
  return type !== 'king' && counts[type] < countLimits(type)[1] && totalGroups(counts) < ARMY_RULES.groups;
}

export function canDecrease(counts: Counts, type: UnitType): boolean {
  return counts[type] > countLimits(type)[0];
}

export function countsComplete(counts: Counts): boolean {
  return totalGroups(counts) === ARMY_RULES.groups && counts.king === 1;
}

export function placedOfType(draft: ArmyDraft, type: UnitType): number {
  return draft.groups.filter((g) => g.type === type).length;
}

export function remainingToPlace(draft: ArmyDraft, type: UnitType): number {
  return draft.counts[type] - placedOfType(draft, type);
}

export function allPlaced(draft: ArmyDraft): boolean {
  return countsComplete(draft.counts) && UNIT_TYPES.every((t) => remainingToPlace(draft, t) === 0);
}

/** The tiles a group covers. */
export function groupTiles(g: { type: UnitType; tx: number; ty: number }): [number, number][] {
  return Array.from({ length: groupSize(g.type) }, (_, i) => [g.tx, g.ty + i] as [number, number]);
}

/** The group covering a tile, or -1. */
export function groupAt(draft: ArmyDraft, tx: number, ty: number): number {
  return draft.groups.findIndex((g) => g.tx === tx && ty >= g.ty && ty < g.ty + groupSize(g.type));
}

/**
 * Top row for a group of this type centred on row `centreRow`, pushed inside the
 * map if it would stick out at the top or bottom.
 */
export function topRowFor(type: UnitType, centreRow: number, height: number): number {
  const size = groupSize(type);
  return Math.min(Math.max(centreRow - Math.floor(size / 2), 0), height - size);
}

/** Can a group of `type` stand at (tx, ty..)? `ignore` = index of a group to ignore (the one being moved). */
export function fits(draft: ArmyDraft, type: UnitType, tx: number, ty: number, height: number, ignore = -1): boolean {
  if (tx < 0 || tx >= ZONE_COLS || ty < 0 || ty + groupSize(type) > height) return false;
  return groupTiles({ type, tx, ty }).every(([x, y]) => {
    const at = groupAt(draft, x, y);
    return at < 0 || at === ignore;
  });
}

/** Remove placed groups beyond the chosen counts (after counts were lowered), back of the formation first. */
export function trimToCounts(draft: ArmyDraft): void {
  for (const type of UNIT_TYPES) {
    let excess = placedOfType(draft, type) - draft.counts[type];
    if (excess <= 0) continue;
    const byBackFirst = draft.groups.filter((g) => g.type === type).sort((a, b) => a.tx - b.tx);
    for (const g of byBackFirst) {
      if (excess-- <= 0) break;
      draft.groups.splice(draft.groups.indexOf(g), 1);
    }
  }
}

// ---------------------------------------------------------------------------
// Auto-place: a sensible default formation that the player can then adjust.
// ---------------------------------------------------------------------------

/** Rows ordered from the centre outward: 10, 9, 11, 8, 12, ... */
function centreOut(height: number): number[] {
  const mid = Math.floor(height / 2);
  const rows: number[] = [];
  for (let d = 0; rows.length < height; d++) {
    if (mid - d >= 0 && d > 0) rows.push(mid - d);
    if (mid + d < height) rows.push(mid + d);
  }
  return rows;
}

/** Rows ordered from the edges inward: 0, 19, 1, 18, ... */
function edgesIn(height: number): number[] {
  const edgeDist = (r: number) => Math.min(r, height - 1 - r);
  return Array.from({ length: height }, (_, r) => r).sort((a, b) => edgeDist(a) - edgeDist(b) || a - b);
}

interface Slot {
  type: UnitType;
  /** Preferred columns, in order. */
  cols: number[];
  rows: 'centre' | 'edges';
}

/**
 * Place every not-yet-placed group into free space:
 *  front (col 5): Spearmen in the middle, Swordsmen beside them
 *  col 4: Horsemen on the wings
 *  col 3: Archers   col 2: Medics   col 1: Mages   col 0: King (centre)
 * Groups spill into neighbouring columns when a column is full.
 * Returns false if some group could not be placed (no room).
 */
export function autoPlace(draft: ArmyDraft, height: number, stance: Stance = 'advance'): boolean {
  const order: Slot[] = [
    { type: 'king', cols: [0, 1, 2, 3, 4, 5], rows: 'centre' },
    { type: 'spearman', cols: [5, 4, 3, 2, 1, 0], rows: 'centre' },
    { type: 'swordsman', cols: [5, 4, 3, 2, 1, 0], rows: 'centre' },
    { type: 'horseman', cols: [4, 5, 3, 2, 1, 0], rows: 'edges' },
    { type: 'archer', cols: [3, 2, 4, 1, 5, 0], rows: 'centre' },
    { type: 'medic', cols: [2, 1, 3, 0, 4, 5], rows: 'centre' },
    { type: 'mage', cols: [1, 2, 0, 3, 4, 5], rows: 'centre' },
  ];
  let ok = true;
  for (const slot of order) {
    const rows = slot.rows === 'centre' ? centreOut(height) : edgesIn(height);
    for (let left = remainingToPlace(draft, slot.type); left > 0; left--) {
      let placed = false;
      for (const col of slot.cols) {
        for (const row of rows) {
          const ty = topRowFor(slot.type, row, height);
          if (fits(draft, slot.type, col, ty, height)) {
            draft.groups.push({ type: slot.type, stance, tx: col, ty });
            placed = true;
            break;
          }
        }
        if (placed) break;
      }
      if (!placed) ok = false;
    }
  }
  return ok;
}

/**
 * Used when the setup timer runs out: top up to the full number of groups with
 * the default filler type, then auto-place anything not yet on the map.
 */
export function autoComplete(draft: ArmyDraft, height: number): void {
  for (const type of UNIT_TYPES) {
    const [min, max] = countLimits(type);
    draft.counts[type] = Math.min(Math.max(draft.counts[type], min), max);
  }
  const fillers: UnitType[] = [SETUP_RULES.autoFillType, ...UNIT_TYPES];
  for (const type of fillers) {
    while (totalGroups(draft.counts) < ARMY_RULES.groups && canIncrease(draft.counts, type)) draft.counts[type]++;
  }
  trimToCounts(draft);
  autoPlace(draft, height);
}

/** Convert the draft to a simulation setup (individual units) for the given side of the map. */
export function draftToSetup(draft: ArmyDraft, side: 0 | 1, mapWidth: number): ArmySetup {
  return {
    units: draft.groups.flatMap((g) =>
      groupTiles(g).map(([tx, ty]) => ({
        type: g.type,
        tx: side === 0 ? tx : mapWidth - 1 - tx,
        ty,
        stance: g.stance,
      })),
    ),
  };
}

// ---------------------------------------------------------------------------
// Presets saved in the browser.
// ---------------------------------------------------------------------------

/** v2 = groups of 5 (v1 saves stored single units and are ignored). */
const PRESET_KEY = 'mystical-armies.preset.v2';

interface SavedDraft {
  counts: Counts;
  groups: PlacedGroup[];
}

export function savePreset(draft: ArmyDraft): boolean {
  try {
    const data: SavedDraft = { counts: draft.counts, groups: draft.groups };
    localStorage.setItem(PRESET_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

/** Returns null if nothing is saved (or the save is unreadable). */
export function loadPreset(height: number): ArmyDraft | null {
  try {
    const raw = localStorage.getItem(PRESET_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as SavedDraft;
    const counts = { ...SETUP_RULES.defaultCounts };
    for (const t of UNIT_TYPES) if (typeof data.counts?.[t] === 'number') counts[t] = data.counts[t];
    const draft: ArmyDraft = { counts, groups: [] };
    for (const g of data.groups ?? []) {
      if (!UNITS[g.type]) continue;
      const stance: Stance = g.stance === 'flank' ? 'flank' : 'advance';
      if (fits(draft, g.type, g.tx, g.ty, height)) draft.groups.push({ type: g.type, stance, tx: g.tx, ty: g.ty });
    }
    trimToCounts(draft);
    return draft;
  } catch {
    return null;
  }
}
