import { describe, expect, it } from 'vitest';
import { Battle, simulateBattle, validateArmy, Rng, Terrain, terrainOf } from '../src/sim';
import type { ArmySetup, MapDef } from '../src/sim';
import { MAPS, OPEN_PLAINS, RIVER_CROSSING, getMap } from '../src/data/maps';
import { TEST_ARMY_BLUE, TEST_ARMY_RED } from '../src/data/testArmies';
import { ARMY_RULES } from '../src/config/gameConfig';
import { autoPlace, draftToSetup, newDraft } from '../src/game/armyDraft';

const SETUPS: [ArmySetup, ArmySetup] = [TEST_ARMY_BLUE, TEST_ARMY_RED];
const MIRRORED_BLUE: ArmySetup = { units: TEST_ARMY_BLUE.units.map((u) => ({ ...u, tx: 39 - u.tx })) };

/** A flat 40×20 test map with some tiles changed: `tiles` = [tx, ty, char]. */
function customMap(id: string, tiles: [number, number, string][]): MapDef {
  const rows = Array.from({ length: 20 }, () => [...'.'.repeat(40)]);
  for (const [tx, ty, ch] of tiles) rows[ty][tx] = ch;
  return { id, name: id, width: 40, height: 20, rows: rows.map((r) => r.join('')) };
}

/** A whole-height band of one terrain between two columns (inclusive). */
function band(x0: number, x1: number, ch: string): [number, number, string][] {
  const out: [number, number, string][] = [];
  for (let tx = x0; tx <= x1; tx++) for (let ty = 0; ty < 20; ty++) out.push([tx, ty, ch]);
  return out;
}

describe('maps', () => {
  it('there are the 5 planned maps', () => {
    expect(MAPS.map((m) => m.name)).toEqual(['Open Plains', 'River Crossing', 'Twin Peaks', 'Mountain Pass', 'Lake Valley']);
    expect(getMap('lake-valley').name).toBe('Lake Valley');
  });

  for (const map of MAPS) {
    describe(map.name, () => {
      it('is 40 × 20 and only uses known tiles', () => {
        expect(map.rows.length).toBe(20);
        for (const row of map.rows) expect(row).toMatch(/^[.^~-]{40}$/);
        expect(() => new Terrain(map)).not.toThrow();
      });

      it('is mirror-symmetrical (fair for both sides)', () => {
        for (const row of map.rows) expect([...row].reverse().join('')).toBe(row);
      });

      it('has flat deployment zones', () => {
        for (const row of map.rows) {
          expect(row.slice(0, ARMY_RULES.deployColumns)).toMatch(/^\.+$/);
          expect(row.slice(-ARMY_RULES.deployColumns)).toMatch(/^\.+$/);
        }
      });

      it('every walkable tile can reach every other one', () => {
        const t = terrainOf(map);
        const seen = new Set<number>([0]);
        const queue = [0];
        while (queue.length) {
          const i = queue.pop()!;
          const [x, y] = [i % 40, Math.floor(i / 40)];
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const n = (y + dy) * 40 + (x + dx);
            if (t.walkableTile(x + dx, y + dy) && !seen.has(n)) {
              seen.add(n);
              queue.push(n);
            }
          }
        }
        const walkable = map.rows.join('').replace(/~/g, '').length;
        expect(seen.size).toBe(walkable);
      });

      it('accepts the test armies and auto-placed armies', () => {
        expect(validateArmy(TEST_ARMY_BLUE, 0, map)).toEqual([]);
        expect(validateArmy(TEST_ARMY_RED, 1, map)).toEqual([]);
        const d = newDraft();
        autoPlace(d, map.height);
        expect(validateArmy(draftToSetup(d, 0, map.width), 0, map)).toEqual([]);
      });

      it('is deterministic (same seed = same battle, input order does not matter)', () => {
        const a = simulateBattle(map, SETUPS, 11);
        expect(simulateBattle(map, SETUPS, 11)).toEqual(a);
        const rng = new Rng(3);
        const shuffled = [...TEST_ARMY_BLUE.units].sort(() => (rng.int(2) ? 1 : -1));
        expect(simulateBattle(map, [{ units: shuffled }, TEST_ARMY_RED], 11).hash).toBe(a.hash);
      });

      it('no unit ever stands in deep water', () => {
        for (const seed of [1, 2, 3]) {
          const b = new Battle(map, SETUPS, seed);
          while (!b.result) {
            b.step();
            for (const u of b.units) if (u.alive) expect(b.terrain.walkableAt(u.x, u.y)).toBe(true);
          }
        }
      });

      it('mirrored identical armies are roughly fair', () => {
        const wins = [0, 0, 0];
        for (let seed = 1; seed <= 16; seed++) {
          const r = simulateBattle(map, [TEST_ARMY_BLUE, MIRRORED_BLUE], seed);
          wins[r.winner === null ? 2 : r.winner]++;
        }
        expect(wins[0]).toBeLessThanOrEqual(12);
        expect(wins[1]).toBeLessThanOrEqual(12);
      });
    });
  }

  it('battles stay fast on every map', () => {
    for (const map of MAPS) {
      const start = performance.now();
      for (let seed = 1; seed <= 5; seed++) simulateBattle(map, SETUPS, seed);
      const ms = (performance.now() - start) / 5;
      console.log(`${map.name}: ${ms.toFixed(1)} ms per battle`);
      expect(ms).toBeLessThan(500);
    }
  });
});

