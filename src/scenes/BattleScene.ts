/**
 * Battle screen: draws the simulation and shows the HUD.
 * All game logic lives in src/sim; this scene only reads the battle state.
 *
 * vs AI: the computer's orders come from AiCommander (recorded like the player's).
 * Online: both devices run the same battle in lockstep (src/net/lockstep.ts); only the
 * players' orders travel over the network, plus a state fingerprint now and then to
 * detect if the two battles ever differ.
 */
import Phaser from 'phaser';
import { ARMY_RULES, TERRAIN, UNIT_TYPES, UNITS } from '../config/gameConfig';
import { DIFFICULTY_NAMES, type Difficulty } from '../ai/armyBuilder';
import { AiCommander } from '../ai/commander';
import { MAPS, getMap } from '../data/maps';
import { TEST_ARMY_BLUE, TEST_ARMY_RED } from '../data/testArmies';
import { Lockstep } from '../net/lockstep';
import { getSession, type NetMessage, type OnlineSession } from '../net/session';
import {
  Battle,
  SIM_CONSTANTS,
  SUB,
  applyRecordedCommands,
  type ArmySetup,
  type AttackMode,
  type BattleCommand,
  type BattleEvent,
  type BattleRecord,
  type RecordedCommand,
  type Team,
  type Unit,
} from '../sim';
import type { SetupStartData } from './SetupScene';
import { makeButton, type Button } from '../ui/button';
import { drawMapTiles, terrainAt } from '../ui/terrainDraw';
import { drawUnitShape, ensureUnitTextures, unitTextureKey } from '../ui/unitShapes';
import {
  FONT,
  GAME_H,
  GAME_W,
  HUD_H,
  LEGEND_H,
  MAP_H_PX,
  MAP_Y,
  TEAM_COLORS,
  TEAM_DARK,
  TEAM_NAMES,
  TILE_PX,
} from '../ui/layout';

const TICK_MS = 1000 / 20;
/** Online: compare battle fingerprints with the friend every this many ticks. */
const HASH_EVERY_TICKS = 40;

/** Online "Play again" presses, by round (kept across the replay screen restarting). */
const again = { mine: -1, theirs: -1 };

interface Effect {
  kind: BattleEvent['kind'];
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  radius: number;
  color: number;
  age: number;
  life: number;
}

/** Convert simulation sub-tile coordinates to screen pixels. */
function sx(x: number): number {
  return (x / SUB) * TILE_PX;
}
function sy(y: number): number {
  return MAP_Y + (y / SUB) * TILE_PX;
}

export interface BattleStartData {
  /** Battlefield; without it a random map is picked (demo battle). */
  mapId?: string;
  setups?: [ArmySetup, ArmySetup];
  seed?: number;
  /** When set, this is a replay: these recorded orders are re-issued and the player can't give new ones. */
  replayCommands?: RecordedCommand[];
  /** Where "Change army" / "Play again" go back to (the setup screen), with its settings. */
  setupData?: SetupStartData;
  /** vs AI: the computer plays the other side with this difficulty. */
  ai?: Difficulty;
  /** Online game (uses the online session). */
  online?: boolean;
  /** Which side the player on this device controls (default Blue). */
  myTeam?: Team;
}

export class BattleScene extends Phaser.Scene {
  private record!: BattleRecord;
  private battle!: Battle;
  private accumulator = 0;
  private speed = 1;
  private debug = false;
  private prevX: number[] = [];
  private prevY: number[] = [];
  private effects: Effect[] = [];

  private gUnits!: Phaser.GameObjects.Graphics;
  private gBars!: Phaser.GameObjects.Graphics;
  private sprites: Phaser.GameObjects.Image[] = [];
  private gFx!: Phaser.GameObjects.Graphics;
  private gHud!: Phaser.GameObjects.Graphics;
  private timerText!: Phaser.GameObjects.Text;
  private valueTexts!: [Phaser.GameObjects.Text, Phaser.GameObjects.Text];
  private debugText!: Phaser.GameObjects.Text;
  private speedButton!: Button;
  private resultShown = false;
  private isReplay = false;
  private nextReplayCommand = 0;
  private modeButtons!: Record<AttackMode, Button>;
  private orderText!: Phaser.GameObjects.Text;

  private myTeam: Team = 0;
  private commander: AiCommander | null = null;
  private session: OnlineSession | null = null;
  private lockstep: Lockstep | null = null;
  /** Online: our fingerprints and the friend's, by tick. */
  private myHashes = new Map<number, number>();
  private theirHashes = new Map<number, number>();
  private desync = false;
  private friendLeft = '';
  private stalledMs = 0;
  private netText!: Phaser.GameObjects.Text;
  private resultNote: Phaser.GameObjects.Text | null = null;
  private againButton: Button | null = null;

