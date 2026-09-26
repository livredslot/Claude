import Phaser from 'phaser';
import { BattleScene } from './scenes/BattleScene';
import { MapSelectScene } from './scenes/MapSelectScene';
import { MenuScene } from './scenes/MenuScene';
import { SetupScene } from './scenes/SetupScene';
import { GAME_H, GAME_W } from './ui/layout';

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#11151c',
  scale: {
    // Fixed logical size, scaled to fit any screen (desktop or phone) keeping the aspect ratio.
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: GAME_W,
    height: GAME_H,
  },
  input: { activePointers: 2 },
  // The first scene in the list starts automatically.
  scene: [MenuScene, MapSelectScene, SetupScene, BattleScene],
});
