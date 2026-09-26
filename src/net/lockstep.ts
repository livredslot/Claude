/**
 * Lockstep: keeps two players' battles identical over the network.
 *
 * Both devices run the same deterministic simulation. The only thing they exchange during
 * the battle is the players' orders. An order given at tick T is scheduled for tick
 * T + delay, and every tick each device sends one "frame" (its orders for that future tick,
 * usually none). A device only simulates tick T once it has the other player's frame for
 * T, so both apply exactly the same orders on exactly the same tick.
 *
 * No networking in here (the caller sends/receives frames), so it can be tested offline.
 */
import type { Battle } from '../sim/battle';
import type { BattleCommand, Team } from '../sim/types';

export interface InputFrame {
  tick: number;
  commands: BattleCommand[];
}

export class Lockstep {
  private pending: BattleCommand[] = [];
  /** Orders per tick, per team. */
  private readonly frames: [Map<number, BattleCommand[]>, Map<number, BattleCommand[]>] = [new Map(), new Map()];
  /** Highest tick we have already produced (and sent) our own frame for. */
  private sentUpTo: number;

  constructor(
    readonly myTeam: Team,
    /** Send one of our frames to the other player. */
    private readonly send: (frame: InputFrame) => void,
    /** Ticks between giving an order and it taking effect (hides network lag). */
    readonly delay = 4,
  ) {
    this.sentUpTo = delay - 1; // ticks below `delay` have no orders from anyone
  }

  get otherTeam(): Team {
    return this.myTeam === 0 ? 1 : 0;
  }

  /** The local player gave an order (sent with our next frame). */
  queue(command: BattleCommand): void {
    this.pending.push({ ...command });
  }

  /** A frame arrived from the other player. */
  receive(frame: InputFrame): void {
    this.frames[this.otherTeam].set(frame.tick, frame.commands);
  }

  /** Would step() be able to advance right now? */
  canStep(battle: Battle): boolean {
    const t = battle.tick;
    return t < this.delay || this.frames[this.otherTeam].has(t);
  }

  /**
   * Try to advance the battle by one tick: first send our frame for tick + delay (once),
   * then, if the other player's frame for this tick has arrived, apply both players'
   * orders (Blue's first, then Red's) and step. Returns false if still waiting.
   */
  step(battle: Battle): boolean {
    if (battle.result) return false;
    const t = battle.tick;
    while (this.sentUpTo < t + this.delay) {
      this.sentUpTo++;
      const frame: InputFrame = { tick: this.sentUpTo, commands: this.pending };
      this.pending = [];
      this.frames[this.myTeam].set(frame.tick, frame.commands);
      this.send(frame);
    }
    if (!this.canStep(battle)) return false;
    for (const team of [0, 1] as Team[]) {
      const cmds = this.frames[team].get(t);
      if (cmds) for (const c of cmds) battle.issueCommand(team, c);
      this.frames[team].delete(t);
    }
    battle.step();
    return true;
  }
}
