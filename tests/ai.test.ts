import { describe, expect, it } from 'vitest';
import { Battle, Rng, simulateBattle, validateArmy } from '../src/sim';
import type { ArmySetup } from '../src/sim';
import { MAPS, OPEN_PLAINS } from '../src/data/maps';
import { TEST_ARMY_BLUE } from '../src/data/testArmies';
import { ARMY_RULES, UNIT_TYPES } from '../src/config/gameConfig';
import { draftToSetup, totalGroups } from '../src/game/armyDraft';
import { ARMY_STYLES, HardArmyPlanner, draftFromStyle, easyDraft, mediumDraft } from '../src/ai/armyBuilder';
import { AiCommander } from '../src/ai/commander';

describe('AI army building', () => {
  it('every army style has the right number of groups', () => {
    for (const s of ARMY_STYLES) {
      const d = draftFromStyle(s, 20);
      expect(totalGroups(d.counts)).toBe(ARMY_RULES.groups);
    }
  });

  it('Easy and Medium always build valid armies, on both sides of every map', () => {
    for (const map of MAPS) {
      for (let seed = 1; seed <= 15; seed++) {
        for (const make of [easyDraft, mediumDraft]) {
          const d = make(new Rng(seed), map.height);
          for (const side of [0, 1] as const) {
            expect(validateArmy(draftToSetup(d, side, map.width), side, map)).toEqual([]);
          }
        }
      }
    }
  });

  it('Easy armies are varied (random), Medium uses the army styles', () => {
    const mixes = new Set<string>();
    for (let seed = 1; seed <= 10; seed++) {
      const d = easyDraft(new Rng(seed), 20);
      mixes.add(UNIT_TYPES.map((t) => d.counts[t]).join(','));
    }
    expect(mixes.size).toBeGreaterThan(5);
  });

  it('Hard picks a valid army and beats Easy armies most of the time', () => {
    const planner = new HardArmyPlanner(OPEN_PLAINS, 1, new Rng(7));
    let steps = 0;
    while (!planner.work(20)) steps++;
    expect(steps).toBeGreaterThan(0); // it really works in small slices
    const hard = draftToSetup(planner.result(), 1, OPEN_PLAINS.width);
    expect(validateArmy(hard, 1, OPEN_PLAINS)).toEqual([]);

    let hardWins = 0;
    let easyWins = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const easy = draftToSetup(easyDraft(new Rng(100 + seed), 20), 0, OPEN_PLAINS.width);
      const r = simulateBattle(OPEN_PLAINS, [easy, hard], seed);
      if (r.winner === 1) hardWins++;
      if (r.winner === 0) easyWins++;
    }
    expect(hardWins).toBeGreaterThan(easyWins);
  }, 60000);
});

describe('AI battle orders', () => {
  const setups = (): [ArmySetup, ArmySetup] => [
    TEST_ARMY_BLUE,
    draftToSetup(draftFromStyle(ARMY_STYLES[0], 20), 1, OPEN_PLAINS.width),
  ];

  function fight(difficulty: 'easy' | 'medium' | 'hard', seed: number): Battle {
    const b = new Battle(OPEN_PLAINS, setups(), seed);
    const ai = new AiCommander(difficulty, 1);
    while (!b.result) {
      ai.update(b);
      b.step();
    }
    return b;
  }

  it('Easy gives no orders; Medium and Hard do', () => {
    expect(fight('easy', 3).commandLog.length).toBe(0);
    const ordered = [1, 2, 3, 4, 5].some((s) => fight('hard', s).commandLog.length > 0);
    expect(ordered).toBe(true);
  });

  it('AI orders are recorded, so the battle replays exactly', () => {
    for (const d of ['medium', 'hard'] as const) {
      const b = fight(d, 4);
      expect(simulateBattle(OPEN_PLAINS, setups(), 4, b.commandLog)).toEqual(b.result);
      expect(fight(d, 4).result).toEqual(b.result); // and the AI decides the same way every time
    }
  });

  it('only gives orders for its own side', () => {
    const b = fight('hard', 2);
    for (const c of b.commandLog) expect(c.team).toBe(1);
  });
});
