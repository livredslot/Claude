/** Drawing terrain tiles (placeholder colours) and describing what each terrain does. */
import Phaser from 'phaser';
import { TERRAIN, type TerrainType } from '../config/gameConfig';
import { TILE_TERRAIN } from '../sim';
import type { MapDef, TileChar } from '../sim/types';

/** Two shades per terrain for a subtle checkerboard. */
export const TERRAIN_COLORS: Record<TerrainType, [number, number]> = {
  flat: [0x4a7c3a, 0x467637],
  mountain: [0x8a7a64, 0x84745e],
  deep: [0x1f4f8c, 0x1d4a85],
  shallow: [0x5ba3cf, 0x579dc9],
};

export function terrainAt(map: MapDef, tx: number, ty: number): TerrainType {
  return TILE_TERRAIN[map.rows[ty][tx] as TileChar];
}

/** Draw one tile at (x, y) with size `px`. Small details (peaks, waves) only when px >= 16. */
export function drawTile(
  g: Phaser.GameObjects.Graphics,
  type: TerrainType,
  x: number,
  y: number,
  px: number,
  checker: boolean,
  alpha = 1,
): void {
  g.fillStyle(TERRAIN_COLORS[type][checker ? 0 : 1], alpha).fillRect(x, y, px, px);
  if (px < 16) return;
  if (type === 'mountain') {
    // A little peak with a snowy tip.
    g.fillStyle(0x6b5d4a, alpha).fillTriangle(x + px * 0.15, y + px * 0.8, x + px * 0.5, y + px * 0.2, x + px * 0.85, y + px * 0.8);
    g.fillStyle(0xe7e5e4, alpha).fillTriangle(x + px * 0.4, y + px * 0.36, x + px * 0.5, y + px * 0.2, x + px * 0.6, y + px * 0.36);
  } else if (type === 'deep' || type === 'shallow') {
    // Two small waves.
    g.lineStyle(2, type === 'deep' ? 0x3b6fb0 : 0x8cc6e6, alpha);
    for (const [wx, wy] of [
      [0.2, 0.35],
      [0.5, 0.7],
    ]) {
      g.lineBetween(x + px * wx, y + px * wy, x + px * (wx + 0.15), y + px * (wy - 0.08));
      g.lineBetween(x + px * (wx + 0.15), y + px * (wy - 0.08), x + px * (wx + 0.3), y + px * wy);
    }
  }
}

/** Draw a whole map (or its first `cols` columns) with its top-left corner at (x0, y0). */
export function drawMapTiles(
  g: Phaser.GameObjects.Graphics,
  map: MapDef,
  x0: number,
  y0: number,
  px: number,
  cols = map.width,
): void {
  for (let ty = 0; ty < map.height; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      drawTile(g, terrainAt(map, tx, ty), x0 + tx * px, y0 + ty * px, px, (tx + ty) % 2 === 0);
    }
  }
}

/** Player-facing one-liner of a terrain's effects, built from the config numbers. */
export function terrainEffectText(type: TerrainType): string {
  const t = TERRAIN[type];
  if (!t.walkable) return "Can't be crossed. Arrows and spells fly over it.";
  const parts: string[] = [];
  if (t.speedPct !== 100) parts.push(`${t.speedPct}% speed`);
  if (t.damagePct !== 100) parts.push(`${t.damagePct > 100 ? '+' : '−'}${Math.abs(t.damagePct - 100)}% damage`);
  if (t.rangedRangeBonus) parts.push(`Archers/Mage +${t.rangedRangeBonus} range`);
  return parts.length ? parts.join(' · ') : 'Normal ground.';
}
