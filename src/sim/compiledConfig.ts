/**
 * Converts the human-friendly numbers in config/gameConfig.ts into the integer
 * units the simulation uses (sub-tiles, centi-HP, ticks). Rounding happens once
 * here, so the simulation itself only ever sees integers.
 */
import { KING_RULES, RETALIATION_RULES, SIM_RULES, STANCE_RULES, UNITS, UNIT_RULES, UNIT_TYPES, type UnitType } from '../config/gameConfig';
import { HP_SCALE, tilesToSub } from './fixed';

const TPS = SIM_RULES.ticksPerSecond;

export function secondsToTicks(seconds: number): number {
  return Math.max(1, Math.round(seconds * TPS));
}

function sq(n: number): number {
  return n * n;
}

export interface CompiledStats {
  maxHp: number; // centi-HP
  damage: number; // centi-HP
  attackTicks: number;
  rangeSq: number; // sub-tiles²
  speed: number; // sub-tiles per tick
  value: number;
  ranged: boolean;
}

function compileUnit(type: UnitType): CompiledStats {
  const s = UNITS[type];
  return {
    maxHp: Math.round(s.hp * HP_SCALE),
    damage: Math.round(s.damage * HP_SCALE),
    attackTicks: secondsToTicks(s.attackInterval),
    rangeSq: sq(tilesToSub(s.range + SIM_RULES.rangeTolerance)),
    speed: Math.round(tilesToSub(s.speed) / TPS),
    value: s.value,
    ranged: s.ranged,
  };
}

export const STATS = Object.fromEntries(UNIT_TYPES.map((t) => [t, compileUnit(t)])) as Record<
  UnitType,
  CompiledStats
>;

export const C = {
  maxTicks: SIM_RULES.maxBattleSeconds * TPS,
  retargetTicks: secondsToTicks(SIM_RULES.retargetInterval),
  unitRadius: tilesToSub(SIM_RULES.unitRadius),
  minSeparation: 2 * tilesToSub(SIM_RULES.unitRadius),
  minSeparationSq: sq(2 * tilesToSub(SIM_RULES.unitRadius)),
  initialJitterTicks: Math.round(SIM_RULES.initialAttackJitter * TPS),

  swordsmanArrowPct: 100 - UNIT_RULES.swordsmanArrowReductionPct,
  spearmanVsHorseMult: UNIT_RULES.spearmanVsHorsemanMultiplier,
  horsemanPriorityRangeSq: sq(tilesToSub(UNIT_RULES.horsemanPriorityRange)),
  spearmanPriorityRangeSq: sq(tilesToSub(UNIT_RULES.spearmanPriorityRange)),
  healPerTick: Math.round((UNIT_RULES.medicHealPerSecond * HP_SCALE) / TPS),
  healRadiusSq: sq(tilesToSub(UNIT_RULES.medicHealRadius + SIM_RULES.rangeTolerance)),
  maxMedicsPerTarget: UNIT_RULES.maxMedicsPerTarget,
  medicSeekRangeSq: sq(tilesToSub(UNIT_RULES.medicSeekRange)),
  medicBehind: tilesToSub(UNIT_RULES.medicBehindFrontLine),
  medicFightBackTicks: secondsToTicks(UNIT_RULES.medicFightBackWindow),
  mageRadius: tilesToSub(UNIT_RULES.mageAreaRadius),
  mageRadiusSq: sq(tilesToSub(UNIT_RULES.mageAreaRadius)),

  kingEngageSq: sq(tilesToSub(KING_RULES.engageRange)),
  kingGuardSq: sq(tilesToSub(KING_RULES.guardRadius)),
  kingGuardResponseSq: sq(tilesToSub(KING_RULES.guardResponseRange)),
  kingBehind: tilesToSub(KING_RULES.behindArmy),
  kingFollowSlackSq: sq(tilesToSub(KING_RULES.followSlack)),

  retaliationTicks: secondsToTicks(RETALIATION_RULES.memorySeconds),
  retaliateAgainstRanged: RETALIATION_RULES.againstRanged,

  holdTriggerSq: sq(tilesToSub(STANCE_RULES.holdTriggerRange)),
  flankEngageSq: sq(tilesToSub(STANCE_RULES.flankEngageRange)),
  flankEdgeOffset: tilesToSub(STANCE_RULES.flankEdgeOffset),
};
