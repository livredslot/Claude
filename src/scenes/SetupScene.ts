/**
 * Army setup screen, in two steps:
 *   1. Counts: choose how many of each unit (+/−), exactly 25 including 1 King.
 *   2. Place: tap/drag units onto your deployment zone, set stances.
 * In PvP there is a time limit; when it runs out the army is auto-completed and locked in.
 */
import Phaser from 'phaser';
import { ARMY_RULES, SETUP_RULES, UNIT_TYPES, UNITS, type UnitType } from '../config/gameConfig';
import { OPEN_PLAINS } from '../data/maps';
import { TEST_ARMY_RED } from '../data/testArmies';
import {
  allPlaced,
  autoComplete,
  autoPlace,
  canDecrease,
  canIncrease,
  countLimits,
  draftToSetup,
  loadPreset,
  newDraft,
  parseKey,
  remainingToPlace,
  savePreset,
  tileKey,
  totalCount,
  trimToCounts,
  ZONE_COLS,
  type ArmyDraft,
} from '../game/armyDraft';
import { validateArmy } from '../sim';
import type { Stance } from '../sim/types';
import { makeButton, type Button } from '../ui/button';
import { FONT, GAME_H, GAME_W, TEAM_COLORS } from '../ui/layout';
import { STANCE_INFO, UNIT_BLURB, statLine } from '../ui/unitInfo';
import { drawUnitShape, ensureUnitTextures, unitTextureKey } from '../ui/unitShapes';
import type { BattleStartData } from './BattleScene';

export interface SetupStartData {
  mode: 'ai' | 'pvp';
  /** Keep the previous army when coming back from a battle. */
  draft?: ArmyDraft;
}

const MAP = OPEN_PLAINS;
const HEADER_H = 70;

// Placement grid (step 2).
const CELL = 34;
const GRID_X = 24;
const GRID_Y = HEADER_H + 6;
/** Extra, non-placeable columns shown in front of the zone for context. */
const PREVIEW_COLS = 3;

const PANEL_X = GRID_X + (ZONE_COLS + PREVIEW_COLS) * CELL + 36;

export class SetupScene extends Phaser.Scene {
  private mode: 'ai' | 'pvp' = 'ai';
  private draft!: ArmyDraft;
  private step: 'counts' | 'place' = 'counts';
  private deadline = 0;
  private finished = false;

  /** Everything belonging to the current step; destroyed when switching steps. */
  private stepObjects: Phaser.GameObjects.GameObject[] = [];
  private refreshers: (() => void)[] = [];

  private timerText!: Phaser.GameObjects.Text;
  private titleText!: Phaser.GameObjects.Text;
  private toastText!: Phaser.GameObjects.Text;

  // Step 2 state
  private selectedType: UnitType | null = null;
  private selectedKey: string | null = null;
  private dragKey: string | null = null;
  private dragMoved = false;
  private painting = false;
  private gridGfx!: Phaser.GameObjects.Graphics;
  private unitLayer!: Phaser.GameObjects.Container;

  constructor() {
    super('Setup');
  }

  init(data: SetupStartData): void {
    this.mode = data?.mode ?? 'ai';
    this.draft = data?.draft ?? newDraft();
    this.step = 'counts';
    this.finished = false;
    this.stepObjects = [];
    this.refreshers = [];
    this.selectedType = null;
    this.selectedKey = null;
    const limit = this.mode === 'pvp' ? SETUP_RULES.pvpTimeLimit : SETUP_RULES.aiTimeLimit;
    this.deadline = limit > 0 ? Date.now() + limit * 1000 : 0;
  }

  create(): void {
    ensureUnitTextures(this);
    const g = this.add.graphics();
    g.fillStyle(0x0f172a, 1).fillRect(0, 0, GAME_W, HEADER_H);

    this.titleText = this.add.text(24, HEADER_H / 2, '', {
      fontFamily: FONT,
      fontSize: '26px',
      color: '#f8fafc',
      fontStyle: 'bold',
    });
    this.titleText.setOrigin(0, 0.5);
    this.timerText = this.add
      .text(GAME_W - 24, HEADER_H / 2, '', { fontFamily: FONT, fontSize: '28px', color: '#fde047', fontStyle: 'bold' })
      .setOrigin(1, 0.5);
    this.toastText = this.add
      .text(GAME_W / 2, GAME_H - 22, '', {
        fontFamily: FONT,
        fontSize: '18px',
        color: '#f8fafc',
        backgroundColor: '#1e293bee',
        padding: { x: 12, y: 6 },
      })
      .setOrigin(0.5)
      .setDepth(50)
      .setVisible(false);

    this.input.on('pointerdown', this.onPointerDown, this);
    this.input.on('pointermove', this.onPointerMove, this);
    this.input.on('pointerup', this.onPointerUp, this);

    this.showCounts();
  }

