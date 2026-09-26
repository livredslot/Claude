/**
 * Online lobby: create a room (then pick the map and wait for a friend) or join one by code.
 * When both players are connected, both go to army setup (60 s), then battle.
 */
import Phaser from 'phaser';
import { getMap } from '../data/maps';
import {
  CODE_LENGTH,
  OnlineSession,
  getSession,
  normaliseCode,
  randomRoomCode,
  roomLink,
  setSession,
  type NetMessage,
} from '../net/session';
import { makeButton } from '../ui/button';
import { FONT, GAME_H, GAME_W } from '../ui/layout';
import type { MapSelectStartData } from './MapSelectScene';
import type { SetupStartData } from './SetupScene';

export type OnlineStartData =
  /** Choose: create or join. */
  | { action: 'menu' }
  /** Create a room on this map and wait for the friend. */
  | { action: 'host'; mapId: string }
  /** Join a room (code from a room link, or typed in). */
  | { action: 'join'; code?: string };

/** Automatic retries when a new room code happens to be taken already. */
let hostRetries = 0;

export class OnlineScene extends Phaser.Scene {
  private data0: OnlineStartData = { action: 'menu' };
  private status!: Phaser.GameObjects.Text;

  constructor() {
    super('Online');
  }

  init(data: OnlineStartData): void {
    this.data0 = data?.action ? data : { action: 'menu' };
  }

  create(): void {
    this.events.once('shutdown', () => getSession()?.setHandler(null));
    this.add.graphics().fillStyle(0x0f172a, 1).fillRect(0, 0, GAME_W, 70);
    this.add
      .text(GAME_W / 2, 35, 'Play online with a friend', { fontFamily: FONT, fontSize: '28px', color: '#f8fafc', fontStyle: 'bold' })
      .setOrigin(0.5);
    makeButton(this, 16, 8, 150, 54, '◀ Menu', () => this.scene.start('Menu'));
    this.status = this.add
      .text(GAME_W / 2, GAME_H - 90, '', { fontFamily: FONT, fontSize: '22px', color: '#fde047', align: 'center', wordWrap: { width: 1000 } })
      .setOrigin(0.5);

    const d = this.data0;
    if (d.action === 'host') this.showHost(d.mapId);
    else if (d.action === 'join' && d.code) this.startJoin(d.code);
    else this.showChoice(d.action === 'join');
  }

  // ------------------------------------------------------------------
  // Create or join
  // ------------------------------------------------------------------

