import { describe, expect, it } from 'vitest';
import { Battle, Rng, simulateBattle, validateArmy } from '../src/sim';
import type { ArmySetup, BattleCommand, Team } from '../src/sim';
import { MAPS, RIVER_CROSSING } from '../src/data/maps';
import { TEST_ARMY_BLUE, TEST_ARMY_RED } from '../src/data/testArmies';
import { Lockstep, type InputFrame } from '../src/net/lockstep';
import { commitHash, randomSalt, sha256Hex, verifyReveal } from '../src/net/commit';

const SETUPS: [ArmySetup, ArmySetup] = [TEST_ARMY_BLUE, TEST_ARMY_RED];

describe('commit–reveal', () => {
  it('SHA-256 matches the standard test values', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('a'.repeat(1000))).toBe('41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3');
  });

  it('an army matches its fingerprint; a changed army or wrong secret does not', () => {
    const salt = randomSalt();
    const hash = commitHash(TEST_ARMY_BLUE, salt);
    expect(verifyReveal(TEST_ARMY_BLUE, salt, hash)).toBe(true);
    // Same army listed in another order: still matches.
    expect(verifyReveal({ units: [...TEST_ARMY_BLUE.units].reverse() }, salt, hash)).toBe(true);
    const moved = { units: TEST_ARMY_BLUE.units.map((u, i) => (i === 0 ? { ...u, ty: u.ty + 1 } : u)) };
    expect(verifyReveal(moved, salt, hash)).toBe(false);
    expect(verifyReveal(TEST_ARMY_BLUE, randomSalt(), hash)).toBe(false);
  });
});

/**
 * Two "devices" playing one online battle over a fake network: every message arrives
 * 0..maxLag rounds later, each device runs at its own uneven pace, and both players give
 * random orders. Both battles must stay identical on every tick.
 */
function playOnline(seed: number, maxLag: number, orderChancePct: number) {
  const rng = new Rng(seed);
  const map = MAPS[seed % MAPS.length];
  const battles = [new Battle(map, SETUPS, seed), new Battle(map, SETUPS, seed)];
  const inbox: { at: number; frame: InputFrame }[][] = [[], []];
  let round = 0;
  const locks = ([0, 1] as Team[]).map(
    (team) =>
      new Lockstep(team, (frame) => {
        const other = team === 0 ? 1 : 0;
        inbox[other].push({ at: round + rng.int(maxLag + 1), frame: JSON.parse(JSON.stringify(frame)) });
      }),
  );
  const hashes: [number[], number[]] = [[], []];
  for (round = 0; round < 20000 && !(battles[0].result && battles[1].result); round++) {
    for (const team of [0, 1] as Team[]) {
      // Deliver arrived messages (the network keeps them in order).
      const box = inbox[team];
      while (box.length && box[0].at <= round) locks[team].receive(box.shift()!.frame);
      const b = battles[team];
      if (b.result) continue;
      // Sometimes the player gives a random order.
      if (rng.int(100) < orderChancePct) {
        const enemies = b.units.filter((u) => u.alive && u.team !== team);
        const cmd: BattleCommand =
          rng.int(3) === 0 && enemies.length
            ? { kind: 'focus', target: enemies[rng.int(enemies.length)].id }
            : { kind: 'mode', mode: (['auto', 'king', 'formation'] as const)[rng.int(3)] };
        locks[team].queue(cmd);
      }
      // Uneven pace: 0-3 ticks this round.
      for (let n = rng.int(4); n > 0; n--) {
        if (!locks[team].step(b)) break;
        hashes[team][b.tick] = b.stateHash();
      }
    }
  }
  return { battles, hashes };
}

describe('online lockstep', () => {
  it('both devices see exactly the same battle, even with lag and random orders', () => {
    for (const seed of [1, 2, 3]) {
      const { battles, hashes } = playOnline(seed, 6, 3);
      expect(battles[0].result).not.toBeNull();
      expect(battles[1].result).toEqual(battles[0].result);
      expect(hashes[1]).toEqual(hashes[0]);
      expect(battles[0].commandLog.length).toBeGreaterThan(0);
      // Both players' orders were applied (the log holds orders from both teams).
      expect(new Set(battles[0].commandLog.map((c) => c.team)).size).toBe(2);
      // And the replay (from the recorded orders) gives the same battle again.
      const replay = simulateBattle(battles[0].map, SETUPS, seed, battles[0].commandLog);
      expect(replay).toEqual(battles[0].result);
    }
  });

  it('a device waits (does not run ahead) until the friend\'s orders arrive', () => {
    const b = new Battle(RIVER_CROSSING, SETUPS, 1);
    const sent: InputFrame[] = [];
    const lock = new Lockstep(0, (f) => sent.push(f), 4);
    for (let i = 0; i < 10; i++) lock.step(b);
    expect(b.tick).toBe(4); // ticks 0-3 need nobody's orders; tick 4 needs the friend's frame
    lock.receive({ tick: 4, commands: [] });
    expect(lock.step(b)).toBe(true);
    expect(b.tick).toBe(5);
    // Our own frames went out for ticks 4..8 (always `delay` ticks ahead of where we are).
    expect(sent.map((f) => f.tick)).toEqual([4, 5, 6, 7, 8]);
  });

  it('the test armies are valid for both online sides', () => {
    expect(validateArmy(TEST_ARMY_BLUE, 0, RIVER_CROSSING)).toEqual([]);
    expect(validateArmy(TEST_ARMY_RED, 1, RIVER_CROSSING)).toEqual([]);
  });
});
