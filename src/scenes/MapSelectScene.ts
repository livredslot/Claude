/**
 * Map select: pick the battlefield before building your army.
 * Menu -> Map select -> Army setup -> Battle.
 */
import Phaser from 'phaser';
import { TERRAIN, TERRAIN_TYPES } from '../config/gameConfig';
import { MAPS } from '../data/maps';
import type { MapDef } from '../sim/types';
import { makeButton } from '../ui/button';
import { FONT, GAME_W } from '../ui/layout';
import { drawMapTiles, drawTile, terrainEffectText } from '../ui/terrainDraw';
import type { SetupStartData } from './SetupScene';

export interface MapSelectStartData {
  mode: 'ai' | 'pvp';
}

const CARD_W = 392;
const CARD_H = 262;
const GAP = 20;
const PREVIEW_PX = 8; // tile size in the previews: 40 × 20 tiles = 320 × 160
const TOP = 84;

export class MapSelectScene extends Phaser.Scene {
  private mode: 'ai' | 'pvp' = 'ai';

  constructor() {
    super('MapSelect');
  }

  init(data: MapSelectStartData): void {
    this.mode = data?.mode ?? 'ai';
  }

  create(): void {
    this.add.graphics().fillStyle(0x0f172a, 1).fillRect(0, 0, GAME_W, 70);
    this.add
      .text(GAME_W / 2, 35, 'Choose a battlefield', { fontFamily: FONT, fontSize: '28px', color: '#f8fafc', fontStyle: 'bold' })
      .setOrigin(0.5);
    makeButton(this, 16, 8, 150, 54, '◀ Menu', () => this.scene.start('Menu'));

    const x0 = (GAME_W - (3 * CARD_W + 2 * GAP)) / 2;
    const cards: (MapDef | 'random')[] = [...MAPS, 'random'];
    cards.forEach((card, i) => {
      const x = x0 + (i % 3) * (CARD_W + GAP);
      const y = TOP + Math.floor(i / 3) * (CARD_H + GAP);
      this.makeCard(x, y, card);
    });

    this.drawTerrainLegend(TOP + 2 * (CARD_H + GAP) + 4);
  }

  /** A tappable card with a mini map, the name and a short description. */
  private makeCard(x: number, y: number, card: MapDef | 'random'): void {
    const bg = this.add.rectangle(x, y, CARD_W, CARD_H, 0x1e293b).setOrigin(0).setStrokeStyle(2, 0x94a3b8);
    const px = x + (CARD_W - 40 * PREVIEW_PX) / 2;
    const py = y + 14;
    const g = this.add.graphics();
    if (card === 'random') {
      g.fillStyle(0x334155, 1).fillRect(px, py, 40 * PREVIEW_PX, 20 * PREVIEW_PX);
      this.add
        .text(px + 20 * PREVIEW_PX, py + 10 * PREVIEW_PX, '?', { fontFamily: FONT, fontSize: '96px', color: '#94a3b8', fontStyle: 'bold' })
        .setOrigin(0.5);
    } else {
      drawMapTiles(g, card, px, py, PREVIEW_PX);
    }
    g.lineStyle(2, 0x0f172a, 1).strokeRect(px, py, 40 * PREVIEW_PX, 20 * PREVIEW_PX);

    const name = card === 'random' ? 'Random' : card.name;
    const desc = card === 'random' ? 'A surprise battlefield: one of the maps above.' : (card.description ?? '');
    this.add.text(x + 18, py + 20 * PREVIEW_PX + 10, name, { fontFamily: FONT, fontSize: '22px', color: '#f8fafc', fontStyle: 'bold' });
    this.add.text(x + 18, py + 20 * PREVIEW_PX + 40, desc, {
      fontFamily: FONT,
      fontSize: '15px',
      color: '#cbd5e1',
      wordWrap: { width: CARD_W - 36 },
    });

    // The whole card is the button (fires on release, like makeButton: works for touch and mouse).
    bg.setInteractive({ useHandCursor: true });
    bg.on('pointerdown', () => bg.setStrokeStyle(4, 0xfacc15));
    bg.on('pointerout', () => bg.setStrokeStyle(2, 0x94a3b8));
    bg.on('pointerup', () => {
      bg.setStrokeStyle(2, 0x94a3b8);
      const map = card === 'random' ? MAPS[Math.floor(Math.random() * MAPS.length)] : card;
      const data: SetupStartData = { mode: this.mode, mapId: map.id };
      this.scene.start('Setup', data);
    });
  }

  /** What each kind of ground does (numbers come from the config). */
  private drawTerrainLegend(y: number): void {
    const g = this.add.graphics();
    const colW = (GAME_W - 48) / 2;
    TERRAIN_TYPES.forEach((type, i) => {
      const x = 24 + (i % 2) * colW;
      const yy = y + Math.floor(i / 2) * 34;
      drawTile(g, type, x, yy, 24, true);
      g.lineStyle(1, 0x0f172a, 1).strokeRect(x, yy, 24, 24);
      this.add.text(x + 34, yy + 12, `${TERRAIN[type].name}:`, { fontFamily: FONT, fontSize: '17px', color: '#f8fafc', fontStyle: 'bold' }).setOrigin(0, 0.5);
      this.add
        .text(x + 170, yy + 12, terrainEffectText(type), { fontFamily: FONT, fontSize: '16px', color: '#cbd5e1' })
        .setOrigin(0, 0.5);
    });
    this.add.text(24, y + 76, 'Units find their own way around water and mountains. A unit gets the effects of the tile it stands on.', {
      fontFamily: FONT,
      fontSize: '15px',
      color: '#94a3b8',
    });
  }
}
