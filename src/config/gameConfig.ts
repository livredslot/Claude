/**
 * ============================================================
 *  MYSTICAL ARMIES — GAME BALANCE CONFIG
 * ============================================================
 * Every tunable number in the game lives in this file.
 * Change values here to rebalance; you should never need to
 * touch the simulation code to tweak HP, damage, speed, etc.
 *
 * Units used in this file (human friendly):
 *   - distances / ranges / radii: tiles
 *   - speeds: tiles per second
 *   - times / intervals: seconds
 *   - percentages: whole numbers (25 means 25%)
 *
 * The simulation converts these to integers internally
 * (see src/sim/compiledConfig.ts), so results are identical
 * on every device.
 */

export type UnitType = 'swordsman' | 'spearman' | 'horseman' | 'archer' | 'medic' | 'mage' | 'king';

export const UNIT_TYPES: readonly UnitType[] = [
  'swordsman',
  'spearman',
  'horseman',
  'archer',
  'medic',
  'mage',
  'king',
];

export interface UnitStats {
  /** Display name. */
  name: string;
  hp: number;
  /** Damage per attack (for the Mage: area damage per cast). */
  damage: number;
  /** Seconds between attacks (for the Mage: cast time). */
  attackInterval: number;
  /** Attack range in tiles, measured centre to centre. */
  range: number;
  /** Tiles per second. */
  speed: number;
  /** Used for the timeout tiebreak (army value). */
  value: number;
  /** Ranged units shoot from a distance instead of fighting in melee. */
  ranged: boolean;
}

export const UNITS: Record<UnitType, UnitStats> = {
  swordsman: { name: 'Swordsman', hp: 120, damage: 15, attackInterval: 1.0, range: 1.0, speed: 1.0, value: 2, ranged: false },
  spearman: { name: 'Spearman', hp: 110, damage: 12, attackInterval: 1.2, range: 1.5, speed: 0.9, value: 2, ranged: false },
  horseman: { name: 'Horseman', hp: 100, damage: 18, attackInterval: 1.2, range: 1.0, speed: 1.7, value: 3, ranged: false },
  archer: { name: 'Archer', hp: 60, damage: 10, attackInterval: 1.5, range: 6.0, speed: 1.0, value: 2, ranged: true },
  medic: { name: 'Medic', hp: 70, damage: 3, attackInterval: 1.0, range: 1.0, speed: 1.1, value: 2, ranged: false },
  mage: { name: 'Mage', hp: 50, damage: 20, attackInterval: 3.0, range: 5.0, speed: 0.9, value: 3, ranged: true },
  king: { name: 'King', hp: 200, damage: 25, attackInterval: 1.0, range: 1.0, speed: 0.6, value: 5, ranged: false },
};

/**
 * The King: if your King dies, you lose immediately (like chess).
 * The King follows the army from behind and only fights enemies that come close.
 */
export const KING_RULES = {
  /** The King attacks enemies that come within this many tiles. */
  engageRange: 3,
  /** The King follows this many tiles behind the centre of its army. */
  behindArmy: 3,
  /** The King doesn't bother moving if it's within this many tiles of where it wants to be. */
  followSlack: 1,
};

/** Special unit rules. */
export const UNIT_RULES = {
  /** Swordsman shield: % less damage taken from arrows. */
  swordsmanArrowReductionPct: 25,
  /** Spearman damage multiplier against Horsemen. */
  spearmanVsHorsemanMultiplier: 3,
  /** Medic healing, HP per second, applied continuously. */
  medicHealPerSecond: 6,
  /** Medic heal radius in tiles. */
  medicHealRadius: 3,
  /** A single unit can be healed by at most this many Medics at once. */
  maxMedicsPerTarget: 2,
  /** Medics only walk to injured allies within this many tiles; otherwise they follow the army. */
  medicSeekRange: 8,
  /** How far behind the front line (in tiles) Medics try to stay. */
  medicBehindFrontLine: 1.5,
  /** A Medic fights back against an attacker that hit it within this many seconds. */
  medicFightBackWindow: 2,
  /** Mage area-of-effect radius in tiles. */
  mageAreaRadius: 1.5,
};

