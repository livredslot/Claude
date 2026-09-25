/**
 * The army a player is building on the setup screen (not part of the simulation).
 * Always stored in Blue/left-side coordinates: columns 0..5, column 5 = front.
 */
import { ARMY_RULES, SETUP_RULES, UNIT_TYPES, UNITS, type UnitType } from '../config/gameConfig';
import type { ArmySetup, Stance } from '../sim/types';

export type Counts = Record<UnitType, number>;

export interface PlacedUnit {
  type: UnitType;
  stance: Stance;
}

export interface ArmyDraft {
  counts: Counts;
  /** Key "tx,ty" → unit on that tile. */
  placed: Map<string, PlacedUnit>;
}

export const ZONE_COLS = ARMY_RULES.deployColumns;

export function tileKey(tx: number, ty: number): string {
  return `${tx},${ty}`;
}

export function parseKey(key: string): [number, number] {
  const [x, y] = key.split(',').map(Number);
  return [x, y];
}

export function newDraft(): ArmyDraft {
  return { counts: { ...SETUP_RULES.defaultCounts }, placed: new Map() };
}

export function totalCount(counts: Counts): number {
  return UNIT_TYPES.reduce((sum, t) => sum + counts[t], 0);
}

/** Lowest and highest allowed count for a type. */
export function countLimits(type: UnitType): [number, number] {
  const req = ARMY_RULES.required[type];
  if (req !== undefined) return [req, req];
  return [0, ARMY_RULES.maxPerType[type]];
}

export function canIncrease(counts: Counts, type: UnitType): boolean {
  return counts[type] < countLimits(type)[1] && totalCount(counts) < ARMY_RULES.size;
}

export function canDecrease(counts: Counts, type: UnitType): boolean {
  return counts[type] > countLimits(type)[0];
}

export function placedOfType(draft: ArmyDraft, type: UnitType): number {
  let n = 0;
  for (const u of draft.placed.values()) if (u.type === type) n++;
  return n;
}

export function remainingToPlace(draft: ArmyDraft, type: UnitType): number {
  return draft.counts[type] - placedOfType(draft, type);
}

export function allPlaced(draft: ArmyDraft): boolean {
  return totalCount(draft.counts) === ARMY_RULES.size && draft.placed.size === ARMY_RULES.size;
}

/** Remove placed units that exceed the chosen counts (after counts were lowered). */
export function trimToCounts(draft: ArmyDraft): void {
  for (const type of UNIT_TYPES) {
    let excess = placedOfType(draft, type) - draft.counts[type];
    if (excess <= 0) continue;
    // Remove from the back of the formation first.
    const keys = [...draft.placed.entries()]
      .filter(([, u]) => u.type === type)
      .map(([k]) => k)
      .sort((a, b) => parseKey(a)[0] - parseKey(b)[0]);
    for (const k of keys) {
      if (excess-- <= 0) break;
      draft.placed.delete(k);
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

/** Rows ordered from the edges inward: 1, 18, 2, 17, ... (the very edge rows last). */
function edgesIn(height: number): number[] {
  const edgeDist = (r: number) => (r === 0 || r === height - 1 ? height : Math.min(r, height - 1 - r));
  return Array.from({ length: height }, (_, r) => r).sort((a, b) => edgeDist(a) - edgeDist(b) || a - b);
}

interface Slot {
  type: UnitType;
  /** Preferred columns, in order. */
  cols: number[];
  rows: 'centre' | 'edges';
}

/**
 * Fill the unplaced units into the free tiles:
 *  front (col 5): Spearmen in the middle, Swordsmen beside them
 *  col 4: Horsemen on the wings
 *  col 3: Archers   col 2: Medics   col 1: Mages   col 0: King (centre, well protected)
 * Units spill into neighbouring columns when a column is full.
 */
export function autoPlace(draft: ArmyDraft, height: number): void {
  const order: Slot[] = [
    { type: 'king', cols: [0, 1, 2, 3, 4, 5], rows: 'centre' },
    { type: 'spearman', cols: [5, 4, 3, 2, 1, 0], rows: 'centre' },
    { type: 'swordsman', cols: [5, 4, 3, 2, 1, 0], rows: 'centre' },
    { type: 'horseman', cols: [4, 5, 3, 2, 1, 0], rows: 'edges' },
    { type: 'archer', cols: [3, 2, 4, 1, 5, 0], rows: 'centre' },
    { type: 'medic', cols: [2, 1, 3, 0, 4, 5], rows: 'centre' },
    { type: 'mage', cols: [1, 2, 0, 3, 4, 5], rows: 'centre' },
  ];
  const centre = centreOut(height);
  const edges = edgesIn(height);
  for (const slot of order) {
    let left = remainingToPlace(draft, slot.type);
    const rows = slot.rows === 'centre' ? centre : edges;
    for (const col of slot.cols) {
      for (const row of rows) {
        if (left <= 0) break;
        const key = tileKey(col, row);
        if (draft.placed.has(key)) continue;
        draft.placed.set(key, { type: slot.type, stance: 'advance' });
        left--;
      }
    }
  }
}

/**
 * Used when the setup timer runs out: top up the counts to 25 with the
 * default filler unit, then auto-place anything not yet on the map.
 */
export function autoComplete(draft: ArmyDraft, height: number): void {
  for (const type of UNIT_TYPES) {
    const [min, max] = countLimits(type);
    draft.counts[type] = Math.min(Math.max(draft.counts[type], min), max);
  }
  let missing = ARMY_RULES.size - totalCount(draft.counts);
  const fillers: UnitType[] = [SETUP_RULES.autoFillType, ...UNIT_TYPES];
  for (const type of fillers) {
    while (missing > 0 && canIncrease(draft.counts, type)) {
      draft.counts[type]++;
      missing--;
    }
  }
  trimToCounts(draft);
  autoPlace(draft, height);
}

/** Convert the draft to a simulation setup for the given side of the map. */
export function draftToSetup(draft: ArmyDraft, side: 0 | 1, mapWidth: number): ArmySetup {
  return {
    units: [...draft.placed.entries()].map(([key, u]) => {
      const [tx, ty] = parseKey(key);
      return { type: u.type, tx: side === 0 ? tx : mapWidth - 1 - tx, ty, stance: u.stance };
    }),
  };
}

// ---------------------------------------------------------------------------
// Presets saved in the browser.
// ---------------------------------------------------------------------------

const PRESET_KEY = 'mystical-armies.preset.v1';

interface SavedDraft {
  counts: Counts;
  placed: [string, PlacedUnit][];
}

export function savePreset(draft: ArmyDraft): boolean {
  try {
    const data: SavedDraft = { counts: draft.counts, placed: [...draft.placed.entries()] };
    localStorage.setItem(PRESET_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

/** Returns null if nothing is saved (or the save is unreadable). */
export function loadPreset(): ArmyDraft | null {
  try {
    const raw = localStorage.getItem(PRESET_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as SavedDraft;
    const counts = { ...SETUP_RULES.defaultCounts };
    for (const t of UNIT_TYPES) if (typeof data.counts?.[t] === 'number') counts[t] = data.counts[t];
    const placed = new Map<string, PlacedUnit>();
    for (const [k, u] of data.placed ?? []) {
      if (!UNITS[u.type]) continue;
      // Removed stances ('hold') in older saves fall back to 'advance'.
      const stance = u.stance === 'flank' ? 'flank' : 'advance';
      placed.set(k, { type: u.type, stance });
    }
    const draft = { counts, placed };
    trimToCounts(draft);
    return draft;
  } catch {
    return null;
  }
}
