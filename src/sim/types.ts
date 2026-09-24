import type { UnitType } from '../config/gameConfig';

export type { UnitType };

/** 0 = Blue (left side), 1 = Red (right side). */
export type Team = 0 | 1;

export type Stance = 'advance' | 'hold' | 'flank';

/** One unit placed by a player before the battle, in absolute map tile coordinates. */
export interface UnitPlacement {
  type: UnitType;
  /** Tile column (0 = left edge). */
  tx: number;
  /** Tile row (0 = top edge). */
  ty: number;
  stance?: Stance;
}

/** Everything a player chooses secretly before the battle. (Element is added in Phase 6.) */
export interface ArmySetup {
  units: UnitPlacement[];
}

/**
 * Tile characters used in map files:
 *   '.' flat   '^' mountain   '~' deep water   '-' shallow water
 */
export type TileChar = '.' | '^' | '~' | '-';

export interface MapDef {
  id: string;
  name: string;
  width: number;
  height: number;
  /** `height` strings, each `width` characters long. */
  rows: string[];
}

/** Everything needed to reproduce (replay) a battle exactly. */
export interface BattleRecord {
  mapId: string;
  seed: number;
  setups: [ArmySetup, ArmySetup];
}

export type BattleEvent =
  | { kind: 'melee'; from: number; to: number }
  | { kind: 'arrow'; from: number; to: number }
  | { kind: 'spell'; from: number; x: number; y: number; radius: number }
  | { kind: 'interrupt'; unit: number }
  | { kind: 'death'; unit: number };

export type EndReason = 'king' | 'annihilation' | 'timeout';

export interface BattleResult {
  /** 0 or 1, or null for a draw. */
  winner: Team | null;
  reason: EndReason;
  /** Tick on which the battle ended. */
  tick: number;
  /** Remaining army value per team, ×1000 (a full-health value-2 unit = 2000). */
  values: [number, number];
  unitsLost: [number, number];
  /** Damage dealt, by unit type, per team (in whole HP). */
  damageByType: [Record<UnitType, number>, Record<UnitType, number>];
  /** Hash of the final battle state, for desync checks and tests. */
  hash: number;
}
