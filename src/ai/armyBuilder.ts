/**
 * How the computer opponent builds and places its army, per difficulty.
 *
 *  - Easy:   random mix of groups, placed at random spots, mostly Advance.
 *  - Medium: one of several sensible army styles, placed with Auto-place.
 *  - Hard:   tries many candidate armies in quick headless battles on the chosen map
 *            against typical player armies and keeps the best one (see HardArmyPlanner).
 *
 * The AI never looks at the player's army: it only knows the map.
 * Pure logic (no Phaser); randomness comes from a seeded Rng so tests are repeatable.
 */
import { AI_RULES, ARMY_RULES, SIM_RULES, UNIT_TYPES, type UnitType } from '../config/gameConfig';
import {
  autoPlace,
  canIncrease,
  draftToSetup,
  fits,
  newDraft,
  remainingToPlace,
  topRowFor,
  ZONE_COLS,
  type ArmyDraft,
  type Counts,
} from '../game/armyDraft';
import { Battle } from '../sim/battle';
import { Rng } from '../sim/rng';
import type { ArmySetup, MapDef, Stance, Team } from '../sim/types';

export type Difficulty = 'easy' | 'medium' | 'hard';
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard'];
export const DIFFICULTY_NAMES: Record<Difficulty, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

/** An army "style": group counts (King excluded) and which types use the Flank stance. */
export interface ArmyStyle {
  name: string;
  counts: Partial<Record<Exclude<UnitType, 'king'>, number>>;
  flank?: UnitType[];
}

/** Sensible army styles (each adds up to ARMY_RULES.groups). Used by Medium and Hard. */
export const ARMY_STYLES: ArmyStyle[] = [
  { name: 'Balanced', counts: { swordsman: 3, spearman: 2, horseman: 2, archer: 3, medic: 1, mage: 1 } },
  { name: 'Shield wall', counts: { swordsman: 5, spearman: 1, archer: 4, medic: 1, mage: 1 } },
  { name: 'Cavalry flank', counts: { swordsman: 2, spearman: 2, horseman: 5, archer: 1, medic: 1, mage: 1 }, flank: ['horseman'] },
  { name: 'Spear wall', counts: { swordsman: 3, spearman: 4, archer: 3, medic: 1, mage: 1 } },
  { name: 'Archer nest', counts: { swordsman: 4, spearman: 2, archer: 5, mage: 1 } },
];

function countsOf(style: ArmyStyle): Counts {
  const c = Object.fromEntries(UNIT_TYPES.map((t) => [t, 0])) as Counts;
  for (const [t, n] of Object.entries(style.counts)) c[t as UnitType] = n;
  c.king = 1;
  // If the army size in the config changes, top up / trim so the style still fits.
  const total = () => UNIT_TYPES.reduce((s, t) => s + (t === 'king' ? 0 : c[t]), 0);
  for (const t of ['swordsman', 'archer', 'spearman', 'horseman'] as const) {
    while (total() < ARMY_RULES.groups && canIncrease(c, t)) c[t]++;
  }
  while (total() > ARMY_RULES.groups) {
    const biggest = UNIT_TYPES.filter((t) => t !== 'king').reduce((a, b) => (c[b] > c[a] ? b : a));
    c[biggest]--;
  }
  return c;
}

/** Build a draft from a style with Auto-place (in Blue/left coordinates, like the player's). */
export function draftFromStyle(style: ArmyStyle, height: number): ArmyDraft {
  const d: ArmyDraft = { counts: countsOf(style), groups: [] };
  autoPlace(d, height);
  for (const g of d.groups) if (style.flank?.includes(g.type)) g.stance = 'flank';
  return d;
}

// ---------------------------------------------------------------------------
// Easy
// ---------------------------------------------------------------------------

/** Random counts (respecting the limits) and random placement. */
export function easyDraft(rng: Rng, height: number): ArmyDraft {
  const d = newDraft();
  for (const t of UNIT_TYPES) d.counts[t] = t === 'king' ? 1 : 0;
  const soldierTypes = UNIT_TYPES.filter((t) => t !== 'king');
  for (let guard = 0; guard < 1000 && UNIT_TYPES.reduce((s, t) => s + (t === 'king' ? 0 : d.counts[t]), 0) < ARMY_RULES.groups; guard++) {
    const t = soldierTypes[rng.int(soldierTypes.length)];
    if (canIncrease(d.counts, t)) d.counts[t]++;
  }
  for (const type of UNIT_TYPES) {
    while (remainingToPlace(d, type) > 0) {
      let placed = false;
      for (let tries = 0; tries < 200 && !placed; tries++) {
        const tx = rng.int(ZONE_COLS);
        const ty = topRowFor(type, rng.int(height), height);
        if (fits(d, type, tx, ty, height)) {
          const stance: Stance = type !== 'king' && type !== 'medic' && rng.int(100) < AI_RULES.easyFlankChancePct ? 'flank' : 'advance';
          d.groups.push({ type, stance, tx, ty });
          placed = true;
        }
      }
      if (!placed) {
        autoPlace(d, height); // no random spot found: fill the rest neatly
        break;
      }
    }
  }
  return d;
}

// ---------------------------------------------------------------------------
// Medium
// ---------------------------------------------------------------------------