  private showChoice(focusJoin: boolean): void {
    setSession(null);
    hostRetries = 0;
    const g = this.add.graphics();
    g.fillStyle(0x1e293b, 1).fillRect(60, 110, 560, 460).fillRect(660, 110, 560, 460);

    this.add.text(340, 150, 'Create a room', { fontFamily: FONT, fontSize: '30px', color: '#f8fafc', fontStyle: 'bold' }).setOrigin(0.5);
    this.add
      .text(340, 250, 'You pick the map and get a room code\nand a link to send to your friend.\nYou play Blue (left side).', {
        fontFamily: FONT,
        fontSize: '19px',
        color: '#cbd5e1',
        align: 'center',
        lineSpacing: 6,
      })
      .setOrigin(0.5);
    makeButton(this, 140, 400, 400, 80, 'Create a room  ▶', () =>
      this.scene.start('MapSelect', { mode: 'online' } satisfies MapSelectStartData), { fontSize: 26 });

    this.add.text(940, 150, 'Join a room', { fontFamily: FONT, fontSize: '30px', color: '#f8fafc', fontStyle: 'bold' }).setOrigin(0.5);
    this.add
      .text(940, 215, `Type the ${CODE_LENGTH}-letter code your friend sent you\n(or just open the link they sent). You play Red.`, {
        fontFamily: FONT,
        fontSize: '19px',
        color: '#cbd5e1',
        align: 'center',
        lineSpacing: 6,
      })
      .setOrigin(0.5);

    const input = this.add.dom(940, 330, 'input', {
      width: '260px',
      height: '64px',
      fontSize: '40px',
      fontWeight: 'bold',
      textAlign: 'center',
      letterSpacing: '10px',
      textTransform: 'uppercase',
      borderRadius: '8px',
      border: '3px solid #94a3b8',
      background: '#0f172a',
      color: '#f8fafc',
      outline: 'none',
    });
    const el = input.node as HTMLInputElement;
    el.maxLength = CODE_LENGTH + 2;
    el.placeholder = 'CODE';
    el.autocapitalize = 'characters';
    el.autocomplete = 'off';
    el.spellcheck = false;
    el.addEventListener('input', () => (el.value = normaliseCode(el.value)));
    const join = () => {
      const code = normaliseCode(el.value);
      if (code.length !== CODE_LENGTH) {
        this.status.setColor('#fca5a5').setText(`The room code has ${CODE_LENGTH} letters/numbers.`);
        return;
      }
      this.scene.start('Online', { action: 'join', code } satisfies OnlineStartData);
    };
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') join();
    });
    makeButton(this, 740, 400, 400, 80, 'Join  ▶', join, { fontSize: 26 });
    if (focusJoin) el.focus();
  }

  // ------------------------------------------------------------------
  // Host: show the code, wait for the friend
  // ------------------------------------------------------------------

  private showHost(mapId: string): void {
    const code = randomRoomCode();
    const session = OnlineSession.host(code, mapId);
    setSession(session);
    const link = roomLink(code);
    const map = getMap(mapId);

    this.add.text(GAME_W / 2, 130, 'Your room code', { fontFamily: FONT, fontSize: '24px', color: '#cbd5e1' }).setOrigin(0.5);
    this.add
      .text(GAME_W / 2, 210, code.split('').join(' '), { fontFamily: FONT, fontSize: '96px', color: '#fde047', fontStyle: 'bold' })
      .setOrigin(0.5);
    this.add
      .text(GAME_W / 2, 300, `Map: ${map.name}  ·  You play Blue (left side)`, { fontFamily: FONT, fontSize: '20px', color: '#cbd5e1' })
      .setOrigin(0.5);
    this.add
      .text(GAME_W / 2, 370, 'Send your friend the code, or this link (it joins the room directly):', {
        fontFamily: FONT,
        fontSize: '19px',
        color: '#94a3b8',
      })
      .setOrigin(0.5);
    this.add.text(GAME_W / 2, 410, link, { fontFamily: 'monospace', fontSize: '18px', color: '#93c5fd' }).setOrigin(0.5);
    const copy = makeButton(this, GAME_W / 2 - 260, 450, 250, 64, 'Copy link', () => {
      navigator.clipboard?.writeText(link).then(
        () => copy.setLabel('Copied ✓'),
        () => copy.setLabel("Couldn't copy"),
      );
    });
    makeButton(this, GAME_W / 2 + 10, 450, 250, 64, 'Share…', () => {
      if (navigator.share) navigator.share({ title: 'Mystical Armies', text: `Join my Mystical Armies room: ${code}`, url: link }).catch(() => {});
      else navigator.clipboard?.writeText(link).then(() => copy.setLabel('Copied ✓'));
    });
    makeButton(this, GAME_W / 2 - 125, 540, 250, 60, 'Cancel', () => this.scene.start('Online', { action: 'menu' } satisfies OnlineStartData));

    this.status.setText('Waiting for your friend to join…');
    session.setHandler((m) => this.onHostMessage(session, m));
  }

  private onHostMessage(session: OnlineSession, m: NetMessage): void {
    if (m.t === '_connected') {
      this.status.setColor('#86efac').setText('Your friend joined! Starting…');
      session.hostStartRound();
      this.goToSetup(session);
    } else if (m.t === '_closed') {
      if (m.reason.startsWith('That room code') && hostRetries++ < 3) {
        this.scene.restart(this.data0); // code taken: try another one
        return;
      }
      this.showError(m.reason);
    }
  }

  // ------------------------------------------------------------------
  // Guest: connect with the code, wait for the host to start
  // ------------------------------------------------------------------

  private startJoin(code: string): void {
    const session = OnlineSession.join(code);
    setSession(session);
    this.add
      .text(GAME_W / 2, 200, `Room ${code.split('').join(' ')}`, { fontFamily: FONT, fontSize: '72px', color: '#fde047', fontStyle: 'bold' })
      .setOrigin(0.5);
    this.add.text(GAME_W / 2, 290, 'You play Red (right side).', { fontFamily: FONT, fontSize: '22px', color: '#cbd5e1' }).setOrigin(0.5);
    makeButton(this, GAME_W / 2 - 125, 360, 250, 60, 'Cancel', () => this.scene.start('Online', { action: 'menu' } satisfies OnlineStartData));
    this.status.setText('Connecting…');
    session.setHandler((m) => {
      if (m.t === '_connected') this.status.setColor('#86efac').setText('Connected! Waiting for the game to start…');
      else if (m.t === 'start') this.goToSetup(session);
      else if (m.t === '_closed') this.showError(m.reason);
    });
  }

  // ------------------------------------------------------------------

  private goToSetup(session: OnlineSession): void {
    session.setHandler(null); // messages wait for the setup screen
    this.scene.start('Setup', { mode: 'online', mapId: session.mapId } satisfies SetupStartData);
  }

  private showError(reason: string): void {
    this.status.setColor('#fca5a5').setText(reason);
    makeButton(this, GAME_W / 2 - 125, GAME_H - 60, 250, 50, 'Back', () =>
      this.scene.start('Online', { action: 'menu' } satisfies OnlineStartData),
    );
  }
}
