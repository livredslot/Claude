/**
 * Run one battle headless (no graphics) and print the result.
 *   npm run sim                         -> seed 1 on Open Plains
 *   npm run sim -- 1234                 -> seed 1234
 *   npm run sim -- 1234 river-crossing  -> seed 1234 on another map
 * Run it twice with the same seed: the hash is always identical.
 */
import { simulateBattle } from '../src/sim';
import { MAPS, getMap } from '../src/data/maps';
import { TEST_ARMY_BLUE, TEST_ARMY_RED } from '../src/data/testArmies';

const seed = Number(process.argv[2] ?? 1) >>> 0;
const mapId = process.argv[3] ?? 'open-plains';
if (!MAPS.some((m) => m.id === mapId)) {
  console.log(`Unknown map "${mapId}". Maps: ${MAPS.map((m) => m.id).join(', ')}`);
  process.exit(1);
}
const map = getMap(mapId);
const start = performance.now();
const r = simulateBattle(map, [TEST_ARMY_BLUE, TEST_ARMY_RED], seed);
const ms = performance.now() - start;

const names = ['Blue', 'Red'];
console.log(`Seed ${seed} on ${map.name}`);
console.log(`Winner: ${r.winner === null ? 'Draw' : names[r.winner]} (${r.reason}) after ${(r.tick / 20).toFixed(1)} s`);
console.log(`Army value: Blue ${(r.values[0] / 1000).toFixed(2)}  Red ${(r.values[1] / 1000).toFixed(2)}`);
console.log(`Units lost: Blue ${r.unitsLost[0]}  Red ${r.unitsLost[1]}`);
console.log('Damage dealt by type:');
for (const t of Object.keys(r.damageByType[0])) {
  console.log(`  ${t.padEnd(10)} Blue ${String(r.damageByType[0][t as keyof typeof r.damageByType[0]]).padStart(5)}  Red ${String(r.damageByType[1][t as keyof typeof r.damageByType[1]]).padStart(5)}`);
}
console.log(`Final state hash: ${r.hash.toString(16).padStart(8, '0')}`);
console.log(`Simulated in ${ms.toFixed(1)} ms`);