export function mediumDraft(rng: Rng, height: number): ArmyDraft {
  return draftFromStyle(ARMY_STYLES[rng.int(ARMY_STYLES.length)], height);
}

// ---------------------------------------------------------------------------
// Hard: test candidates in headless battles
// ---------------------------------------------------------------------------

/** A style with one group moved from one type to another (if the limits allow it). */
function mutate(style: ArmyStyle, rng: Rng): ArmyStyle {
  const counts = { ...style.counts };
  const types = Object.keys(ARMY_RULES.maxGroups) as Exclude<UnitType, 'king'>[];
  for (let tries = 0; tries < 20; tries++) {
    const from = types[rng.int(types.length)];
    const to = types[rng.int(types.length)];
    if (from === to || !(counts[from] ?? 0)) continue;
    if ((counts[to] ?? 0) >= ARMY_RULES.maxGroups[to]) continue;
    counts[from] = (counts[from] ?? 0) - 1;
    counts[to] = (counts[to] ?? 0) + 1;
    return { name: `${style.name}*`, counts, flank: style.flank };
  }
  return style;
}

/**
 * Plans a Hard army without freezing the screen: call work() every frame with a time
 * budget until it returns true, then read result(). Each candidate army fights each
 * "typical player army" once on the chosen map; the one with the best record wins.
 */
export class HardArmyPlanner {
  private readonly candidates: ArmyDraft[];
  private readonly opponents: ArmySetup[];
  private readonly scores: number[];
  private job = 0;
  private battle: Battle | null = null;
  private done = false;

  constructor(
    private readonly map: MapDef,
    private readonly side: Team,
    rng: Rng,
  ) {
    const styles: ArmyStyle[] = [...ARMY_STYLES];
    // Flank variants and a few random tweaks of the basic styles.
    styles.push({ ...ARMY_STYLES[0], name: 'Balanced flank', flank: ['horseman'] });
    for (let i = 0; i < AI_RULES.hardMutations; i++) styles.push(mutate(ARMY_STYLES[rng.int(ARMY_STYLES.length)], rng));
    this.candidates = styles.map((s) => draftFromStyle(s, map.height));
    this.scores = this.candidates.map(() => 0);

    // Typical player armies: the army styles, placed like Auto-place does.
    const enemySide: Team = side === 0 ? 1 : 0;
    this.opponents = ARMY_STYLES.map((s) => draftToSetup(draftFromStyle(s, map.height), enemySide, map.width));
  }

  get totalJobs(): number {
    return this.candidates.length * this.opponents.length;
  }

  /** 0..1, for a progress display. */
  get progress(): number {
    return this.done ? 1 : this.job / this.totalJobs;
  }

  /** Do up to `budgetMs` of planning. Returns true when finished. */
  work(budgetMs: number): boolean {
    const start = performance.now();
    while (!this.done && performance.now() - start < budgetMs) {
      if (!this.battle) {
        const c = Math.floor(this.job / this.opponents.length);
        const o = this.job % this.opponents.length;
        const mine = draftToSetup(this.candidates[c], this.side, this.map.width);
        const setups: [ArmySetup, ArmySetup] = this.side === 0 ? [mine, this.opponents[o]] : [this.opponents[o], mine];
        this.battle = new Battle(this.map, setups, 1000 + this.job);
      }
      // Advance the current test battle in small slices so a frame never takes long.
      const b = this.battle;
      const cutoff = AI_RULES.hardTestSeconds * SIM_RULES.ticksPerSecond;
      for (let i = 0; i < 50 && !b.result && b.tick < cutoff; i++) b.step();
      if (b.result || b.tick >= cutoff) {
        const c = Math.floor(this.job / this.opponents.length);
        const me = this.side;
        const other: Team = me === 0 ? 1 : 0;
        const r = b.result;
        if (r) {
          // Win 3, draw 1, loss 0 ...
          this.scores[c] += r.winner === me ? 3000 : r.winner === null ? 1000 : 0;
        } else {
          // Cut off early: judge by who is ahead (King HP first, like the real time-out rule).
          const kingDiff = b.kingHpPermille(me) - b.kingHpPermille(other);
          this.scores[c] += kingDiff > 0 ? 2000 : kingDiff < 0 ? 500 : 1000;
        }
        // ... plus a small bonus for how much more army is left.
        this.scores[c] += Math.trunc((b.armyValue(me) - b.armyValue(other)) / 100);
        this.battle = null;
        this.job++;
        if (this.job >= this.totalJobs) this.done = true;
      }
    }
    return this.done;
  }

  /** Finish immediately (blocking) and return the best army. */
  finish(): ArmyDraft {
    while (!this.work(1000));
    return this.result();
  }

  result(): ArmyDraft {
    let best = 0;
    for (let i = 1; i < this.scores.length; i++) if (this.scores[i] > this.scores[best]) best = i;
    return this.candidates[best];
  }
}

/** Easy and Medium armies are instant. (Hard: use HardArmyPlanner.) */
export function quickAiDraft(difficulty: Exclude<Difficulty, 'hard'>, rng: Rng, height: number): ArmyDraft {
  return difficulty === 'easy' ? easyDraft(rng, height) : mediumDraft(rng, height);
}
