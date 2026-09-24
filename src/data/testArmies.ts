/**
 * Hard-coded armies used in Phase 1 to watch a battle and to run the
 * determinism test. (Phase 2 replaces these with the deployment screen.)
 */
import type { ArmySetup, Stance, UnitPlacement, UnitType } from '../sim/types';

function column(type: UnitType, tx: number, rows: number[], stance?: Stance): UnitPlacement[] {
  return rows.map((ty) => ({ type, tx, ty, stance }));
}

/** Blue army, left side (columns 0–5; column 5 is the front). */
export const TEST_ARMY_BLUE: ArmySetup = {
  units: [
    ...column('swordsman', 5, [4, 5, 6, 12, 13, 14]),
    ...column('spearman', 5, [7, 8, 9, 10, 11]),
    ...column('horseman', 4, [2, 3, 16], 'flank'),
    ...column('archer', 3, [6, 7, 8, 9, 10, 11]),
    ...column('medic', 2, [7, 9, 11]),
    ...column('mage', 1, [8, 10]),
  ],
};

/** Red army, right side (columns 34–39; column 34 is the front). */
export const TEST_ARMY_RED: ArmySetup = {
  units: [
    ...column('swordsman', 34, [5, 6, 7, 8, 9, 10, 11]),
    ...column('spearman', 34, [4, 12, 13, 14]),
    ...column('horseman', 35, [2, 17, 18]),
    ...column('archer', 36, [6, 7, 8, 9, 10, 11]),
    ...column('medic', 37, [7, 9, 11]),
    ...column('mage', 38, [8, 11]),
  ],
};
