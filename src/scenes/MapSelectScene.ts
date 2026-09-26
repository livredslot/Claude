/**
 * Map select: pick the battlefield before building your army.
 *   vs AI:  Menu -> Map select (also choose the AI difficulty) -> Army setup -> Battle
 *   online: Menu -> Online -> "Create room" -> Map select -> Online (waiting for friend) -> ...
 */
import Phaser from 'phaser';
import { TERRAIN, TERRAIN_TYPES } from '../config/gameConfig';
import { DIFFICULTIES, DIFFICULTY_NAMES, type Difficulty } from '../ai/armyBuilder';
import { MAPS } from '../data/maps';
import type { MapDef } from '../sim/types';
import { makeButton, type Button } from '../ui/button';
import { FONT, GAME_W } from '../ui/layout';
import { drawMapTiles, drawTile, terrainEffectText } from '../ui/terrainDraw';
import type { OnlineStartData } from './OnlineScene';
import type { SetupStartData } from './SetupScene';

export interface MapSelectStartData {
  /** 'ai': then army setup vs the computer. 'online': the host picks the map for the room. */
  mode: 'ai' | 'online';
}

const CARD_W = 392;
const CARD_H = 262;
const GAP = 20;
const PREVIEW_PX = 8; // tile size in the previews: 40 × 20 tiles = 320 × 160
const TOP = 84;

/** The last difficulty picked (kept while the game is open). */
let lastDifficulty: Difficulty = 'medium';

export class MapSelectScene extends Phaser.Scene {
  private mode: 'ai' | 'online' = 'ai';

  constructor() {
    super('MapSelect');
  }

  init(data: MapSelectStartData): void {
    this.mode = data?.mode ?? 'ai';
  }

  create(): void {
    this.add.graphics().fillStyle(0x0f172a, 1).fillRect(0, 0, GAME_W, 70);
    const title = this.mode === 'online' ? 'Choose the battlefield for your room' : 'Choose a battlefield';
    this.add
      .text(this.mode === 'ai' ? 520 : GAME_W / 2, 35, title, { fontFamily: FONT, fontSize: '28px', color: '#f8fafc', fontStyle: 'bold' })
      .setOrigin(0.5);
    makeButton(this, 16, 8, 150, 54, '◀ Back', () =>
      this.mode === 'online' ? this.scene.start('Online', { action: 'menu' } satisfies OnlineStartData) : this.scene.start('Menu'),
    );
    if (this.mode === 'ai') this.createDifficultyPicker();

    const x0 = (GAME_W - (3 * CARD_W + 2 * GAP)) / 2;
    const cards: (MapDef | 'random')[] = [...MAPS, 'random'];
    cards.forEach((card, i) => {
      const x = x0 + (i % 3) * (CARD_W + GAP);
      const y = TOP + Math.floor(i / 3) * (CARD_H + GAP);
      this.makeCard(x, y, card);
    });

    this.drawTerrainLegend(TOP + 2 * (CARD_H + GAP) + 4);
  }

  /** "AI: Easy | Medium | Hard" in the top bar. */
  private createDifficultyPicker(): void {
    this.add.text(812, 35, 'AI:', { fontFamily: FONT, fontSize: '22px', color: '#cbd5e1', fontStyle: 'bold' }).setOrigin(0, 0.5);
    const buttons: Button[] = DIFFICULTIES.map((d, i) =>
      makeButton(this, 856 + i * 136, 8, 128, 54, DIFFICULTY_NAMES[d], () => {
        lastDifficulty = d;
        buttons.forEach((b, j) => b.setSelected(DIFFICULTIES[j] === d));
      }),
    );
    buttons.forEach((b, j) => b.setSelected(DIFFICULTIES[j] === lastDifficulty));
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
      if (this.mode === 'online') {
        this.scene.start('Online', { action: 'host', mapId: map.id } satisfies OnlineStartData);
      } else {
        this.scene.start('Setup', { mode: 'ai', mapId: map.id, difficulty: lastDifficulty } satisfies SetupStartData);
      }
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
