import Phaser from 'phaser';
import { SETUP_RULES } from '../config/gameConfig';
import { makeButton } from '../ui/button';
import { FONT, GAME_W } from '../ui/layout';
import type { SetupStartData } from './SetupScene';

export class MenuScene extends Phaser.Scene {
  constructor() {
    super('Menu');
  }

  create(): void {
    this.add
      .text(GAME_W / 2, 110, 'Mystical Armies', { fontFamily: FONT, fontSize: '64px', color: '#e9d5ff', fontStyle: 'bold' })
      .setOrigin(0.5);
    this.add
      .text(GAME_W / 2, 175, 'Build your army. Place your formation. Protect your King.', {
        fontFamily: FONT,
        fontSize: '22px',
        color: '#cbd5e1',
      })
      .setOrigin(0.5);

    const w = 460;
    const x = GAME_W / 2 - w / 2;
    const ai: SetupStartData = { mode: 'ai' };
    const pvp: SetupStartData = { mode: 'pvp' };
    makeButton(this, x, 250, w, 76, 'Play vs AI\n(no time limit)', () => this.scene.start('Setup', ai), { fontSize: 24 });
    makeButton(this, x, 346, w, 76, `PvP  (${SETUP_RULES.pvpTimeLimit} s to build your army)`, () => this.scene.start('Setup', pvp), {
      fontSize: 24,
    });
    makeButton(this, x, 442, w, 76, 'Watch a demo battle', () => this.scene.start('Battle', {}), { fontSize: 24 });

    this.add
      .text(
        GAME_W / 2,
        600,
        'For now the opponent is a fixed practice army (Red).\nThe real AI arrives in Phase 5 and online PvP in Phase 8:\nthe PvP button already lets you try the setup timer.',
        { fontFamily: FONT, fontSize: '18px', color: '#94a3b8', align: 'center', lineSpacing: 6 },
      )
      .setOrigin(0.5);
  }
}
