import Phaser from 'phaser';
import { SETUP_RULES } from '../config/gameConfig';
import { normaliseCode, setSession } from '../net/session';
import { makeButton } from '../ui/button';
import { FONT, GAME_W } from '../ui/layout';
import type { MapSelectStartData } from './MapSelectScene';
import type { OnlineStartData } from './OnlineScene';

/** A room link (…?room=K7F2) opens the game straight into joining that room, once. */
let roomLinkHandled = false;

export class MenuScene extends Phaser.Scene {
  constructor() {
    super('Menu');
  }

  create(): void {
    setSession(null); // back at the menu: leave any online game

    if (!roomLinkHandled) {
      roomLinkHandled = true;
      const code = normaliseCode(new URLSearchParams(window.location.search).get('room') ?? '');
      if (code) {
        this.scene.start('Online', { action: 'join', code } satisfies OnlineStartData);
        return;
      }
    }

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
    const ai: MapSelectStartData = { mode: 'ai' };
    makeButton(this, x, 250, w, 76, 'Play vs AI\n(Easy · Medium · Hard)', () => this.scene.start('MapSelect', ai), { fontSize: 24 });
    makeButton(this, x, 346, w, 76, `Play online with a friend\n(${SETUP_RULES.pvpTimeLimit} s to build your army)`, () =>
      this.scene.start('Online', { action: 'menu' } satisfies OnlineStartData), {
      fontSize: 24,
    });
    makeButton(this, x, 442, w, 76, 'Watch a demo battle\n(random map)', () => this.scene.start('Battle', {}), { fontSize: 24 });

    this.add
      .text(
        GAME_W / 2,
        600,
        'Online: one player creates a room and sends the code or link;\nthe other joins it. Both players need an internet connection.',
        { fontFamily: FONT, fontSize: '18px', color: '#94a3b8', align: 'center', lineSpacing: 6 },
      )
      .setOrigin(0.5);
  }
}
