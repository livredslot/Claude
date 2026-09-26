import { describe, expect, it } from 'vitest';
import {
  autoComplete,
  autoPlace,
  allPlaced,
  canIncrease,
  draftToSetup,
  fits,
  groupAt,
  newDraft,
  totalGroups,
  trimToCounts,
  topRowFor,
} from '../src/game/armyDraft';
import { OPEN_PLAINS } from '../src/data/maps';
import { validateArmy, simulateBattle, armySize } from '../src/sim';
import { TEST_ARMY_RED } from '../src/data/testArmies';
import { UNIT_TYPES } from '../src/config/gameConfig';

const H = OPEN_PLAINS.height;

describe('army draft (groups of 3)', () => {
  it('default counts are 12 groups plus the King = 37 units', () => {
    const d = newDraft();
    expect(totalGroups(d.counts)).toBe(12);
    expect(d.counts.king).toBe(1);
    expect(armySize()).toBe(37);
  });

  it('auto-place gives a valid army on either side, groups as vertical lines of 3', () => {
    const d = newDraft();
    expect(autoPlace(d, H)).toBe(true);
    expect(allPlaced(d)).toBe(true);
    const setup = draftToSetup(d, 0, OPEN_PLAINS.width);
    expect(setup.units.length).toBe(37);
    expect(validateArmy(setup, 0, OPEN_PLAINS)).toEqual([]);
    expect(validateArmy(draftToSetup(d, 1, OPEN_PLAINS.width), 1, OPEN_PLAINS)).toEqual([]);
    for (const g of d.groups) {
      const tiles = setup.units.filter((u) => u.type === g.type && u.tx === g.tx && u.ty >= g.ty && u.ty < g.ty + 3);
      expect(tiles.length).toBe(g.type === 'king' ? 1 : 3);
    }
  });

  it('auto-place handles extreme mixes (12 groups of one type)', () => {
    for (const type of ['swordsman', 'archer', 'horseman', 'spearman'] as const) {
      const d = newDraft();
      for (const t of UNIT_TYPES) d.counts[t] = t === 'king' ? 1 : 0;
      d.counts[type] = 12;
      expect(autoPlace(d, H)).toBe(true);
      expect(validateArmy(draftToSetup(d, 0, OPEN_PLAINS.width), 0, OPEN_PLAINS)).toEqual([]);
    }
  });

  it('auto-place keeps groups the player already placed', () => {
    const d = newDraft();
    d.groups.push({ type: 'mage', stance: 'flank', tx: 5, ty: 0 });
    autoPlace(d, H);
    expect(d.groups[0]).toEqual({ type: 'mage', stance: 'flank', tx: 5, ty: 0 });
    expect(allPlaced(d)).toBe(true);
  });

  it('groups cannot overlap or stick out of the zone', () => {
    const d = newDraft();
    d.groups.push({ type: 'archer', stance: 'advance', tx: 2, ty: 5 }); // rows 5-7
    expect(fits(d, 'swordsman', 2, 7, H)).toBe(false); // overlaps row 7
    expect(fits(d, 'swordsman', 2, 8, H)).toBe(true);
    expect(fits(d, 'swordsman', 6, 0, H)).toBe(false); // outside the zone
    expect(fits(d, 'swordsman', 0, 18, H)).toBe(false); // would reach row 20
    expect(topRowFor('swordsman', 19, H)).toBe(17); // tapped near the bottom: pushed up
    expect(groupAt(d, 2, 7)).toBe(0);
  });

  it('limits: max 1 group of Medics and of Mages, max 12 groups total', () => {
    const d = newDraft();
    for (const t of UNIT_TYPES) d.counts[t] = t === 'king' ? 1 : 0;
    d.counts.medic = 1;
    expect(canIncrease(d.counts, 'medic')).toBe(false);
    expect(canIncrease(d.counts, 'king')).toBe(false);
    d.counts.archer = 11;
    expect(canIncrease(d.counts, 'archer')).toBe(false); // 12 groups reached
  });

  it('time-out auto-complete turns a partial setup into a valid army', () => {
    const d = newDraft();
    for (const t of UNIT_TYPES) d.counts[t] = 0;
    d.counts.archer = 3;
    d.groups.push({ type: 'archer', stance: 'advance', tx: 3, ty: 3 });
    autoComplete(d, H);
    const setup = draftToSetup(d, 0, OPEN_PLAINS.width);
    expect(validateArmy(setup, 0, OPEN_PLAINS)).toEqual([]);
    expect(groupAt(d, 3, 3)).toBeGreaterThanOrEqual(0);
    expect(simulateBattle(OPEN_PLAINS, [setup, TEST_ARMY_RED], 1).tick).toBeGreaterThan(0);
  });

  it('lowering a count removes extra placed groups', () => {
    const d = newDraft();
    autoPlace(d, H);
    d.counts.archer = 1;
    d.counts.swordsman += 1;
    trimToCounts(d);
    expect(d.groups.filter((g) => g.type === 'archer').length).toBe(1);
  });
});
