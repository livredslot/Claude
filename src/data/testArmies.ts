/**
 * Hard-coded armies used by the tests and the demo battle. Red is also the
 * opponent on the army setup screen until the AI arrives in Phase 5.
 * Each army: 10 groups of 5 (vertical lines of 5 squares) + 1 King = 51 units.
 */
import type { ArmySetup, Stance, UnitPlacement, UnitType } from '../sim/types';

/** A group of 5 in column `tx`, centred on row `centreRow`. */
function group(type: UnitType, tx: number, centreRow: number, stance?: Stance): UnitPlacement[] {
  return Array.from({ length: 5 }, (_, i) => ({ type, tx, ty: centreRow - 2 + i, stance }));
}

/** Blue army, left side (columns 0–5; column 5 is the front). */
export const TEST_ARMY_BLUE: ArmySetup = {
  units: [
    ...group('swordsman', 5, 5),
    ...group('spearman', 5, 10),
    ...group('swordsman', 5, 15),
    ...group('spearman', 4, 10),
    ...group('horseman', 4, 2),
    ...group('horseman', 4, 17),
    ...group('archer', 3, 7),
    ...group('archer', 3, 12),
    ...group('medic', 2, 10),
    ...group('mage', 1, 10),
    { type: 'king', tx: 0, ty: 10 },
  ],
};

/** Red army, right side (columns 34–39; column 34 is the front). */
export const TEST_ARMY_RED: ArmySetup = {
  units: [
    ...group('spearman', 34, 5),
    ...group('swordsman', 34, 10),
    ...group('spearman', 34, 15),
    ...group('swordsman', 35, 10),
    ...group('horseman', 35, 2),
    ...group('horseman', 35, 17),
    ...group('archer', 36, 7),
    ...group('archer', 36, 12),
    ...group('medic', 37, 10),
    ...group('mage', 38, 10),
    { type: 'king', tx: 39, ty: 10 },
  ],
};