  update(): void {
    if (!this.deadline || this.finished) {
      this.timerText.setText(this.mode === 'ai' ? 'No time limit' : '');
      return;
    }
    const left = Math.max(0, Math.ceil((this.deadline - Date.now()) / 1000));
    this.timerText.setText(`⏱ ${left} s`);
    this.timerText.setColor(left <= 10 ? '#f87171' : '#fde047');
    if (left <= 0) {
      autoComplete(this.draft, MAP.height);
      this.toast("Time's up! Missing units were added and placed automatically.");
      this.startBattle();
    }
  }

  private toastTimer?: Phaser.Time.TimerEvent;

  private toast(msg: string): void {
    this.toastText.setText(msg).setVisible(true);
    this.toastTimer?.remove();
    this.toastTimer = this.time.delayedCall(2500, () => this.toastText.setVisible(false));
  }

  private clearStep(): void {
    for (const o of this.stepObjects) o.destroy();
    this.stepObjects = [];
    this.refreshers = [];
  }

  private keep<T extends Phaser.GameObjects.GameObject>(o: T): T {
    this.stepObjects.push(o);
    return o;
  }

  private button(x: number, y: number, w: number, h: number, label: string, onClick: () => void, fontSize = 20): Button {
    const b = makeButton(this, x, y, w, h, label, onClick, { fontSize });
    this.keep(b.container);
    return b;
  }

  private refresh(): void {
    for (const r of this.refreshers) r();
  }

  // ======================================================================
  // Step 1: counts
  // ======================================================================

  private showCounts(): void {
    this.clearStep();
    this.step = 'counts';
    this.titleText.setText('Step 1 of 2 · How many of each unit?');

    const rowH = 78;
    const top = HEADER_H + 14;
    const g = this.keep(this.add.graphics());

    UNIT_TYPES.forEach((type, i) => {
      const y = top + i * rowH;
      g.fillStyle(i % 2 === 0 ? 0x1e293b : 0x172033, 1).fillRect(24, y, GAME_W - 48, rowH - 6);
      drawUnitShape(g, type, 64, y + rowH / 2 - 3, TEAM_COLORS[0], 0xffffff);

      this.keep(
        this.add.text(100, y + 10, UNITS[type].name, { fontFamily: FONT, fontSize: '22px', color: '#f8fafc', fontStyle: 'bold' }),
      );
      this.keep(this.add.text(250, y + 14, statLine(type), { fontFamily: FONT, fontSize: '16px', color: '#94a3b8' }));
      this.keep(
        this.add.text(100, y + 42, UNIT_BLURB[type], {
          fontFamily: FONT,
          fontSize: '16px',
          color: type === 'king' ? '#fde047' : '#cbd5e1',
        }),
      );

      const [min, max] = countLimits(type);
      const capText = min === max ? `exactly ${min}` : max < ARMY_RULES.size ? `max ${max}` : '';
      this.keep(
        this.add.text(GAME_W - 330, y + rowH / 2 - 3, capText, { fontFamily: FONT, fontSize: '16px', color: '#94a3b8' }).setOrigin(1, 0.5),
      );

      const minus = this.button(GAME_W - 310, y + 6, 72, rowH - 18, '−', () => this.changeCount(type, -1), 34);
      const countText = this.keep(
        this.add
          .text(GAME_W - 190, y + rowH / 2 - 3, '', { fontFamily: FONT, fontSize: '32px', color: '#f8fafc', fontStyle: 'bold' })
          .setOrigin(0.5),
      );
      const plus = this.button(GAME_W - 144, y + 6, 72, rowH - 18, '+', () => this.changeCount(type, +1), 34);
      this.refreshers.push(() => {
        countText.setText(String(this.draft.counts[type]));
        minus.setEnabled(canDecrease(this.draft.counts, type));
        plus.setEnabled(canIncrease(this.draft.counts, type));
      });
    });

    const by = top + UNIT_TYPES.length * rowH + 8;
    const totalText = this.keep(
      this.add.text(24, by + 30, '', { fontFamily: FONT, fontSize: '28px', color: '#f8fafc', fontStyle: 'bold' }).setOrigin(0, 0.5),
    );
    this.button(470, by, 170, 60, 'Menu', () => this.scene.start('Menu'));
    this.button(656, by, 250, 60, 'Suggested mix', () => {
      this.draft.counts = { ...SETUP_RULES.defaultCounts };
      this.refresh();
    });
    const next = this.button(GAME_W - 24 - 330, by, 330, 60, 'Next: place units  ▶', () => this.showPlace(), 22);
    this.refreshers.push(() => {
      const total = totalCount(this.draft.counts);
      totalText.setText(`Total ${total} / ${ARMY_RULES.size}`);
      totalText.setColor(total === ARMY_RULES.size ? '#86efac' : '#fca5a5');
      next.setEnabled(total === ARMY_RULES.size);
    });
    this.refresh();
  }

