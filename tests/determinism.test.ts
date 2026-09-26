import { describe, expect, it } from 'vitest';
import { Battle, armySize, simulateBattle, validateArmy, Rng } from '../src/sim';
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
  it('are valid 37-unit armies inside their deployment zones', () => {
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
  it('losing your King loses the battle immediately', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const b = new Battle(OPEN_PLAINS, SETUPS, seed);
      while (!b.result) {
        b.step();
        const k0 = b.units[b.kingIds[0]].alive;
        const k1 = b.units[b.kingIds[1]].alive;
        if (!k0 || !k1) {
          expect(b.result).not.toBeNull();
          expect(b.result!.reason).toBe('king');
          expect(b.result!.winner).toBe(!k0 && !k1 ? null : k0 ? 0 : 1);
        }
      }
    }
  });

  it('armies without exactly one King are rejected', () => {
    const noKing = { units: TEST_ARMY_BLUE.units.map((u) => (u.type === 'king' ? { ...u, type: 'archer' as const } : u)) };
    expect(validateArmy(noKing, 0, OPEN_PLAINS).join()).toMatch(/King/);
  });

  it('always ends within 60 seconds (1200 ticks) with a valid result', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const r = simulateBattle(OPEN_PLAINS, SETUPS, seed);
      expect(r.tick).toBeLessThanOrEqual(1200);
      if (r.reason === 'king') {
        // Only ends early; the loser's King is dead.
        expect(r.tick).toBeLessThanOrEqual(1200);
      } else if (r.reason === 'annihilation') {
        expect(r.winner === null ? 0 : r.unitsLost[r.winner === 0 ? 1 : 0]).toBe(r.winner === null ? 0 : armySize());
      } else {
        // Time's up with both Kings alive: the King with more HP wins, equal HP is a draw.
        expect(r.tick).toBe(1200);
        if (r.winner === null) expect(r.kingHp[0]).toBe(r.kingHp[1]);
        else expect(r.kingHp[r.winner]).toBeGreaterThan(r.kingHp[r.winner === 0 ? 1 : 0]);
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

describe('time-out rule (both Kings alive after 60 s)', () => {
  const kingsOnly = (hpBlue: number, hpRed: number) => {
    // Two lone Kings far apart; set their HP directly, then let the clock run out.
    const b = new Battle(
      OPEN_PLAINS,
      [{ units: [{ type: 'king', tx: 0, ty: 0 }] }, { units: [{ type: 'king', tx: 39, ty: 19 }] }],
      1,
    );
    b.units[b.kingIds[0]].hp = hpBlue;
    b.units[b.kingIds[1]].hp = hpRed;
    b.tick = b.maxTicks - 1; // jump to the last tick so the Kings can't reach each other
    return b.runToEnd();
  };

  it('both Kings at full HP: draw', () => {
    const r = kingsOnly(20000, 20000);
    expect(r.reason).toBe('timeout');
    expect(r.winner).toBeNull();
  });

  it('the King with more HP wins', () => {
    expect(kingsOnly(15000, 9000).winner).toBe(0);
    expect(kingsOnly(9000, 15000).winner).toBe(1);
  });

  it('same HP (not full): draw', () => {
    expect(kingsOnly(12000, 12000).winner).toBeNull();
  });
});