  constructor() {
    super('Battle');
  }

  /** Data passed from the setup screen. Without it, the built-in test armies fight. */
  private startData: BattleStartData = {};

  init(data: BattleStartData): void {
    this.startData = data ?? {};
    const seed = data?.seed ?? Math.floor(Math.random() * 0xffffffff) >>> 0;
    const setups = data?.setups ?? [TEST_ARMY_BLUE, TEST_ARMY_RED];
    this.isReplay = !!data?.replayCommands;
    this.nextReplayCommand = 0;
    const mapId = data?.mapId ?? MAPS[Math.floor(Math.random() * MAPS.length)].id;
    this.record = { mapId, seed, setups, commands: data?.replayCommands ?? [] };
    this.accumulator = 0;
    this.effects = [];
    this.resultShown = false;
    this.myTeam = data?.myTeam ?? 0;
    this.commander = null;
    this.session = null;
    this.lockstep = null;
    this.myHashes = new Map();
    this.theirHashes = new Map();
    this.desync = false;
    this.friendLeft = '';
    this.stalledMs = 0;
    this.resultNote = null;
    this.againButton = null;
    if (data?.online) this.speed = 1; // both players must watch at the same speed
  }

  private get enemyTeam(): Team {
    return this.myTeam === 0 ? 1 : 0;
  }

  create(): void {
    this.battle = new Battle(getMap(this.record.mapId), this.record.setups, this.record.seed);
    this.savePrevPositions();

    if (this.startData.ai && !this.isReplay) this.commander = new AiCommander(this.startData.ai, this.enemyTeam);
    if (this.startData.online) {
      const s = getSession();
      if (s && !s.closed) {
        this.session = s;
        if (!this.isReplay) this.lockstep = new Lockstep(this.myTeam, (frame) => s.send({ t: 'frame', frame }));
        s.setHandler((m) => this.onNet(m));
        this.events.once('shutdown', () => s.setHandler(null));
      } else {
        this.friendLeft = 'The connection to your friend was lost.';
      }
    }

    this.drawMap();
    this.drawLegend();
    ensureUnitTextures(this);
    this.gUnits = this.add.graphics();
    this.sprites = this.battle.units.map((u) => this.add.image(0, 0, unitTextureKey(u.type, u.team)));
    this.gBars = this.add.graphics();
    this.gFx = this.add.graphics();
    this.gHud = this.add.graphics();
    this.createHud();
    this.createOrders();
    this.input.on('pointerdown', this.onMapTap, this);
  }

  // ------------------------------------------------------------------
  // Static drawing
  // ------------------------------------------------------------------

  private drawMap(): void {
    // Drawn once into a texture: a Graphics object would be re-rendered every frame.
    const map = this.battle.map;
    const key = `map-${map.id}`;
    if (!this.textures.exists(key)) this.bakeMapTexture(key);
    this.add.image(0, MAP_Y, key).setOrigin(0);
  }

  private bakeMapTexture(key: string): void {
    const g = this.make.graphics({}, false);
    const map = this.battle.map;
    drawMapTiles(g, map, 0, 0, TILE_PX);
    const w = map.width * TILE_PX;
    const h = map.height * TILE_PX;
    // Deployment zones, lightly tinted in team colours.
    const zoneW = ARMY_RULES.deployColumns * TILE_PX;
    g.fillStyle(TEAM_COLORS[0], 0.1).fillRect(0, 0, zoneW, h);
    g.fillStyle(TEAM_COLORS[1], 0.1).fillRect(w - zoneW, 0, zoneW, h);
    // Centre line.
    g.lineStyle(2, 0xffffff, 0.15).lineBetween(w / 2, 0, w / 2, h);
    g.generateTexture(key, w, h);
    g.destroy();
  }

  /** Compact unit legend on the right of the bottom bar (2 rows). */
  private drawLegend(): void {
    const y = GAME_H - LEGEND_H;
    const g = this.add.graphics();
    g.fillStyle(0x1e293b, 1).fillRect(0, y, GAME_W, LEGEND_H);
    const itemW = 136;
    const startX = GAME_W - itemW * 4 - 4;
    UNIT_TYPES.forEach((type, i) => {
      const x = startX + (i % 4) * itemW + 14;
      const cy = y + 19 + Math.floor(i / 4) * 34;
      g.save();
      g.translateCanvas(x, cy);
      g.scaleCanvas(0.75, 0.75);
      drawUnitShape(g, type, 0, 0, 0x94a3b8, 0xe2e8f0);
      g.restore();
      this.add.text(x + 16, cy, UNITS[type].name, { fontFamily: FONT, fontSize: '15px', color: '#e2e8f0' }).setOrigin(0, 0.5);
    });
  }

