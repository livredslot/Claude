import { describe, expect, it } from 'vitest';
import {
  autoComplete,
  autoPlace,
  allPlaced,
  canIncrease,
  draftToSetup,
  newDraft,
  totalCount,
  trimToCounts,
  tileKey,
} from '../src/game/armyDraft';
import { OPEN_PLAINS } from '../src/data/maps';
import { validateArmy, simulateBattle } from '../src/sim';
import { TEST_ARMY_RED } from '../src/data/testArmies';
import { UNIT_TYPES } from '../src/config/gameConfig';

const H = OPEN_PLAINS.height;

describe('army draft', () => {
  it('default counts add up to 25 with one King', () => {
    const d = newDraft();
    expect(totalCount(d.counts)).toBe(25);
    expect(d.counts.king).toBe(1);
  });

  it('auto-place gives a valid army on either side', () => {
    const d = newDraft();
    autoPlace(d, H);
    expect(allPlaced(d)).toBe(true);
    expect(validateArmy(draftToSetup(d, 0, OPEN_PLAINS.width), 0, OPEN_PLAINS)).toEqual([]);
    expect(validateArmy(draftToSetup(d, 1, OPEN_PLAINS.width), 1, OPEN_PLAINS)).toEqual([]);
    // King sits at the back, centre.
    expect(d.placed.get(tileKey(0, 10))?.type).toBe('king');
  });

  it('auto-place handles extreme mixes (24 of one type)', () => {
    for (const type of ['swordsman', 'archer', 'horseman', 'spearman'] as const) {
      const d = newDraft();
      for (const t of UNIT_TYPES) d.counts[t] = t === 'king' ? 1 : 0;
      d.counts[type] = 24;
      autoPlace(d, H);
      expect(validateArmy(draftToSetup(d, 0, OPEN_PLAINS.width), 0, OPEN_PLAINS)).toEqual([]);
    }
  });

  it('auto-place keeps units the player already placed', () => {
    const d = newDraft();
    d.placed.set(tileKey(5, 0), { type: 'mage', stance: 'hold' });
    autoPlace(d, H);
    expect(d.placed.get(tileKey(5, 0))).toEqual({ type: 'mage', stance: 'hold' });
    expect(allPlaced(d)).toBe(true);
  });

  it('caps stop the counts from going over the limits', () => {
    const d = newDraft();
    for (const t of UNIT_TYPES) d.counts[t] = t === 'king' ? 1 : 0;
    d.counts.medic = 5;
    expect(canIncrease(d.counts, 'medic')).toBe(false);
    expect(canIncrease(d.counts, 'king')).toBe(false);
    expect(canIncrease(d.counts, 'archer')).toBe(true);
  });

  it('time-out auto-complete turns an empty/partial setup into a valid army', () => {
    const d = newDraft();
    for (const t of UNIT_TYPES) d.counts[t] = 0; // even the King missing
    d.counts.archer = 3;
    d.placed.set(tileKey(3, 3), { type: 'archer', stance: 'advance' });
    autoComplete(d, H);
    const setup = draftToSetup(d, 0, OPEN_PLAINS.width);
    expect(validateArmy(setup, 0, OPEN_PLAINS)).toEqual([]);
    expect(d.placed.get(tileKey(3, 3))?.type).toBe('archer');
    // And it can actually fight.
    expect(simulateBattle(OPEN_PLAINS, [setup, TEST_ARMY_RED], 1).tick).toBeGreaterThan(0);
  });

  it('lowering a count removes extra placed units', () => {
    const d = newDraft();
    autoPlace(d, H);
    d.counts.archer = 2;
    d.counts.swordsman += 4;
    trimToCounts(d);
    expect([...d.placed.values()].filter((u) => u.type === 'archer').length).toBe(2);
  });
});
