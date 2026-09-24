import Phaser from 'phaser';
import { FONT } from './layout';

export interface Button {
  container: Phaser.GameObjects.Container;
  setLabel(text: string): void;
  /** Disabled buttons are greyed out and ignore taps. */
  setEnabled(enabled: boolean): void;
  /** Highlight (e.g. the currently chosen option). */
  setSelected(selected: boolean): void;
}

export interface ButtonOptions {
  fontSize?: number;
  fill?: number;
  /** Left-align the label starting at this x (leaves room for an icon). Default: centred. */
  textLeft?: number;
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
  opts: ButtonOptions = {},
): Button {
  const baseFill = opts.fill ?? 0x334155;
  const pressedFill = 0x475569;
  let enabled = true;
  let selected = false;
  const bg = scene.add.rectangle(0, 0, w, h, baseFill).setStrokeStyle(2, 0x94a3b8).setOrigin(0);
  const text = scene.add
    .text(w / 2, h / 2, label, {
      fontFamily: FONT,
      fontSize: `${opts.fontSize ?? 20}px`,
      color: '#f1f5f9',
      fontStyle: 'bold',
      align: 'center',
    })
    .setOrigin(0.5);
  if (opts.textLeft !== undefined) text.setPosition(opts.textLeft, h / 2).setOrigin(0, 0.5);
  const container = scene.add.container(x, y, [bg, text]);
  container.setSize(w, h);
  const restyle = () => {
    bg.setFillStyle(baseFill);
    bg.setStrokeStyle(selected ? 4 : 2, selected ? 0xfacc15 : 0x94a3b8);
    container.setAlpha(enabled ? 1 : 0.4);
  };
  bg.setInteractive({ useHandCursor: true });
  bg.on('pointerdown', () => enabled && bg.setFillStyle(pressedFill));
  bg.on('pointerout', restyle);
  bg.on('pointerup', () => {
    restyle();
    if (enabled) onClick();
  });
  return {
    container,
    setLabel: (t) => text.setText(t),
    setEnabled: (e) => {
      enabled = e;
      restyle();
    },
    setSelected: (s) => {
      selected = s;
      restyle();
    },
  };
}
