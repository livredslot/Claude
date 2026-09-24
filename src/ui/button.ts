import Phaser from 'phaser';
import { FONT } from './layout';

export interface Button {
  container: Phaser.GameObjects.Container;
  setLabel(text: string): void;
}

/**
 * A big, finger-friendly button. Fires on pointer *up* inside the button,
 * so it works the same with mouse and touch.
 */
export function makeButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  onClick: () => void,
): Button {
  const bg = scene.add.rectangle(0, 0, w, h, 0x334155).setStrokeStyle(2, 0x94a3b8).setOrigin(0);
  const text = scene.add
    .text(w / 2, h / 2, label, { fontFamily: FONT, fontSize: '20px', color: '#f1f5f9', fontStyle: 'bold' })
    .setOrigin(0.5);
  const container = scene.add.container(x, y, [bg, text]);
  container.setSize(w, h);
  bg.setInteractive({ useHandCursor: true });
  bg.on('pointerdown', () => bg.setFillStyle(0x475569));
  bg.on('pointerout', () => bg.setFillStyle(0x334155));
  bg.on('pointerup', () => {
    bg.setFillStyle(0x334155);
    onClick();
  });
  return { container, setLabel: (t) => text.setText(t) };
}
