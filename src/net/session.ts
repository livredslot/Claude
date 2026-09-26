/**
 * An online game between two players, connected directly device-to-device (WebRTC) with
 * PeerJS. PeerJS's free public server is only used to find each other via the room code;
 * after that, game messages go straight between the two devices.
 *
 * The host creates the room (plays Blue, on the left) and picks the map; the guest joins
 * with the room code (plays Red, on the right).
 *
 * Messages are handed to ONE handler at a time (the current screen). Messages that arrive
 * while no handler is set (e.g. while switching screens) are kept and delivered later.
 */
import Peer, { type DataConnection } from 'peerjs';
import type { ArmySetup, Team } from '../sim/types';
import type { InputFrame } from './lockstep';

/** Bump when the online messages or the simulation change, so old and new versions don't play each other. */
export const NET_VERSION = 3;
const ID_PREFIX = 'mystical-armies-v3-';
/** Letters and digits that can't be confused with each other (no O/0, I/1/L). */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 4;
const CONNECT_TIMEOUT_MS = 20000;

export type NetMessage =
  | { t: 'hello'; version: number }
  | { t: 'start'; round: number; mapId: string; seed: number }
  | { t: 'commit'; round: number; hash: string }
  | { t: 'reveal'; round: number; setup: ArmySetup; salt: string }
  | { t: 'frame'; frame: InputFrame }
  | { t: 'hash'; tick: number; hash: number }
  | { t: 'again' }
  | { t: 'leave' }
  // Local events (never sent over the network):
  | { t: '_connected' }
  | { t: '_closed'; reason: string };

export function randomRoomCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return code;
}

/** Clean up what a player typed: upper case, only valid characters. */
export function normaliseCode(text: string): string {
  return [...text.toUpperCase()].filter((c) => CODE_ALPHABET.includes(c)).join('').slice(0, CODE_LENGTH);
}

/** The link that opens the game and joins this room directly. */
export function roomLink(code: string): string {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('room', code);
  return url.toString();
}

export class OnlineSession {
  readonly role: 'host' | 'guest';
  readonly code: string;
  /** Chosen by the host; sent to the guest with 'start'. */
  mapId = '';
  seed = 0;
  round = 0;
  connected = false;
  closed = false;

  private peer: Peer;
  private conn: DataConnection | null = null;
  private handler: ((m: NetMessage) => void) | null = null;
  private queue: NetMessage[] = [];
  private timeout: ReturnType<typeof setTimeout> | null = null;

  private constructor(role: 'host' | 'guest', code: string) {
    this.role = role;
    this.code = code;
    this.peer = role === 'host' ? new Peer(ID_PREFIX + code, { debug: 0 }) : new Peer({ debug: 0 });
    this.peer.on('error', (err) => {
      const type = (err as { type?: string }).type;
      if (type === 'unavailable-id') this.fail('That room code is already in use. Try again.');
      else if (type === 'peer-unavailable') this.fail(`No room with code ${this.code}. Check the code and that your friend is still waiting.`);
      else if (type === 'network' || type === 'server-error' || type === 'socket-error' || type === 'socket-closed')
        this.fail(this.connected ? 'Connection problem.' : 'Could not reach the connection server. Check your internet.');
      else if (!this.connected) this.fail(`Could not connect (${type ?? 'error'}).`);
    });
    window.addEventListener('beforeunload', this.onUnload);
  }

  /** Blue side: create a room and wait for a friend. */
  static host(code: string, mapId: string): OnlineSession {
    const s = new OnlineSession('host', code);
    s.mapId = mapId;
    s.peer.on('connection', (conn) => {
      if (s.conn || s.closed) {
        conn.on('open', () => conn.close()); // room is full
        return;
      }
      s.attach(conn);
    });
    return s;
  }

  /** Red side: join a friend's room by its code. */
  static join(code: string): OnlineSession {
    const s = new OnlineSession('guest', code);
    s.peer.on('open', () => {
      if (s.closed) return;
      s.attach(s.peer.connect(ID_PREFIX + code, { reliable: true, serialization: 'json' }));
    });
    s.timeout = setTimeout(() => {
      if (!s.connected) s.fail(`Could not connect to room ${code}. Check the code and try again.`);
    }, CONNECT_TIMEOUT_MS);
    return s;
  }

  get myTeam(): Team {
    return this.role === 'host' ? 0 : 1;
  }

  private attach(conn: DataConnection): void {
    this.conn = conn;
    conn.on('open', () => this.send({ t: 'hello', version: NET_VERSION }));
    conn.on('data', (data) => this.onData(data as NetMessage));
    conn.on('close', () => this.fail('Your friend left the game.'));
    conn.on('error', () => this.fail('Connection problem.'));
  }

  private onData(m: NetMessage): void {
    if (this.closed || !m || typeof m !== 'object') return;
    if (m.t === 'hello') {
      if (m.version !== NET_VERSION) {
        this.fail('You and your friend have different versions of the game. Both refresh the page and try again.');
        return;
      }
      if (!this.connected) {
        this.connected = true;
        if (this.timeout) clearTimeout(this.timeout);
        this.deliver({ t: '_connected' });
      }
      return;
    }
    if (m.t === 'leave') {
      this.fail('Your friend left the game.');
      return;
    }
    if (m.t === 'start') {
      this.round = m.round;
      this.mapId = m.mapId;
      this.seed = m.seed;
    }
    this.deliver(m);
  }

  /** Host only: start the next round (new battle seed) and tell the guest. */
  hostStartRound(): void {
    this.round++;
    this.seed = Math.floor(Math.random() * 0xffffffff) >>> 0;
    this.send({ t: 'start', round: this.round, mapId: this.mapId, seed: this.seed });
  }

  send(m: NetMessage): void {
    if (!this.closed && this.conn?.open) this.conn.send(m);
  }

  /** The current screen's message handler (null while switching screens: messages wait). */
  setHandler(handler: ((m: NetMessage) => void) | null): void {
    this.handler = handler;
    while (this.handler && this.queue.length) this.handler(this.queue.shift()!);
  }

  private deliver(m: NetMessage): void {
    if (this.handler) this.handler(m);
    else this.queue.push(m);
  }

  private fail(reason: string): void {
    if (this.closed) return;
    this.closeQuietly();
    this.deliver({ t: '_closed', reason });
  }

  private closeQuietly(): void {
    this.closed = true;
    if (this.timeout) clearTimeout(this.timeout);
    window.removeEventListener('beforeunload', this.onUnload);
    try {
      this.conn?.close();
      this.peer.destroy();
    } catch {
      // already gone
    }
  }

  private onUnload = () => this.send({ t: 'leave' });

  /** Leave the game on purpose (tells the friend). */
  leave(): void {
    this.send({ t: 'leave' });
    // Give the message a moment to go out before closing the connection.
    setTimeout(() => this.closeQuietly(), 200);
    this.closed = true;
  }
}

/** The online game in progress, shared by the screens. */
let current: OnlineSession | null = null;

export function getSession(): OnlineSession | null {
  return current;
}

export function setSession(s: OnlineSession | null): void {
  if (current && current !== s && !current.closed) current.leave();
  current = s;
}