/** Stance rules. */
export const STANCE_RULES = {
  /**
   * "Keep Formation" battle order: melee units leave the marching block when an
   * enemy comes this close (tiles). Ranged units leave when an enemy is within
   * their attack range. Any unit also leaves the block when it gets hit.
   */
  formationEngageRange: 3,
  /** Flank: stop flanking and engage when an enemy comes this close (tiles). */
  flankEngageRange: 3,
  /** Flank: how far from the top/bottom map edge flankers walk (tiles). */
  flankEdgeOffset: 0.6,
};

/** Army composition rules. */
export const ARMY_RULES = {
  /** Soldiers are picked in groups of this many identical units. */
  groupSize: 3,
  /** Each army has exactly this many groups (12 × 3 = 36 soldiers), plus 1 King = 37 units. */
  groups: 12,
  /** Most groups allowed per unit type. */
  maxGroups: {
    swordsman: 12,
    spearman: 12,
    horseman: 12,
    archer: 12,
    medic: 1,
    mage: 1,
  } as Record<Exclude<UnitType, 'king'>, number>,
  /** Deployment zone: this many columns nearest each player's own map edge. */
  deployColumns: 6,
};

/** Army setup screen. */
export const SETUP_RULES = {
  /** Seconds to choose and place the army in PvP. 0 = no limit. */
  pvpTimeLimit: 60,
  /** Seconds to choose and place the army against the AI. 0 = no limit. */
  aiTimeLimit: 0,
  /** Starting number of GROUPS per type on the setup screen (must add up to ARMY_RULES.groups; King is always 1). */
  defaultCounts: { swordsman: 3, spearman: 2, horseman: 2, archer: 3, medic: 1, mage: 1, king: 1 } as Record<
    UnitType,
    number
  >,
  /** When time runs out, missing groups are filled with this type. */
  autoFillType: 'swordsman' as UnitType,
};

/** Map defaults. */
export const MAP_RULES = {
  width: 40,
  height: 20,
};

export type TerrainType = 'flat' | 'mountain' | 'deep' | 'shallow';

export const TERRAIN_TYPES: readonly TerrainType[] = ['flat', 'mountain', 'deep', 'shallow'];

export interface TerrainStats {
  /** Display name. */
  name: string;
  /** Can units walk on it? (Arrows and spells always fly over every tile.) */
  walkable: boolean;
  /** Walking speed on this tile, % of the unit's normal speed. */
  speedPct: number;
  /** Damage dealt BY a unit standing on this tile, % of normal. */
  damagePct: number;
  /** Extra attack range (tiles) for RANGED units (Archers, Mages) standing on this tile. */
  rangedRangeBonus: number;
}

/**
 * What each kind of ground does. A unit is "on" the tile under its centre.
 * Units find their way around deep water, and around mountains or shallow water
 * when going around is quicker than wading/climbing through.
 */
export const TERRAIN: Record<TerrainType, TerrainStats> = {
  flat: { name: 'Flat', walkable: true, speedPct: 100, damagePct: 100, rangedRangeBonus: 0 },
  /** High ground: slow to climb, but units on top hit harder and shoot further. */
  mountain: { name: 'Mountain', walkable: true, speedPct: 35, damagePct: 125, rangedRangeBonus: 1 },
  /** Nobody can walk here. */
  deep: { name: 'Deep water', walkable: false, speedPct: 0, damagePct: 100, rangedRangeBonus: 0 },
  /** Wading: slow, and units standing in it fight worse. */
  shallow: { name: 'Shallow water', walkable: true, speedPct: 50, damagePct: 75, rangedRangeBonus: 0 },
};

/** Core simulation settings. Changing these changes every battle result. */
export const SIM_RULES = {
  ticksPerSecond: 20,
  /**
   * Battle length. If both Kings are still alive when time runs out, the King
   * with more HP (as a % of its max HP) wins; equal HP is a draw.
   */
  maxBattleSeconds: 60,
  /** Units re-pick their target this often (seconds), or when the target dies. */
  retargetInterval: 1.0,
  /** Collision radius of every unit, in tiles (units cannot overlap). */
  unitRadius: 0.4,
  /** Extra reach added to every attack range so touching units can hit each other. */
  rangeTolerance: 0.1,
  /**
   * When a unit first gets an enemy in reach, its first attack is delayed by a
   * random 0..this many seconds (seeded battle RNG), so fights aren't lockstep.
   */
  initialAttackJitter: 0.5,
};