  private changeCount(type: UnitType, delta: number): void {
    const c = this.draft.counts;
    if (delta > 0 && canIncrease(c, type)) c[type]++;
    if (delta < 0 && canDecrease(c, type)) c[type]--;
    this.refresh();
  }

  // ======================================================================
  // Step 2: placement
  // ======================================================================

  private showPlace(): void {
    this.clearStep();
    this.step = 'place';
    trimToCounts(this.draft);
    this.titleText.setText('Step 2 of 2 · Place your formation');
    this.selectedKey = null;
    this.selectedType = this.nextTypeToPlace(null);

    this.gridGfx = this.keep(this.add.graphics());
    this.unitLayer = this.keep(this.add.container(0, 0));

    // --- Palette ---
    const px = PANEL_X;
    let y = HEADER_H + 10;
    this.keep(this.add.text(px, y, 'Pick a unit, then tap or drag on the blue zone:', { fontFamily: FONT, fontSize: '17px', color: '#cbd5e1' }));
    y += 30;
    const pw = 212;
    const ph = 58;
    UNIT_TYPES.forEach((type, i) => {
      const bx = px + (i % 4) * (pw + 10);
      const byy = y + Math.floor(i / 4) * (ph + 10);
      const b = makeButton(this, bx, byy, pw, ph, '', () => {
        this.selectedType = type;
        this.selectedKey = null;
        this.refresh();
      }, { fontSize: 16, textLeft: 40 });
      this.keep(b.container);
      const icon = this.add.image(22, ph / 2, unitTextureKey(type, 0)).setScale(0.8);
      b.container.add(icon);
      this.refreshers.push(() => {
        const left = remainingToPlace(this.draft, type);
        b.setLabel(`${UNITS[type].name} · ${left} left`);
        b.setSelected(this.selectedType === type);
        b.setEnabled(left > 0 || this.selectedType === type);
      });
    });
    y += 2 * (ph + 10) + 10;

    // --- Selected unit: stance / remove ---
    const sg = this.keep(this.add.graphics());
    sg.fillStyle(0x1e293b, 1).fillRect(px, y, GAME_W - px - 24, 200);
    const selTitle = this.keep(this.add.text(px + 14, y + 12, '', { fontFamily: FONT, fontSize: '19px', color: '#f8fafc', fontStyle: 'bold' }));
    const selHelp = this.keep(
      this.add.text(px + 14, y + 44, '', { fontFamily: FONT, fontSize: '16px', color: '#cbd5e1', wordWrap: { width: GAME_W - px - 60 } }),
    );
    const stanceButtons = (['advance', 'hold', 'flank'] as Stance[]).map((st, i) =>
      this.button(px + 14 + i * 186, y + 120, 176, 62, STANCE_INFO[st].name, () => this.setStance(st)),
    );
    const removeBtn = this.button(px + 14 + 3 * 186, y + 120, 176, 62, 'Remove', () => this.removeSelected());
    this.refreshers.push(() => {
      const sel = this.selectedKey ? this.draft.placed.get(this.selectedKey) : undefined;
      const isKing = sel?.type === 'king';
      if (!sel) {
        selTitle.setText('No unit selected');
        selHelp.setText('Tap a placed unit to choose its stance or remove it. Drag a placed unit to move it.');
      } else {
        const [tx, ty] = parseKey(this.selectedKey!);
        selTitle.setText(`${UNITS[sel.type].name} (column ${tx + 1}, row ${ty + 1})`);
        selHelp.setText(
          isKing
            ? 'The King follows a few tiles behind your army and fights enemies that come close.'
            : `${STANCE_INFO[sel.stance].name}: ${STANCE_INFO[sel.stance].text}`,
        );
      }
      stanceButtons.forEach((b, i) => {
        const st = (['advance', 'hold', 'flank'] as Stance[])[i];
        b.container.setVisible(!!sel && !isKing);
        b.setSelected(sel?.stance === st);
      });
      removeBtn.container.setVisible(!!sel);
    });
    y += 214;

    // --- Status + actions ---
    const status = this.keep(this.add.text(px, y + 6, '', { fontFamily: FONT, fontSize: '24px', color: '#f8fafc', fontStyle: 'bold' }));
    y += 50;
    const aw = 170;
    const gap = 12;
    this.button(px, y, aw, 58, '◀ Counts', () => this.showCounts());
    this.button(px + (aw + gap), y, aw, 58, 'Clear', () => {
      this.draft.placed.clear();
      this.selectedKey = null;
      this.selectedType = this.nextTypeToPlace(null);
      this.refresh();
    });
    this.button(px + 2 * (aw + gap), y, aw, 58, 'Auto-place', () => {
      autoPlace(this.draft, MAP.height);
      this.selectedType = null;
      this.refresh();
    });
    this.button(px + 3 * (aw + gap), y, aw, 58, 'Save', () =>
      this.toast(savePreset(this.draft) ? 'Formation saved in this browser.' : 'Could not save (browser storage blocked).'),
    );
    y += 58 + gap;
    this.button(px, y, aw, 58, 'Load', () => {
      const loaded = loadPreset();
      if (!loaded) {
        this.toast('No saved formation yet.');
        return;
      }
      this.draft = loaded;
      this.selectedKey = null;
      if (totalCount(this.draft.counts) !== ARMY_RULES.size) {
        this.showCounts();
        return;
      }
      this.selectedType = this.nextTypeToPlace(null);
      this.toast('Formation loaded.');
      this.refresh();
    });
    const ready = this.button(px + (aw + gap), y, 3 * aw + 2 * gap, 58, 'Ready: start battle  ▶', () => this.startBattle(), 22);
    this.refreshers.push(() => {
      const n = this.draft.placed.size;
      status.setText(`Placed ${n} / ${ARMY_RULES.size}`);
      status.setColor(allPlaced(this.draft) ? '#86efac' : '#f8fafc');
      ready.setEnabled(allPlaced(this.draft));
    });
    this.refreshers.push(() => this.drawGrid());
    this.refresh();
  }