  // ------------------------------------------------------------------
  // Orders (bottom bar)
  // ------------------------------------------------------------------

  private createOrders(): void {
    const y = GAME_H - LEGEND_H;
    this.add.text(12, y + LEGEND_H / 2, 'Orders', { fontFamily: FONT, fontSize: '16px', color: '#94a3b8', fontStyle: 'bold' }).setOrigin(0, 0.5);
    this.modeButtons = {
      auto: makeButton(this, 80, y + 8, 96, LEGEND_H - 16, 'Auto', () => this.setMode('auto'), { fontSize: 18 }),
      king: makeButton(this, 184, y + 8, 124, LEGEND_H - 16, 'Attack\nKing', () => this.setMode('king'), { fontSize: 17 }),
      formation: makeButton(this, 316, y + 8, 124, LEGEND_H - 16, 'Keep\nFormation', () => this.setMode('formation'), {
        fontSize: 17,
      }),
    };
    this.orderText = this.add
      .text(452, y + LEGEND_H / 2, '', { fontFamily: FONT, fontSize: '14px', color: '#e2e8f0', wordWrap: { width: 270 } })
      .setOrigin(0, 0.5);
    if (this.isReplay) for (const b of Object.values(this.modeButtons)) b.setEnabled(false);
    this.refreshOrders();
  }

  private setMode(mode: AttackMode): void {
    if (this.isReplay) return;
    this.giveOrder({ kind: 'mode', mode });
  }

  /** Online the order goes through the lockstep (it takes effect a few ticks later on both devices). */
  private giveOrder(cmd: BattleCommand): void {
    if (this.battle.result) return;
    if (this.lockstep) this.lockstep.queue(cmd);
    else if (!this.startData.online) this.battle.issueCommand(this.myTeam, cmd);
    this.refreshOrders();
  }

  /** Tap on the battlefield: pick the enemy unit under the finger as the focus target. */
  private onMapTap(p: Phaser.Input.Pointer): void {
    if (this.isReplay || this.battle.result || p.y < MAP_Y || p.y > MAP_Y + MAP_H_PX) return;
    let best: Unit | null = null;
    let bestD = (TILE_PX * 1.1) ** 2; // generous finger-sized tap area
    for (const u of this.battle.units) {
      if (!u.alive || u.team !== this.enemyTeam) continue;
      const d = (sx(u.x) - p.x) ** 2 + (sy(u.y) - p.y) ** 2;
      if (d < bestD) {
        best = u;
        bestD = d;
      }
    }
    if (!best) return;
    const target = this.battle.focus[this.myTeam] === best.id ? -1 : best.id; // tap again to cancel
    this.giveOrder({ kind: 'focus', target });
  }

  private refreshOrders(): void {
    const mode = this.battle.modes[this.myTeam];
    for (const [m, b] of Object.entries(this.modeButtons)) b.setSelected(m === mode);
    const f = this.battle.focus[this.myTeam];
    const enemy = TEAM_NAMES[this.enemyTeam];
    if (this.isReplay) {
      this.orderText.setText('Replay: all orders are repeated exactly as they were given.');
    } else if (f >= 0) {
      this.orderText.setText(`Focus: ${enemy} ${UNITS[this.battle.units[f].type].name}. Tap it again to cancel.`);
    } else {
      this.orderText.setText(
        mode === 'king'
          ? `Everyone is going for the ${enemy} King! Tap an enemy to focus it instead.`
          : mode === 'formation'
            ? 'Marching in formation. Units break off when they find a target.'
            : 'Tap an enemy to make your whole army attack it.',
      );
    }
  }