describe('path-finding', () => {
  it('straight lines are blocked by deep water but not by flat ground', () => {
    const t = terrainOf(customMap('wall', band(20, 20, '~')));
    expect(t.lineClear(5500, 10500, 15500, 3500)).toBe(true);
    expect(t.lineClear(5500, 10500, 30500, 10500)).toBe(false);
  });

  it('a unit crosses the river through a ford, never through deep water', () => {
    const blue: ArmySetup = { units: [{ type: 'horseman', tx: 5, ty: 10 }] };
    const red: ArmySetup = { units: [{ type: 'king', tx: 39, ty: 10 }] };
    const b = new Battle(RIVER_CROSSING, [blue, red], 1);
    const horse = b.units[0];
    let waded = false;
    while (!b.result && horse.x < 24000) {
      b.step();
      const tile = RIVER_CROSSING.rows[Math.floor(horse.y / 1000)][Math.floor(horse.x / 1000)];
      expect(tile).not.toBe('~');
      if (tile === '-') waded = true;
    }
    expect(horse.x).toBeGreaterThanOrEqual(24000); // made it to the other side
    expect(waded).toBe(true);
  });

  it('a unit walks around a wall of deep water through its gap', () => {
    // Deep water in column 20 everywhere except row 2.
    const map = customMap('gap', band(20, 20, '~').filter(([, ty]) => ty !== 2));
    const blue: ArmySetup = { units: [{ type: 'swordsman', tx: 5, ty: 17 }] };
    const red: ArmySetup = { units: [{ type: 'king', tx: 39, ty: 17 }] };
    const b = new Battle(map, [blue, red], 1);
    const sword = b.units[0];
    for (let i = 0; i < 20 * 40 && sword.x < 21000; i++) b.step();
    expect(sword.x).toBeGreaterThanOrEqual(21000);
  });
});

describe('terrain effects', () => {
  it('mountains slow units down', () => {
    const mountains = customMap('mountains', band(6, 33, '^'));
    const walked = (map: MapDef) => {
      const b = new Battle(map, [{ units: [{ type: 'swordsman', tx: 5, ty: 10 }] }, { units: [{ type: 'king', tx: 39, ty: 10 }] }], 1);
      for (let i = 0; i < 100; i++) b.step(); // 5 s
      return b.units[0].x - 5500;
    };
    const flat = walked(OPEN_PLAINS);
    const slow = walked(mountains);
    expect(flat).toBeGreaterThan(4000);
    expect(slow).toBeLessThan(flat * 0.6);
  });

  /**
   * Damage of Blue's first hit, with Blue standing on `ch`. A Swordsman hits a Swordsman next
   * to it; a Mage blasts a Medic 3 tiles away (melee hits would interrupt the Mage's cast).
   */
  function oneHit(ch: string, type: 'swordsman' | 'mage' = 'swordsman'): number {
    const map = customMap(`hit-${ch}-${type}`, [[10, 10, ch]]);
    const redArmy: ArmySetup = {
      units: [type === 'mage' ? { type: 'medic', tx: 13, ty: 10 } : { type: 'swordsman', tx: 11, ty: 10 }],
    };
    const b = new Battle(map, [{ units: [{ type, tx: 10, ty: 10 }] }, redArmy], 1);
    const red = b.units[1];
    for (let i = 0; i < 200; i++) {
      const before = red.hp;
      b.step();
      if (b.events.some((e) => (e.kind === 'melee' || e.kind === 'spell') && e.from === 0)) return before - red.hp;
    }
    throw new Error('Blue never attacked');
  }

  it('high ground: +25% damage; shallow water: −25% damage', () => {
    expect(oneHit('.')).toBe(1500);
    expect(oneHit('^')).toBe(1875);
    expect(oneHit('-')).toBe(1125);
    expect(oneHit('^', 'mage')).toBe(2500); // the Mage's blast too
  });

  it('ranged units shoot 1 tile further from high ground (melee units do not)', () => {
    const map = customMap('range', [[10, 10, '^'], [10, 12, '^']]);
    const b = new Battle(
      map,
      [{ units: [{ type: 'archer', tx: 10, ty: 10 }, { type: 'swordsman', tx: 10, ty: 12 }, { type: 'archer', tx: 5, ty: 5 }] }, { units: [{ type: 'king', tx: 39, ty: 10 }] }],
      1,
    );
    const at = (x: number, y: number) => b.units.find((u) => u.x === x * 1000 + 500 && u.y === y * 1000 + 500)!;
    const [archerHigh, swordHigh, archerFlat] = [at(10, 10), at(10, 12), at(5, 5)];
    expect(b.rangeSqOf(archerHigh)).toBe(7100 * 7100);
    expect(b.rangeSqOf(archerFlat)).toBe(6100 * 6100);
    expect(b.rangeSqOf(swordHigh)).toBe(1100 * 1100);
  });
});
