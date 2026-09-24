import { describe, expect, it } from 'vitest';
import { Battle, simulateBattle, validateArmy, Rng } from '../src/sim';
import type { ArmySetup } from '../src/sim';
import { OPEN_PLAINS } from '../src/data/maps';
import { TEST_ARMY_BLUE, TEST_ARMY_RED } from '../src/data/testArmies';

const SETUPS: [ArmySetup, ArmySetup] = [TEST_ARMY_BLUE, TEST_ARMY_RED];

function shuffled(setup: ArmySetup, seed: number): ArmySetup {
  const rng = new Rng(seed);
  const units = [...setup.units];
  for (let i = units.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [units[i], units[j]] = [units[j], units[i]];
  }
  return { units };
}

/** Hash after every tick, so we catch divergence anywhere in the battle, not just at the end. */
function tickHashes(setups: [ArmySetup, ArmySetup], seed: number): number[] {
  const b = new Battle(OPEN_PLAINS, setups, seed);
  const hashes: number[] = [];
  while (!b.result) {
    b.step();
    hashes.push(b.stateHash());
  }
  return hashes;
}

describe('test armies', () => {
  it('are valid 25-unit armies inside their deployment zones', () => {
    expect(validateArmy(TEST_ARMY_BLUE, 0, OPEN_PLAINS)).toEqual([]);
    expect(validateArmy(TEST_ARMY_RED, 1, OPEN_PLAINS)).toEqual([]);
  });
});

describe('determinism', () => {
  it('same inputs give the same final hash', () => {
    for (const seed of [1, 42, 123456, 0xdeadbeef]) {
      const a = simulateBattle(OPEN_PLAINS, SETUPS, seed);
      const b = simulateBattle(OPEN_PLAINS, SETUPS, seed);
      expect(b).toEqual(a);
    }
  });

  it('same inputs give identical state on every single tick', () => {
    expect(tickHashes(SETUPS, 7)).toEqual(tickHashes(SETUPS, 7));
  });

  it('unit order in the input does not matter', () => {
    const seed = 99;
    const base = simulateBattle(OPEN_PLAINS, SETUPS, seed);
    for (const s of [1, 2, 3]) {
      const other = simulateBattle(OPEN_PLAINS, [shuffled(TEST_ARMY_BLUE, s), shuffled(TEST_ARMY_RED, s + 100)], seed);
      expect(other.hash).toBe(base.hash);
      expect(other).toEqual(base);
    }
  });

  it('different seeds produce different battles', () => {
    const hashes = new Set([1, 2, 3, 4, 5].map((s) => simulateBattle(OPEN_PLAINS, SETUPS, s).hash));
    expect(hashes.size).toBeGreaterThan(1);
  });
});

describe('battle rules', () => {
  it('always ends within 90 seconds (1800 ticks) with a valid result', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const r = simulateBattle(OPEN_PLAINS, SETUPS, seed);
      expect(r.tick).toBeLessThanOrEqual(1800);
      if (r.reason === 'annihilation') {
        expect(r.winner === null ? 0 : r.unitsLost[r.winner === 0 ? 1 : 0]).toBe(r.winner === null ? 0 : 25);
      } else {
        expect(r.tick).toBe(1800);
        if (r.winner !== null) expect(r.values[r.winner]).toBeGreaterThan(r.values[r.winner === 0 ? 1 : 0]);
      }
    }
  });

  it('mirrored identical armies are roughly fair', () => {
    // Red = Blue mirrored. Over many seeds neither side should dominate.
    const mirrored: ArmySetup = {
      units: TEST_ARMY_BLUE.units.map((u) => ({ ...u, tx: OPEN_PLAINS.width - 1 - u.tx })),
    };
    const wins = [0, 0, 0];
    for (let seed = 1; seed <= 20; seed++) {
      const r = simulateBattle(OPEN_PLAINS, [TEST_ARMY_BLUE, mirrored], seed);
      wins[r.winner === null ? 2 : r.winner]++;
    }
    expect(wins[0]).toBeLessThanOrEqual(15);
    expect(wins[1]).toBeLessThanOrEqual(15);
  });

  it('runs headless fast', () => {
    const start = performance.now();
    const n = 20;
    for (let seed = 1; seed <= n; seed++) simulateBattle(OPEN_PLAINS, SETUPS, seed);
    const ms = (performance.now() - start) / n;
    console.log(`average headless battle: ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(500);
  });
});