  private nextTypeToPlace(after: UnitType | null): UnitType | null {
    const start = after ? UNIT_TYPES.indexOf(after) : -1;
    for (let i = 1; i <= UNIT_TYPES.length; i++) {
      const t = UNIT_TYPES[(start + i) % UNIT_TYPES.length];
      if (remainingToPlace(this.draft, t) > 0) return t;
    }
    return null;
  }

  private drawGrid(): void {
    const g = this.gridGfx;
    g.clear();
    const cols = ZONE_COLS + PREVIEW_COLS;
    for (let ty = 0; ty < MAP.height; ty++) {
      for (let tx = 0; tx < cols; tx++) {
        const inZone = tx < ZONE_COLS;
        const x = GRID_X + tx * CELL;
        const y = GRID_Y + ty * CELL;
        g.fillStyle((tx + ty) % 2 === 0 ? 0x4a7c3a : 0x467637, inZone ? 1 : 0.45);
        g.fillRect(x, y, CELL, CELL);
        if (inZone) g.fillStyle(TEAM_COLORS[0], 0.18).fillRect(x, y, CELL, CELL);
      }
    }
    g.lineStyle(1, 0x000000, 0.2);
    for (let tx = 0; tx <= ZONE_COLS; tx++) g.lineBetween(GRID_X + tx * CELL, GRID_Y, GRID_X + tx * CELL, GRID_Y + MAP.height * CELL);
    for (let ty = 0; ty <= MAP.height; ty++) g.lineBetween(GRID_X, GRID_Y + ty * CELL, GRID_X + ZONE_COLS * CELL, GRID_Y + ty * CELL);
    g.lineStyle(3, 0x93c5fd, 0.9).strokeRect(GRID_X, GRID_Y, ZONE_COLS * CELL, MAP.height * CELL);
    // Arrow toward the enemy.
    const ax = GRID_X + (ZONE_COLS + PREVIEW_COLS / 2) * CELL;
    const ay = GRID_Y + (MAP.height * CELL) / 2;
    g.fillStyle(0xffffff, 0.35).fillTriangle(ax - 14, ay - 24, ax - 14, ay + 24, ax + 18, ay);

    this.unitLayer.removeAll(true);
    for (const [key, u] of this.draft.placed) {
      const [tx, ty] = parseKey(key);
      const cx = GRID_X + tx * CELL + CELL / 2;
      const cy = GRID_Y + ty * CELL + CELL / 2;
      if (key === this.selectedKey) g.lineStyle(3, 0xfacc15, 1).strokeRect(cx - CELL / 2 + 1, cy - CELL / 2 + 1, CELL - 2, CELL - 2);
      this.unitLayer.add(this.add.image(cx, cy, unitTextureKey(u.type, 0)).setScale(0.85));
      const badge = STANCE_INFO[u.stance].badge;
      if (badge && u.type !== 'king') {
        this.unitLayer.add(
          this.add
            .text(cx + CELL / 2 - 2, cy - CELL / 2 + 1, badge, {
              fontFamily: FONT,
              fontSize: '12px',
              color: '#0f172a',
              backgroundColor: '#fde047',
              padding: { x: 2, y: 0 },
              fontStyle: 'bold',
            })
            .setOrigin(1, 0),
        );
      }
    }
  }

