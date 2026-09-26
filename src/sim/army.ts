import { ARMY_RULES, UNIT_TYPES, UNITS } from '../config/gameConfig';
import type { ArmySetup, MapDef, Team, UnitPlacement } from './types';

/** Total units in an army: all groups of soldiers plus the King. */
export function armySize(): number {
  return ARMY_RULES.groups * ARMY_RULES.groupSize + 1;
}

/** Tile columns [min, max] (inclusive) a team may deploy in. */
export function deployColumns(team: Team, map: MapDef): [number, number] {
  const n = ARMY_RULES.deployColumns;
  return team === 0 ? [0, n - 1] : [map.width - n, map.width - 1];
}

/** Returns a list of human-readable problems; an empty list means the army is valid. */
export function validateArmy(setup: ArmySetup, team: Team, map: MapDef): string[] {
  const errors: string[] = [];
  const units = setup.units;
  const size = armySize();
  if (units.length !== size) {
    errors.push(`Army must have exactly ${size} units (has ${units.length}).`);
  }
  for (const type of UNIT_TYPES) {
    const count = units.filter((u) => u.type === type).length;
    if (type === 'king') {
      if (count !== 1) errors.push(`Army needs exactly 1 King (has ${count}).`);
      continue;
    }
    const max = ARMY_RULES.maxGroups[type] * ARMY_RULES.groupSize;
    if (count > max) errors.push(`Too many ${UNITS[type].name}s: ${count} (max ${max}).`);
    if (count % ARMY_RULES.groupSize !== 0) {
      errors.push(`${UNITS[type].name}s must come in groups of ${ARMY_RULES.groupSize} (has ${count}).`);
    }
  }
  const [minX, maxX] = deployColumns(team, map);
  const used = new Set<string>();
  for (const u of units) {
    if (!UNITS[u.type]) errors.push(`Unknown unit type: ${u.type}`);
    if (!Number.isInteger(u.tx) || !Number.isInteger(u.ty)) {
      errors.push(`Unit position must be whole tiles: (${u.tx}, ${u.ty}).`);
    }
    if (u.tx < minX || u.tx > maxX || u.ty < 0 || u.ty >= map.height) {
      errors.push(`Unit at (${u.tx}, ${u.ty}) is outside the deployment zone.`);
    }
    const key = `${u.tx},${u.ty}`;
    if (used.has(key)) errors.push(`Two units on the same tile (${u.tx}, ${u.ty}).`);
    used.add(key);
  }
  return errors;
}

/** Mirror a setup to the other side of the map (left ↔ right). */
export function mirrorSetup(setup: ArmySetup, map: MapDef): ArmySetup {
  return {
    units: setup.units.map((u): UnitPlacement => ({ ...u, tx: map.width - 1 - u.tx })),
  };
}
