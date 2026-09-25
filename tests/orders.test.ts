import { describe, expect, it } from 'vitest';
import { Battle, simulateBattle } from '../src/sim';
import type { ArmySetup, RecordedCommand } from '../src/sim';
import { OPEN_PLAINS } from '../src/data/maps';
import { TEST_ARMY_BLUE, TEST_ARMY_RED } from '../src/data/testArmies';

const SETUPS: [ArmySetup, ArmySetup] = [TEST_ARMY_BLUE, TEST_ARMY_RED];

function battleWithOrders(seed: number, give: (b: Battle) => void): Battle {
  const b = new Battle(OPEN_PLAINS, SETUPS, seed);
  while (!b.result) {
    give(b);
    b.step();
  }
  return b;
}

describe('player orders', () => {
  it('a battle with orders replays identically from its command log', () => {
    const live = battleWithOrders(5, (b) => {
      if (b.tick === 100) b.issueCommand(0, { kind: 'mode', mode: 'king' });
      if (b.tick === 400) b.issueCommand(0, { kind: 'mode', mode: 'auto' });
      if (b.tick === 500) b.issueCommand(0, { kind: 'focus', target: b.units.find((u) => u.team === 1 && u.alive)!.id });
    });
    const log: RecordedCommand[] = live.commandLog;
    expect(log.length).toBe(3);
    const replay = simulateBattle(OPEN_PLAINS, SETUPS, 5, log);
    expect(replay).toEqual(live.result);
  });

  it('orders change the battle', () => {
    const plain = simulateBattle(OPEN_PLAINS, SETUPS, 5);
    const king = simulateBattle(OPEN_PLAINS, SETUPS, 5, [{ tick: 0, team: 0, command: { kind: 'mode', mode: 'king' } }]);
    expect(king.hash).not.toBe(plain.hash);
  });

  it("'king' mode sends every fighter after the enemy King", () => {
    const b = new Battle(OPEN_PLAINS, SETUPS, 1);
    b.issueCommand(0, { kind: 'mode', mode: 'king' });
    b.step();
    const redKing = b.kingIds[1];
    for (const u of b.units) {
      if (u.team === 0 && u.type !== 'medic' && u.type !== 'king') expect(u.targetId).toBe(redKing);
    }
  });

  it('focus makes everyone target the chosen enemy, and clears when it dies', () => {
    const b = new Battle(OPEN_PLAINS, SETUPS, 1);
    const target = b.units.find((u) => u.team === 1 && u.type === 'archer')!;
    expect(b.issueCommand(0, { kind: 'focus', target: target.id })).toBe(true);
    b.step();
    for (const u of b.units) {
      if (u.team === 0 && u.type !== 'medic' && u.type !== 'king') expect(u.targetId).toBe(target.id);
    }
    while (!b.result && target.alive) b.step();
    if (!target.alive) expect(b.focus[0]).toBe(-1);
  });

  it('rejects focusing a friendly unit', () => {
    const b = new Battle(OPEN_PLAINS, SETUPS, 1);
    expect(b.issueCommand(0, { kind: 'focus', target: b.kingIds[0] })).toBe(false);
  });
});

describe('movement and followers', () => {
  it('fast units pass through their own slower line', () => {
    // A wall of Swordsmen with a Horseman right behind it; the enemy is far away.
    const blue: ArmySetup = {
      units: [
        ...Array.from({ length: 11 }, (_, i) => ({ type: 'swordsman' as const, tx: 5, ty: 5 + i })),
        { type: 'horseman', tx: 4, ty: 10 },
        { type: 'king', tx: 0, ty: 10 },
      ],
    };
    const red: ArmySetup = { units: [{ type: 'king', tx: 39, ty: 10 }] };
    const b = new Battle(OPEN_PLAINS, [blue, red], 1);
    for (let i = 0; i < 100; i++) b.step(); // 5 seconds
    const horse = b.units.find((u) => u.type === 'horseman')!;
    const maxSword = Math.max(...b.units.filter((u) => u.type === 'swordsman' && u.team === 0).map((u) => u.x));
    expect(horse.x).toBeGreaterThan(maxSword + 1000); // more than a tile ahead
  });

  it('the King follows the army and stays behind it', () => {
    const b = new Battle(OPEN_PLAINS, SETUPS, 3);
    for (let i = 0; i < 200; i++) b.step(); // 10 s
    const king = b.units[b.kingIds[0]];
    expect(king.alive).toBe(true);
    const fighters = b.units.filter((u) => u.alive && u.team === 0 && u.type !== 'king' && u.type !== 'medic');
    const avgX = fighters.reduce((s, u) => s + u.x, 0) / fighters.length;
    expect(king.x).toBeGreaterThan(1500 + 3000); // it moved forward from column 1
    expect(king.x).toBeLessThan(avgX); // but stays behind the army
  });

  it('Medics follow the army, not the King', () => {
    const b = new Battle(OPEN_PLAINS, SETUPS, 3);
    for (let i = 0; i < 300; i++) b.step(); // 15 s
    const king = b.units[b.kingIds[0]];
    for (const m of b.units.filter((u) => u.alive && u.team === 0 && u.type === 'medic')) {
      expect(m.x).toBeGreaterThan(king.x);
    }
  });
});

describe('targeting', () => {
  it('every unit (except the King and Medics) targets its nearest enemy', () => {
    const b = new Battle(OPEN_PLAINS, SETUPS, 1);
    for (let i = 0; i < 300; i++) {
      b.step();
      if (b.tick % 20 !== 0) continue;
      for (const u of b.units) {
        if (!u.alive || u.type === 'king' || u.type === 'medic' || u.targetId < 0) continue;
        const t = b.units[u.targetId];
        if (!t.alive) continue;
        // Targets are re-picked once a second, so allow the target to be up to a tile further than the nearest.
        const d = (e: { x: number; y: number }) => Math.hypot(e.x - u.x, e.y - u.y);
        const nearest = Math.min(...b.units.filter((e) => e.alive && e.team !== u.team).map(d));
        expect(d(t)).toBeLessThanOrEqual(nearest + 2000);
      }
    }
  });

  it("the player's focus order overrides nearest-enemy targeting", () => {
    const blue: ArmySetup = { units: [{ type: 'swordsman', tx: 5, ty: 10 }] };
    const red: ArmySetup = {
      units: [
        { type: 'swordsman', tx: 10, ty: 10 },
        { type: 'archer', tx: 10, ty: 16 },
      ],
    };
    const b = new Battle(OPEN_PLAINS, [blue, red], 1);
    const sword = b.units.find((u) => u.team === 0)!;
    const archer = b.units.find((u) => u.type === 'archer')!;
    b.step();
    expect(sword.targetId).not.toBe(archer.id);
    b.issueCommand(0, { kind: 'focus', target: archer.id });
    for (let i = 0; i < 40; i++) b.step();
    expect(sword.targetId).toBe(archer.id);
  });
});