  private createHud(): void {
    const bg = this.add.graphics();
    bg.fillStyle(0x0f172a, 1).fillRect(0, 0, GAME_W, HUD_H);
    bg.setDepth(-1);

    this.timerText = this.add
      .text(GAME_W / 2, 10, '', { fontFamily: FONT, fontSize: '26px', color: '#f8fafc', fontStyle: 'bold' })
      .setOrigin(0.5, 0);
    this.valueTexts = [
      this.add
        .text(390, 62, '', { fontFamily: FONT, fontSize: '16px', color: '#93c5fd', fontStyle: 'bold', align: 'right' })
        .setOrigin(1, 0.5),
      this.add
        .text(890, 62, '', { fontFamily: FONT, fontSize: '16px', color: '#fca5a5', fontStyle: 'bold' })
        .setOrigin(0, 0.5),
    ];
    this.add
      .text(GAME_W / 2, 84, 'Army strength  ·  King HP decides if time runs out', { fontFamily: FONT, fontSize: '13px', color: '#94a3b8' })
      .setOrigin(0.5, 0.5);

    makeButton(this, 16, 22, 150, 56, this.startData.online ? 'Leave' : 'Menu', () => this.scene.start('Menu'));
    const who = this.startData.online
      ? ` · Online · You are ${TEAM_NAMES[this.myTeam]}`
      : this.startData.ai
        ? ` · vs AI (${DIFFICULTY_NAMES[this.startData.ai]})`
        : '';
    this.add
      .text(16, 90, `${this.battle.map.name}${who} · Seed ${this.record.seed}`, { fontFamily: FONT, fontSize: '12px', color: '#64748b' })
      .setOrigin(0, 0.5);

    this.speedButton = makeButton(this, 1026, 22, 116, 56, `Speed ${this.speed}×`, () => {
      this.speed = this.speed === 1 ? 2 : 1;
      this.speedButton.setLabel(`Speed ${this.speed}×`);
    });
    // Online both players must watch at the same pace (except when watching a replay).
    if (this.startData.online && !this.isReplay) this.speedButton.container.setVisible(false);

    // Online status ("waiting for your friend…", problems), shown over the battlefield.
    this.netText = this.add
      .text(GAME_W / 2, MAP_Y + 30, '', {
        fontFamily: FONT,
        fontSize: '20px',
        color: '#fde047',
        backgroundColor: '#000000cc',
        padding: { x: 12, y: 6 },
        align: 'center',
      })
      .setOrigin(0.5)
      .setDepth(15)
      .setVisible(false);
    makeButton(this, 1150, 22, 114, 56, 'Debug', () => {
      this.debug = !this.debug;
      this.debugText.setVisible(this.debug);
    });

    this.debugText = this.add
      .text(8, MAP_Y + 6, '', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#fef08a',
        backgroundColor: '#000000aa',
        padding: { x: 6, y: 4 },
      })
      .setDepth(10)
      .setVisible(this.debug);
  }

  // ------------------------------------------------------------------
  // Update loop: fixed 20 Hz simulation, smooth interpolated drawing
  // ------------------------------------------------------------------

  update(_time: number, delta: number): void {
    const online = !!this.lockstep;
    // Cap delta so a backgrounded tab doesn't fast-forward the whole battle at once.
    // Online, allow a bigger backlog so a device that fell behind catches up.
    this.accumulator = Math.min(this.accumulator + Math.min(delta, 250) * this.speed, online ? 1000 : 250);
    let stalled = false;
    while (this.accumulator >= TICK_MS && !this.battle.result && !this.friendLeft) {
      this.savePrevPositions();
      if (this.isReplay) this.nextReplayCommand = applyRecordedCommands(this.battle, this.record.commands, this.nextReplayCommand);
      else this.commander?.update(this.battle);
      const focusBefore = this.battle.focus[this.myTeam];
      const modeBefore = this.battle.modes[this.myTeam];
      if (this.lockstep) {
        if (!this.lockstep.step(this.battle)) {
          stalled = true; // the friend's orders for this tick haven't arrived yet
          break;
        }
        this.afterOnlineStep();
      } else {
        this.battle.step();
      }
      if (this.battle.focus[this.myTeam] !== focusBefore || this.battle.modes[this.myTeam] !== modeBefore) this.refreshOrders();
      this.spawnEffects(this.battle.events);
      this.accumulator -= TICK_MS;
    }
    this.stalledMs = stalled ? this.stalledMs + delta : 0;
    this.updateNetText();
    const alpha = this.battle.result || stalled ? 1 : this.accumulator / TICK_MS;

    this.updateEffects(delta * this.speed);
    this.drawUnits(alpha);
    this.drawEffects();
    this.drawHud();
    if (this.debug) this.drawDebug(alpha);

    if (this.battle.result && !this.resultShown) {
      this.resultShown = true;
      this.time.delayedCall(800, () => this.showResult());
    }
  }

  // ------------------------------------------------------------------
  // Online
  // ------------------------------------------------------------------

  private onNet(m: NetMessage): void {
    switch (m.t) {
      case 'frame':
        this.lockstep?.receive(m.frame);
        break;
      case 'hash': {
        this.theirHashes.set(m.tick, m.hash);
        const mine = this.myHashes.get(m.tick);
        if (mine !== undefined && mine !== m.hash) this.desync = true;
        break;
      }
      case 'again':
        again.theirs = this.session?.round ?? -1;
        this.refreshAgain();
        break;
      case 'start':
        // The host started the next round: back to army setup, keeping our army.
        this.goToNextRound();
        break;
      case '_closed':
        this.friendLeft = m.reason;
        this.refreshAgain();
        break;
    }
  }

  /** Every few ticks, fingerprint the battle and compare with the friend's. */
  private afterOnlineStep(): void {
    const t = this.battle.tick;
    if (t % HASH_EVERY_TICKS !== 0 && !this.battle.result) return;
    const h = this.battle.stateHash();
    this.myHashes.set(t, h);
    this.session?.send({ t: 'hash', tick: t, hash: h });
    const theirs = this.theirHashes.get(t);
    if (theirs !== undefined && theirs !== h) this.desync = true;
  }

  private updateNetText(): void {
    let msg = '';
    let color = '#fde047';
    if (this.friendLeft && !this.battle.result) {
      msg = `${this.friendLeft}\nThe battle can't continue. Press Leave to go back to the menu.`;
      color = '#fca5a5';
    } else if (this.desync) {
      msg = 'Warning: your battle and your friend\'s battle no longer match!';
      color = '#fca5a5';
    } else if (this.stalledMs > 1500) {
      msg = 'Waiting for your friend… (slow connection, or their game is in the background)';
    }
    this.netText.setText(msg).setColor(color).setVisible(msg !== '');
  }

  /** Online "Play again": when both players pressed it, the host starts the next round. */
  private pressAgain(): void {
    const s = this.session;
    if (!s || s.closed) return;
    again.mine = s.round;
    s.send({ t: 'again' });
    this.refreshAgain();
  }

  private refreshAgain(): void {
    const s = this.session;
    const round = s?.round ?? -2;
    const mine = again.mine === round;
    const theirs = again.theirs === round;
    if (this.againButton) this.againButton.setEnabled(!!s && !s.closed && !this.friendLeft && !mine);
    if (this.resultNote) {
      this.resultNote.setText(
        this.friendLeft
          ? this.friendLeft
          : mine && theirs
            ? 'Starting the next battle…'
            : mine
              ? 'Waiting for your friend to press Play again…'
              : theirs
                ? 'Your friend wants to play again!'
                : '',
      );
    }
    if (s && !s.closed && mine && theirs && s.role === 'host') {
      s.hostStartRound();
      this.goToNextRound();
    }
  }

  private goToNextRound(): void {
    this.session?.setHandler(null); // messages wait for the setup screen
    const data: SetupStartData = { mode: 'online', mapId: this.session?.mapId ?? this.record.mapId, draft: this.startData.setupData?.draft };
    this.scene.start('Setup', data);
  }

  private savePrevPositions(): void {
    for (const u of this.battle.units) {
      this.prevX[u.id] = u.x;
      this.prevY[u.id] = u.y;
    }
  }

  private posOf(u: Unit, alpha: number): [number, number] {
    const x = this.prevX[u.id] + (u.x - this.prevX[u.id]) * alpha;
    const y = this.prevY[u.id] + (u.y - this.prevY[u.id]) * alpha;
    return [sx(x), sy(y)];
  }

  // ------------------------------------------------------------------
  // Units
  // ------------------------------------------------------------------

  private drawUnits(alpha: number): void {
    const g = this.gUnits;
    g.clear();

    // Fallen units: faint markers.
    for (const u of this.battle.units) {
      if (u.alive) continue;
      const [x, y] = [sx(u.x), sy(u.y)];
      g.lineStyle(3, TEAM_DARK[u.team], 0.35);
      g.lineBetween(x - 6, y - 6, x + 6, y + 6);
      g.lineBetween(x - 6, y + 6, x + 6, y - 6);
    }

    // Medic heal beams.
    for (const u of this.battle.units) {
      if (!u.alive || u.healTargetId < 0) continue;
      const t = this.battle.units[u.healTargetId];
      const [x1, y1] = this.posOf(u, alpha);
      const [x2, y2] = this.posOf(t, alpha);
      g.lineStyle(3, 0x4ade80, 0.45).lineBetween(x1, y1, x2, y2);
    }

    const bars = this.gBars;
    bars.clear();
    for (const u of this.battle.units) {
      const sprite = this.sprites[u.id];
      sprite.setVisible(u.alive);
      if (!u.alive) continue;
      const [x, y] = this.posOf(u, alpha);
      sprite.setPosition(x, y);

      // Facing tick.
      bars.lineStyle(2, 0x0f172a, 0.9).lineBetween(x, y, x + (u.facingX / 1000) * 9, y + (u.facingY / 1000) * 9);

      // Mage casting ring.
      if (u.type === 'mage' && u.castProgress > 0) {
        const p = u.castProgress / u.stats.attackTicks;
        bars.lineStyle(3, 0xc084fc, 0.9);
        bars.beginPath();
        bars.arc(x, y, 16, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2, false);
        bars.strokePath();
      }

      // Health bar.
      const hpPct = u.hp / u.stats.maxHp;
      const bw = 24;
      bars.fillStyle(0x000000, 0.7).fillRect(x - bw / 2 - 1, y - 21, bw + 2, 6);
      bars.fillStyle(hpPct > 0.5 ? 0x22c55e : hpPct > 0.25 ? 0xeab308 : 0xef4444, 1).fillRect(x - bw / 2, y - 20, bw * hpPct, 4);
    }

    // Marker on the enemy our orders point at: focus target (yellow) or enemy King in 'Attack King' mode (orange).
    const f = this.battle.focus[this.myTeam];
    const enemyKing = this.battle.kingIds[this.enemyTeam];
    const markId =
      f >= 0 ? f : this.battle.modes[this.myTeam] === 'king' && enemyKing >= 0 && this.battle.units[enemyKing].alive ? enemyKing : -1;
    if (markId >= 0) {
      const [x, y] = this.posOf(this.battle.units[markId], alpha);
      const pulse = 20 + Math.sin(this.time.now / 150) * 3;
      const color = f >= 0 ? 0xfacc15 : 0xfb923c;
      bars.lineStyle(3, color, 1).strokeCircle(x, y, pulse);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        bars.lineBetween(x + dx * (pulse - 6), y + dy * (pulse - 6), x + dx * (pulse + 7), y + dy * (pulse + 7));
      }
    }
  }

  // ------------------------------------------------------------------
  // Effects (hits, arrows, spells, deaths)
  // ------------------------------------------------------------------

  private spawnEffects(events: readonly BattleEvent[]): void {
    const units = this.battle.units;
    for (const e of events) {
      switch (e.kind) {
        case 'melee':
        case 'arrow': {
          const a = units[e.from];
          const b = units[e.to];
          this.effects.push({
            kind: e.kind,
            x1: sx(a.x), y1: sy(a.y), x2: sx(b.x), y2: sy(b.y),
            radius: 0,
            color: e.kind === 'arrow' ? 0xfde047 : 0xffffff,
            age: 0,
            life: e.kind === 'arrow' ? 250 : 180,
          });
          break;
        }
        case 'spell':
          this.effects.push({
            kind: 'spell',
            x1: sx(e.x), y1: sy(e.y), x2: 0, y2: 0,
            radius: (e.radius / SUB) * TILE_PX,
            color: 0xc084fc,
            age: 0,
            life: 450,
          });
          break;
        case 'interrupt':
        case 'death': {
          const u = units[e.unit];
          this.effects.push({
            kind: e.kind,
            x1: sx(u.x), y1: sy(u.y), x2: 0, y2: 0,
            radius: 0,
            color: e.kind === 'death' ? 0xffffff : 0xf97316,
            age: 0,
            life: 400,
          });
          break;
        }
      }
    }
  }

  private updateEffects(dt: number): void {
    for (const f of this.effects) f.age += dt;
    this.effects = this.effects.filter((f) => f.age < f.life);
  }

  private drawEffects(): void {
    const g = this.gFx;
    g.clear();
    for (const f of this.effects) {
      const t = f.age / f.life;
      const a = 1 - t;
      switch (f.kind) {
        case 'melee': {
          // Short slash at the target.
          const mx = f.x1 + (f.x2 - f.x1) * 0.7;
          const my = f.y1 + (f.y2 - f.y1) * 0.7;
          g.lineStyle(3, f.color, a).lineBetween(mx - 6, my - 6, mx + 6, my + 6);
          break;
        }
        case 'arrow': {
          // A dot flying from archer to target.
          const x = f.x1 + (f.x2 - f.x1) * t;
          const y = f.y1 + (f.y2 - f.y1) * t;
          g.lineStyle(2, f.color, 0.8).lineBetween(x - (f.x2 - f.x1) * 0.05, y - (f.y2 - f.y1) * 0.05, x, y);
          g.fillStyle(f.color, 1).fillCircle(x, y, 2.5);
          break;
        }
        case 'spell':
          g.fillStyle(f.color, 0.35 * a).fillCircle(f.x1, f.y1, f.radius * (0.4 + 0.6 * t));
          g.lineStyle(3, f.color, a).strokeCircle(f.x1, f.y1, f.radius);
          break;
        case 'interrupt':
          g.lineStyle(3, f.color, a).strokeCircle(f.x1, f.y1, 10 + 12 * t);
          break;
        case 'death':
          g.lineStyle(2, f.color, a).strokeCircle(f.x1, f.y1, 6 + 18 * t);
          break;
      }
    }
  }

  // ------------------------------------------------------------------
  // HUD
  // ------------------------------------------------------------------

  private drawHud(): void {
    const b = this.battle;
    const secs = Math.floor(b.tick / 20);
    const total = Math.floor(b.maxTicks / 20);
    const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    this.timerText.setText(`${fmt(secs)} / ${fmt(total)}`);

    const v0 = b.armyValue(0);
    const v1 = b.armyValue(1);
    const kingPct = (t: 0 | 1) => Math.ceil(b.kingHpPermille(t) / 10);
    this.valueTexts[0].setText(`${this.sideName(0)} · ${b.aliveCount(0)} units\nKing ${kingPct(0)}%`);
    this.valueTexts[1].setText(`${b.aliveCount(1)} units · ${this.sideName(1)}\nKing ${kingPct(1)}%`);

    const g = this.gHud;
    g.clear();
    const x = 400;
    const w = 480;
    const y = 52;
    const h = 20;
    const share = v0 + v1 > 0 ? v0 / (v0 + v1) : 0.5;
    g.fillStyle(TEAM_COLORS[1], 1).fillRect(x, y, w, h);
    g.fillStyle(TEAM_COLORS[0], 1).fillRect(x, y, w * share, h);
    g.lineStyle(2, 0xffffff, 0.8).strokeRect(x, y, w, h);
    g.lineStyle(2, 0xffffff, 0.8).lineBetween(x + w / 2, y - 3, x + w / 2, y + h + 3);
  }

  /** "Blue (You)", "Red (AI Hard)", "Red (Friend)", or just the colour in a demo. */
  private sideName(team: Team): string {
    const { ai, online } = this.startData;
    if (!ai && !online) return TEAM_NAMES[team];
    if (team === this.myTeam) return `${TEAM_NAMES[team]} (You)`;
    return `${TEAM_NAMES[team]} (${online ? 'Friend' : `AI ${DIFFICULTY_NAMES[ai!]}`})`;
  }

  private drawDebug(alpha: number): void {
    const g = this.gFx;
    // Tile grid.
    g.lineStyle(1, 0x000000, 0.15);
    for (let tx = 0; tx <= this.battle.map.width; tx++) g.lineBetween(tx * TILE_PX, MAP_Y, tx * TILE_PX, MAP_Y + this.battle.map.height * TILE_PX);
    for (let ty = 0; ty <= this.battle.map.height; ty++) g.lineBetween(0, MAP_Y + ty * TILE_PX, GAME_W, MAP_Y + ty * TILE_PX);

    for (const u of this.battle.units) {
      if (!u.alive) continue;
      const [x, y] = this.posOf(u, alpha);
      // Attack range (longer for ranged units on high ground).
      const rangePx = (Math.sqrt(this.battle.rangeSqOf(u)) / SUB) * TILE_PX;
      g.lineStyle(1, TEAM_COLORS[u.team], 0.35).strokeCircle(x, y, rangePx);
      if (u.type === 'medic') {
        g.lineStyle(1, 0x4ade80, 0.35).strokeCircle(x, y, (Math.sqrt(SIM_CONSTANTS.healRadiusSq) / SUB) * TILE_PX);
      }
      // Target line.
      if (u.targetId >= 0 && this.battle.units[u.targetId].alive) {
        const [tx, ty] = this.posOf(this.battle.units[u.targetId], alpha);
        g.lineStyle(1, TEAM_COLORS[u.team], 0.6).lineBetween(x, y, tx, ty);
      }
    }
    this.debugText.setText(
      [
        `FPS ${this.game.loop.actualFps.toFixed(0)}`,
        `Tick ${this.battle.tick}/${this.battle.maxTicks}`,
        `Seed ${this.battle.seed}`,
        `Hash ${this.battle.stateHash().toString(16).padStart(8, '0')}`,
        `Map: ${this.battle.map.name}`,
        `Tile under pointer: ${this.pointerTerrain()}`,
        ...(this.lockstep ? [`Online: you are ${TEAM_NAMES[this.myTeam]}, order delay ${this.lockstep.delay} ticks${this.desync ? ', OUT OF SYNC' : ''}`] : []),
      ].join('\n'),
    );
  }

  /** Terrain name of the tile under the mouse/finger (debug overlay). */
  private pointerTerrain(): string {
    const p = this.input.activePointer;
    const map = this.battle.map;
    const tx = Math.floor(p.x / TILE_PX);
    const ty = Math.floor((p.y - MAP_Y) / TILE_PX);
    if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return '-';
    return `${TERRAIN[terrainAt(map, tx, ty)].name} (${tx}, ${ty})`;
  }

  // ------------------------------------------------------------------
  // Results
  // ------------------------------------------------------------------

  private showResult(): void {
    const r = this.battle.result!;
    const w = 720;
    const h = 560;
    const x0 = (GAME_W - w) / 2;
    const y0 = (GAME_H - h) / 2;
    const panel = this.add.container(0, 0).setDepth(20);
    // Dim the battlefield; also swallows taps on things behind the panel.
    const shade = this.add.rectangle(0, 0, GAME_W, GAME_H, 0x000000, 0.55).setOrigin(0).setInteractive();
    const box = this.add.rectangle(x0, y0, w, h, 0x0f172a, 0.97).setOrigin(0).setStrokeStyle(3, 0x94a3b8);
    panel.add([shade, box]);

    // With a player (vs AI or online), say it from their point of view.
    const personal = !!(this.startData.ai || this.startData.online);
    const title =
      r.winner === null
        ? 'DRAW'
        : personal
          ? `${r.winner === this.myTeam ? 'YOU WIN!' : 'YOU LOSE'}  (${TEAM_NAMES[r.winner]} wins)`
          : `${TEAM_NAMES[r.winner].toUpperCase()} WINS`;
    const titleColor = r.winner === null ? '#f8fafc' : r.winner === 0 ? '#93c5fd' : '#fca5a5';    const secs = (r.tick / 20).toFixed(1);
    const loser = r.winner === null ? 'Both' : TEAM_NAMES[r.winner === 0 ? 1 : 0];
    const reason =
      r.reason === 'king'
        ? r.winner === null
          ? `Both Kings fell at the same moment (${secs} s)`
          : `${loser}'s King has fallen after ${secs} s`
        : r.reason === 'annihilation'
        ? `All enemy units defeated after ${secs} s`
        : r.winner === null
          ? `Time's up: both Kings have the same HP (${(r.kingHp[0] / 10).toFixed(1)}%)`
          : `Time's up: ${TEAM_NAMES[r.winner]}'s King has more HP (${(r.kingHp[r.winner] / 10).toFixed(1)}% vs ${(r.kingHp[r.winner === 0 ? 1 : 0] / 10).toFixed(1)}%)`;

    panel.add(
      this.add.text(GAME_W / 2, y0 + 24, title, { fontFamily: FONT, fontSize: '44px', color: titleColor, fontStyle: 'bold' }).setOrigin(0.5, 0),
    );
    panel.add(
      this.add.text(GAME_W / 2, y0 + 82, reason, { fontFamily: FONT, fontSize: '18px', color: '#cbd5e1' }).setOrigin(0.5, 0),
    );

    const rows: string[] = [];
    rows.push(`${'Units lost'.padEnd(14)}${String(r.unitsLost[0]).padStart(8)}${String(r.unitsLost[1]).padStart(8)}`);
    rows.push('');
    rows.push('Damage dealt by unit type');
    for (const t of UNIT_TYPES) {
      rows.push(`${UNITS[t].name.padEnd(14)}${String(r.damageByType[0][t]).padStart(8)}${String(r.damageByType[1][t]).padStart(8)}`);
    }
    panel.add(
      this.add
        .text(GAME_W / 2, y0 + 120, `${''.padEnd(14)}${'Blue'.padStart(8)}${'Red'.padStart(8)}`, {
          fontFamily: 'monospace', fontSize: '18px', color: '#f8fafc', fontStyle: 'bold',
        })
        .setOrigin(0.5, 0),
    );
    panel.add(
      this.add
        .text(GAME_W / 2, y0 + 146, rows.join('\n'), { fontFamily: 'monospace', fontSize: '18px', color: '#e2e8f0', lineSpacing: 4 })
        .setOrigin(0.5, 0),
    );

    const { seed, setups, mapId } = this.record;
    const setupData = this.startData.setupData;
    const bw = 210;
    const gap = 16;
    const bx = GAME_W / 2 - (bw * 3 + gap * 2) / 2;
    const by = y0 + h - 80;
    const replay = makeButton(this, bx, by, bw, 60, 'Watch replay', () =>
      this.scene.restart({ ...this.startData, mapId, seed, setups, replayCommands: [...this.battle.commandLog] }),
    );
    panel.add(replay.container);

    if (this.startData.online) {
      // Online: play again only when both players agree (the host then starts a new round).
      this.againButton = makeButton(this, bx + bw + gap, by, bw, 60, 'Play again', () => this.pressAgain());
      const leave = makeButton(this, bx + 2 * (bw + gap), by, bw, 60, 'Leave', () => this.scene.start('Menu'));
      this.resultNote = this.add
        .text(GAME_W / 2, by - 24, '', { fontFamily: FONT, fontSize: '17px', color: '#fde047', align: 'center' })
        .setOrigin(0.5);
      panel.add([this.againButton.container, leave.container, this.resultNote]);
      this.refreshAgain();
      return;
    }

    const rematch = makeButton(this, bx + bw + gap, by, bw, 60, 'Rematch', () =>
      this.scene.restart({ ...this.startData, mapId, seed: undefined, setups, replayCommands: undefined }),
    );
    const change = makeButton(this, bx + 2 * (bw + gap), by, bw, 60, setupData ? 'Change army' : 'Menu', () =>
      setupData ? this.scene.start('Setup', setupData) : this.scene.start('Menu'),
    );
    panel.add([rematch.container, change.container]);
  }
}
