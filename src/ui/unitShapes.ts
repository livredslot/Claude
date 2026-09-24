/** Placeholder unit graphics shared by all scenes. */
import Phaser from 'phaser';
import { UNIT_TYPES, type UnitType } from '../config/gameConfig';
import { TEAM_COLORS } from './layout';

const V = (x: number, y: number) => new Phaser.Math.Vector2(x, y);

/** Draw a unit's placeholder shape centred on (x, y). */
export function drawUnitShape(
  g: Phaser.GameObjects.Graphics,
  type: UnitType,
  x: number,
  y: number,
  fill: number,
  stroke: number,
  alpha = 1,
): void {
  const r = 11;
  g.fillStyle(fill, alpha);
  g.lineStyle(2, stroke, alpha);
  let pts: Phaser.Math.Vector2[] = [];
  switch (type) {
    case 'swordsman': // square
      g.fillRect(x - r, y - r, r * 2, r * 2);
      g.strokeRect(x - r, y - r, r * 2, r * 2);
      return;
    case 'archer': // circle
      g.fillCircle(x, y, r);
      g.strokeCircle(x, y, r);
      return;
    case 'spearman': // triangle
      pts = [V(x, y - r - 2), V(x + r + 1, y + r), V(x - r - 1, y + r)];
      break;
    case 'horseman': {
      // diamond
      const d = r + 3;
      pts = [V(x, y - d), V(x + d, y), V(x, y + d), V(x - d, y)];
      break;
    }
    case 'medic': {
      // plus sign
      const a = 4;
      pts = [[-a, -r], [a, -r], [a, -a], [r, -a], [r, a], [a, a], [a, r], [-a, r], [-a, a], [-r, a], [-r, -a], [-a, -a]].map(
        ([px, py]) => V(x + px, y + py),
      );
      break;
    }
    case 'mage': {
      // five-pointed star
      for (let i = 0; i < 10; i++) {
        const ang = -Math.PI / 2 + (i * Math.PI) / 5;
        const rad = i % 2 === 0 ? r + 3 : r / 2;
        pts.push(V(x + Math.cos(ang) * rad, y + Math.sin(ang) * rad));
      }
      break;
    }
    case 'king': {
      // crown with a gold rim
      const w = r + 3;
      pts = [V(x - w, y + r), V(x + w, y + r), V(x + w, y - r), V(x + w / 2, y - 2), V(x, y - r - 3), V(x - w / 2, y - 2), V(x - w, y - r)];
      g.fillPoints(pts, true);
      g.lineStyle(3, 0xfacc15, alpha);
      g.strokePoints(pts, true);
      return;
    }
  }
  g.fillPoints(pts, true);
  g.strokePoints(pts, true);
}

/** Texture key for a unit sprite. */
export function unitTextureKey(type: UnitType, team: 0 | 1): string {
  return `unit-${type}-${team}`;
}

/**
 * Draw each unit shape once into a texture; sprites are much cheaper to draw
 * every frame than re-building polygons (important on phones).
 */
export function ensureUnitTextures(scene: Phaser.Scene): void {
  const size = 34;
  for (const type of UNIT_TYPES) {
    for (const team of [0, 1] as const) {
      const key = unitTextureKey(type, team);
      if (scene.textures.exists(key)) continue;
      const g = scene.make.graphics({}, false);
      drawUnitShape(g, type, size / 2, size / 2, TEAM_COLORS[team], 0xffffff);
      g.generateTexture(key, size, size);
      g.destroy();
    }
  }
}