  /** Zone tile under the pointer, or null. */
  private tileAt(p: Phaser.Input.Pointer): [number, number] | null {
    const tx = Math.floor((p.x - GRID_X) / CELL);
    const ty = Math.floor((p.y - GRID_Y) / CELL);
    if (tx < 0 || tx >= ZONE_COLS || ty < 0 || ty >= MAP.height) return null;
    return [tx, ty];
  }

  private onPointerDown(p: Phaser.Input.Pointer): void {
    if (this.step !== 'place' || this.finished) return;
    const t = this.tileAt(p);
    if (!t) return;
    const key = tileKey(t[0], t[1]);
    if (this.draft.placed.has(key)) {
      this.dragKey = key;
      this.dragMoved = false;
    } else {
      this.painting = true;
      this.tryPlace(key);
    }
  }

  private onPointerMove(p: Phaser.Input.Pointer): void {
    if (this.step !== 'place' || !p.isDown) return;
    const t = this.tileAt(p);
    if (!t) return;
    const key = tileKey(t[0], t[1]);
    if (this.dragKey && key !== this.dragKey && !this.draft.placed.has(key)) {
      // Move the dragged unit.
      const u = this.draft.placed.get(this.dragKey)!;
      this.draft.placed.delete(this.dragKey);
      this.draft.placed.set(key, u);
      this.dragKey = key;
      this.dragMoved = true;
      this.selectedKey = key;
      this.refresh();
    } else if (this.painting && !this.draft.placed.has(key)) {
      this.tryPlace(key);
    }
  }

  private onPointerUp(): void {
    if (this.dragKey && !this.dragMoved) {
      // A tap on a placed unit selects it (tap again to deselect).
      this.selectedKey = this.selectedKey === this.dragKey ? null : this.dragKey;
      this.refresh();
    }
    this.dragKey = null;
    this.painting = false;
  }

  private tryPlace(key: string): void {
    const type = this.selectedType;
    if (!type) {
      this.toast(allPlaced(this.draft) ? 'All 25 units are placed. Press Ready!' : 'Pick a unit type first.');
      return;
    }
    if (remainingToPlace(this.draft, type) <= 0) {
      this.toast(`No ${UNITS[type].name}s left to place.`);
      return;
    }
    this.draft.placed.set(key, { type, stance: 'advance' });
    this.selectedKey = null;
    if (remainingToPlace(this.draft, type) <= 0) this.selectedType = this.nextTypeToPlace(type);
    this.refresh();
  }

  private setStance(stance: Stance): void {
    const u = this.selectedKey ? this.draft.placed.get(this.selectedKey) : undefined;
    if (!u) return;
    u.stance = stance;
    this.refresh();
  }

  private removeSelected(): void {
    if (!this.selectedKey) return;
    const u = this.draft.placed.get(this.selectedKey);
    this.draft.placed.delete(this.selectedKey);
    this.selectedKey = null;
    if (u) this.selectedType = u.type;
    this.refresh();
  }

  // ======================================================================

  private startBattle(): void {
    if (this.finished) return;
    const player = draftToSetup(this.draft, 0, MAP.width);
    const errors = validateArmy(player, 0, MAP);
    if (errors.length) {
      this.toast(errors[0]);
      return;
    }
    this.finished = true;
    const data: BattleStartData = {
      setups: [player, TEST_ARMY_RED],
      setupData: { mode: this.mode, draft: this.draft } satisfies SetupStartData,
    };
    // Short pause so a "time's up" message can be read.
    this.time.delayedCall(this.deadline && Date.now() >= this.deadline ? 1200 : 0, () => this.scene.start('Battle', data));
  }
}
