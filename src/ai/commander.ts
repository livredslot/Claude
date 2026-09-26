/**
 * The computer opponent's battle orders (the same orders a player can give).
 *
 *  - Easy:   never gives orders (its units just fight the nearest enemy).
 *  - Medium: goes for your King once your army is nearly gone, or your King is badly hurt.
 *  - Hard:   the same, plus it can open by marching in formation, defends its own King
 *            (whole army focuses an enemy attacking it) and, at the very end, goes for your
 *            King if it would otherwise lose on time.
 *
 * (Tested with many simulated battles: sending everyone after the King too early loses
 * battles, because the army runs past enemies that then pick it off.)
 *
 * Decisions use only the battle state, so they are identical every time; the orders are
 * recorded in the battle's command log, so replays repeat them exactly.
 */
import { AI_RULES, SIM_RULES } from '../config/gameConfig';
import { SUB } from '../sim/fixed';
import type { Battle } from '../sim/battle';
import type { AttackMode, BattleCommand, Team } from '../sim/types';
import type { Difficulty } from './armyBuilder';

export class AiCommander {
  constructor(
    private readonly difficulty: Difficulty,
    private readonly team: Team,
  ) {}

  /** Call once per tick, before battle.step(). Gives an order when the plan changes. */
  update(battle: Battle): void {
    if (this.difficulty === 'easy' || battle.result) return;
    const every = Math.round(AI_RULES.thinkEverySeconds * SIM_RULES.ticksPerSecond);
    if (battle.tick % every !== 0) return;
    const cmd = this.decide(battle);
    if (cmd) battle.issueCommand(this.team, cmd);
  }

  /** The order to give now, or null if nothing needs to change. */
  decide(battle: Battle): BattleCommand | null {
    const me = this.team;
    const foe: Team = me === 0 ? 1 : 0;
    const hard = this.difficulty === 'hard';
    const myKing = battle.king(me);

    if (hard && myKing) {
      // Defend the King: everyone focuses the enemy closest to it, if one is attacking it.
      const range = AI_RULES.defendKingRange * SUB;
      let threat = -1;
      let best = range * range;
      for (const e of battle.units) {
        if (!e.alive || e.team === me) continue;
        const dx = e.x - myKing.x;
        const dy = e.y - myKing.y;
        const d = dx * dx + dy * dy;
        if (d <= best) {
          best = d;
          threat = e.id;
        }
      }
      if (threat >= 0 && battle.kingHpPermille(me) < AI_RULES.defendBelowKingHpPct * 10) {
        return battle.focus[me] === threat ? null : { kind: 'focus', target: threat };
      }
      if (battle.focus[me] >= 0) return { kind: 'focus', target: -1 }; // threat gone: back to normal
    }

    let mode: AttackMode = 'auto';
    if (hard && AI_RULES.hardOpeningFormation && battle.tick < AI_RULES.formationUntilSeconds * SIM_RULES.ticksPerSecond) {
      mode = 'formation';
    }
    // Finish off: the enemy army is nearly gone, or the enemy King is badly hurt.
    const mine = battle.aliveCount(me);
    const theirs = battle.aliveCount(foe);
    if (theirs * 100 <= mine * AI_RULES.attackKingWhenEnemyLeftPct) mode = 'king';
    if (battle.kingHpPermille(foe) < AI_RULES.attackKingBelowHpPct * 10) mode = 'king';
    if (hard) {
      // At the very end, a King with less HP loses on time: go for the enemy King.
      const lateTick = (SIM_RULES.maxBattleSeconds - AI_RULES.lateAttackSeconds) * SIM_RULES.ticksPerSecond;
      if (battle.tick >= lateTick && battle.kingHpPermille(me) < battle.kingHpPermille(foe)) mode = 'king';
    }
    // 'formation' is only set once at the start: re-issuing it would re-form the block.
    if (mode === 'formation' && battle.modes[me] === 'formation') return null;
    return battle.modes[me] === mode ? null : { kind: 'mode', mode };
  }
}
