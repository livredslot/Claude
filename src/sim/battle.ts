/**
 * The deterministic battle simulation.
 *
 * Pure game logic: no Phaser, no DOM, no timers, no Math.random().
 * Input: map + two army setups + seed. Call step() once per tick (20 per second).
 * The same inputs always give exactly the same battle on every device.
 *
 * Fairness: unit IDs interleave the teams (Blue 0, Red 1, Blue 2, ...), which
 * team moves first is picked by the seeded RNG every tick, and all damage/healing is
 * collected first and applied at the end of the tick, so both sides act
 * "simultaneously".
 */
import { C, STATS, type CompiledStats } from './compiledConfig';
import { SUB, applyPct, dist2, isqrt, rot45, rotMinus45 } from './fixed';
import { Hasher } from './hash';
import { Rng } from './rng';
import { ARMY_RULES, UNIT_TYPES } from '../config/gameConfig';
import type {
  ArmySetup,
  AttackMode,
  BattleCommand,
  RecordedCommand,
  BattleEvent,
  BattleResult,
  MapDef,
  Stance,
  Team,
  UnitPlacement,
  UnitType,
} from './types';

export interface Unit {
  readonly id: number;
  readonly team: Team;
  readonly type: UnitType;
  readonly stance: Stance;
  readonly stats: CompiledStats;
  /** Position in sub-tiles (1 tile = 1000). */
  x: number;
  y: number;
  /** Centi-HP (1 HP = 100). */
  hp: number;
  alive: boolean;
  /** Ticks until the unit may attack again. */
  cooldown: number;
  /** Has this unit had an enemy in reach yet? (First contact adds a small random delay.) */
  engaged: boolean;
  /** ID of the enemy this unit is going for, or -1. */
  targetId: number;
  retargetIn: number;
  /** Facing direction, a vector of length ~1000. */
  facingX: number;
  facingY: number;
  /** Mage: ticks of the current cast completed so far. */
  castProgress: number;
  /** 'Keep Formation' order: still marching with the block (no target found yet)? */
  inFormation: boolean;
  /** Where the unit was placed (its slot in the formation). */
  readonly startX: number;
  readonly startY: number;
  /** Flank stance: 0 = heading to edge, 1 = moving along edge, 2 = engaging. */
  flankPhase: 0 | 1 | 2;
  /** Which map edge (y in sub-tiles) the flanker uses. */
  flankEdgeY: number;
  lastAttackerId: number;
  lastAttackedTick: number;
  /** Medic: who it is healing this tick, or -1. */
  healTargetId: number;
  healersThisTick: number;
  /** Did the unit walk this tick? (Walking allies pass through each other.) */
  moved: boolean;
}

interface PendingDamage {
  target: number;
  amount: number;
  melee: boolean;
  source: number;
}

function emptyByType(): Record<UnitType, number> {
  return Object.fromEntries(UNIT_TYPES.map((t) => [t, 0])) as Record<UnitType, number>;
}

function stanceCode(s: Stance): number {
  return s === 'advance' ? 0 : 1;
}

function typeCode(t: UnitType): number {
  return UNIT_TYPES.indexOf(t);
}

/**
 * Sort placements into a canonical order so input order never matters.
 * Columns are counted from the team's own map edge, so a mirrored army gets
 * mirrored IDs (keeps the simulation fair between left and right).
 */
function canonical(units: UnitPlacement[], team: Team, mapWidth: number): UnitPlacement[] {
  const col = (p: UnitPlacement) => (team === 0 ? p.tx : mapWidth - 1 - p.tx);
  return [...units].sort(
    (a, b) =>
      col(a) - col(b) ||
      a.ty - b.ty ||
      typeCode(a.type) - typeCode(b.type) ||
      stanceCode(a.stance ?? 'advance') - stanceCode(b.stance ?? 'advance'),
  );
}

export class Battle {
  readonly map: MapDef;
  readonly seed: number;
  /** Indexed by unit ID. */
  readonly units: Unit[] = [];
  tick = 0;
  /** Events produced during the last step (for drawing effects). */
  readonly events: BattleEvent[] = [];
  result: BattleResult | null = null;

  readonly unitsLost: [number, number] = [0, 0];
  /** In centi-HP. */
  private readonly damageByType: [Record<UnitType, number>, Record<UnitType, number>] = [
    emptyByType(),
    emptyByType(),
  ];

  /** Unit ID of each team's King, or -1 if the army has none. */
  readonly kingIds: [number, number] = [-1, -1];
  /** Current attack order per team. */
  readonly modes: [AttackMode, AttackMode] = ['auto', 'auto'];
  /** How far (sub-tiles) each team's Keep-formation block has marched forward. */
  readonly formationOffset: [number, number] = [0, 0];
  /** Enemy unit each team is focusing on, or -1. */
  readonly focus: [number, number] = [-1, -1];
  /** Every order given so far, for replays and (later) sending to the other player. */
  readonly commandLog: RecordedCommand[] = [];
  private readonly rng: Rng;
  private readonly widthSub: number;
  private readonly heightSub: number;
  private pendingDamage: PendingDamage[] = [];
  private pendingHeal: { target: number; amount: number }[] = [];

  constructor(map: MapDef, setups: [ArmySetup, ArmySetup], seed: number) {
    this.map = map;
    this.seed = seed >>> 0;
    this.rng = new Rng(this.seed);
    this.widthSub = map.width * SUB;
    this.heightSub = map.height * SUB;

    const lists = [canonical(setups[0].units, 0, map.width), canonical(setups[1].units, 1, map.width)];
    const longest = Math.max(lists[0].length, lists[1].length);
    for (let i = 0; i < longest; i++) {
      for (const team of [0, 1] as Team[]) {
        const p = lists[team][i];
        if (p) this.addUnit(team, p);
      }
    }
  }

  private addUnit(team: Team, p: UnitPlacement): void {
    const id = this.units.length;
    const stats = STATS[p.type];
    if (p.type === 'king' && this.kingIds[team] < 0) this.kingIds[team] = id;
    const y = p.ty * SUB + SUB / 2;
    this.units.push({
      id,
      team,
      type: p.type,
      stance: p.stance ?? 'advance',
      stats,
      x: p.tx * SUB + SUB / 2,
      y,
      hp: stats.maxHp,
      alive: true,
      cooldown: 0,
      engaged: false,
      targetId: -1,
      retargetIn: 0,
      facingX: team === 0 ? 1000 : -1000,
      facingY: 0,
      castProgress: 0,
      inFormation: false,
      startX: p.tx * SUB + SUB / 2,
      startY: y,
      flankPhase: 0,
      flankEdgeY: y < this.heightSub / 2 ? C.flankEdgeOffset : this.heightSub - C.flankEdgeOffset,
      lastAttackerId: -1,
      lastAttackedTick: -1000,
      healTargetId: -1,
      healersThisTick: 0,
      moved: false,
    });
  }

  get maxTicks(): number {
    return C.maxTicks;
  }

  /** +1 for Blue (moves right), −1 for Red (moves left). */
  private forward(team: Team): number {
    return team === 0 ? 1 : -1;
  }

  // ------------------------------------------------------------------
  // Player orders
  // ------------------------------------------------------------------

  /**
   * Give an order. It takes effect from the next step() and is recorded (with
   * the current tick) so a replay can re-issue it at exactly the same moment.
   * Returns false if the order is invalid (e.g. focusing a dead or friendly unit).
   */
  issueCommand(team: Team, command: BattleCommand): boolean {
    if (this.result) return false;
    if (command.kind === 'focus' && command.target >= 0) {
      const t = this.units[command.target];
      if (!t || !t.alive || t.team === team) return false;
    }
    if (command.kind === 'mode') this.modes[team] = command.mode;
    else this.focus[team] = command.target;
    this.commandLog.push({ tick: this.tick, team, command: { ...command } });

    const formation = this.modes[team] === 'formation' && this.focus[team] < 0;
    for (const u of this.units) {
      if (u.team !== team) continue;
      u.retargetIn = 0; // re-think targets on the next tick
      u.flankPhase = 2; // any order overrides the Flank stance
      u.inFormation = false;
    }
    if (formation) this.formUp(team);
    return true;
  }

  /**
   * Start 'Keep Formation': every fighter rejoins the block, which re-forms
   * around where the army is now (the average distance marched so far).
   */
  private formUp(team: Team): void {
    const fwd = this.forward(team);
    let sum = 0;
    let n = 0;
    for (const u of this.units) {
      if (!u.alive || u.team !== team || u.type === 'king' || u.type === 'medic') continue;
      u.inFormation = true;
      sum += (u.x - u.startX) * fwd;
      n++;
    }
    this.formationOffset[team] = n ? Math.max(0, Math.trunc(sum / n)) : 0;
  }

  /** The enemy the team's orders point at (focus first, then the King in 'king' mode), or null. */
  private orderedTarget(team: Team): Unit | null {
    const f = this.focus[team];
    if (f >= 0 && this.units[f].alive) return this.units[f];
    if (this.modes[team] === 'king') return this.king(team === 0 ? 1 : 0);
    return null;
  }

  // ------------------------------------------------------------------
  // Main loop
  // ------------------------------------------------------------------

  /** Advance the battle by one tick (1/20 s). Does nothing once finished. */
  step(): void {
    if (this.result) return;
    this.events.length = 0;
    this.tick++;
    const units = this.units;
    const n = units.length;

    for (const u of units) {
      u.healersThisTick = 0;
      u.healTargetId = -1;
      u.moved = false;
    }

    for (const u of units) if (u.alive) this.updateTarget(u);
    this.advanceFormations();

    // IDs interleave the teams (Blue 0, Red 1, Blue 2, ...). Each tick the seeded RNG
    // decides whether to swap every Blue/Red pair (1, 0, 3, 2, ...), so neither team
    // systematically moves first. (A fixed alternation locks onto the even attack intervals.)
    const swapPairs = this.rng.int(2) === 1;
    for (let i = 0; i < n; i++) {
      const j = swapPairs && (i ^ 1) < n ? i ^ 1 : i;
      const u = units[j];
      if (u.alive) this.act(u);
    }

    this.separateAllies();
    this.resolve();
    this.checkEnd();
  }

  /** Run until the battle ends and return the result. */
  runToEnd(): BattleResult {
    while (!this.result) this.step();
    return this.result;
  }

  // ------------------------------------------------------------------
  // Targeting
  // ------------------------------------------------------------------

  private updateTarget(u: Unit): void {
    if (u.type === 'medic') return; // Medics choose heal targets each tick instead.
    const current = u.targetId >= 0 ? this.units[u.targetId] : null;
    u.retargetIn--;
    if (current && current.alive && u.retargetIn > 0) return;
    u.targetId = this.chooseTarget(u);
    // Stagger retarget timing by ID so not everyone re-thinks on the same tick.
    u.retargetIn = current ? C.retargetTicks : C.retargetTicks - ((u.id >> 1) % C.retargetTicks);
  }

  /**
   * Every unit simply fights the nearest enemy. Only the player's orders
   * (focus an enemy, or 'Attack King') override that.
   */
  private chooseTarget(u: Unit): number {
    if (u.type === 'king') {
      // The King only fights enemies that come close (it follows behind the army).
      return this.nearestEnemy(u, undefined, C.kingEngageSq);
    }
    const ordered = this.orderedTarget(u.team);
    if (ordered) return ordered.id;
    return this.nearestEnemy(u);
  }


  /** Nearest living enemy (ties → lowest ID), optionally filtered and limited to a range. */
  private nearestEnemy(u: Unit, filter?: (e: Unit) => boolean, maxDistSq = Infinity): number {
    let best = -1;
    let bestD = maxDistSq;
    for (const e of this.units) {
      if (!e.alive || e.team === u.team) continue;
      if (filter && !filter(e)) continue;
      const d = dist2(u.x, u.y, e.x, e.y);
      if (d < bestD || (d === bestD && best < 0)) {
        best = e.id;
        bestD = d;
      }
    }
    return best;
  }

  /** The team's living King, or null. */
  king(team: Team): Unit | null {
    const id = this.kingIds[team];
    return id >= 0 && this.units[id].alive ? this.units[id] : null;
  }

  private anyEnemyWithin(u: Unit, distSq: number): boolean {
    for (const e of this.units) {
      if (e.alive && e.team !== u.team && dist2(u.x, u.y, e.x, e.y) <= distSq) return true;
    }
    return false;
  }

  private inRange(u: Unit, t: Unit): boolean {
    return dist2(u.x, u.y, t.x, t.y) <= u.stats.rangeSq;
  }

  // ------------------------------------------------------------------
  // Actions
  // ------------------------------------------------------------------

  private act(u: Unit): void {
    if (u.cooldown > 0) u.cooldown--;

    if (u.type === 'medic') {
      this.actMedic(u);
      return;
    }
    if (u.type === 'king') {
      this.actKing(u);
      return;
    }

    // 'Keep Formation' order: march with the block until a target is found.
    if (u.inFormation) {
      const engageSq = u.stats.ranged ? u.stats.rangeSq : C.formationEngageSq;
      if (this.anyEnemyWithin(u, engageSq)) {
        u.inFormation = false;
      } else {
        const slotX = u.startX + this.forward(u.team) * this.formationOffset[u.team];
        this.moveToward(u, slotX, u.startY);
        return;
      }
    }

    // Flank stance: walk along the nearest map edge toward the enemy side first.
    if (u.stance === 'flank' && u.flankPhase < 2) {
      if (this.anyEnemyWithin(u, C.flankEngageSq)) {
        u.flankPhase = 2;
      } else {
        this.flankMove(u);
        return;
      }
    }

    const t = u.targetId >= 0 ? this.units[u.targetId] : null;
    if (!t || !t.alive) return;

    if (u.type === 'mage') {
      this.actMage(u, t);
      return;
    }

    if (this.inRange(u, t)) {
      this.face(u, t.x - u.x, t.y - u.y);
      if (this.readyToAttack(u)) this.attack(u, t);
    } else {
      this.moveToward(u, t.x, t.y);
    }
  }

  /**
   * The first time a unit gets an enemy in reach it hesitates for a random
   * moment (seeded RNG), so fights don't play out in perfect lockstep.
   * Returns true if the unit may attack now.
   */
  private readyToAttack(u: Unit): boolean {
    if (!u.engaged) {
      u.engaged = true;
      u.cooldown = this.rng.int(C.initialJitterTicks + 1);
    }
    return u.cooldown === 0;
  }

  private attack(u: Unit, t: Unit): void {
    let dmg = u.stats.damage;
    if (u.type === 'spearman' && t.type === 'horseman') dmg *= C.spearmanVsHorseMult;
    if (u.type === 'archer' && t.type === 'swordsman') dmg = applyPct(dmg, C.swordsmanArrowPct);
    const melee = !u.stats.ranged;
    this.pendingDamage.push({ target: t.id, amount: dmg, melee, source: u.id });
    this.events.push({ kind: melee ? 'melee' : 'arrow', from: u.id, to: t.id });
    u.cooldown = u.stats.attackTicks;
  }

  // ---- Keep Formation order ----

  /**
   * Move each team's formation block forward at the speed of its slowest unit
   * still in formation, so the block keeps its shape.
   */
  private advanceFormations(): void {
    for (const team of [0, 1] as Team[]) {
      let speed = Infinity;
      for (const u of this.units) {
        if (u.alive && u.team === team && u.inFormation) speed = Math.min(speed, u.stats.speed);
      }
      if (speed !== Infinity) this.formationOffset[team] += speed;
    }
  }

  // ---- King ----

  private actKing(u: Unit): void {
    const t = u.targetId >= 0 ? this.units[u.targetId] : null;
    if (t && t.alive && dist2(u.x, u.y, t.x, t.y) <= C.kingEngageSq) {
      if (this.inRange(u, t)) {
        this.face(u, t.x - u.x, t.y - u.y);
        if (this.readyToAttack(u)) this.attack(u, t);
      } else {
        this.moveToward(u, t.x, t.y);
      }
      return;
    }
    const centre = this.armyCentre(u.team);
    if (!centre) {
      // The King is the last fighter left: it has to attack.
      const id = this.nearestEnemy(u);
      if (id < 0) return;
      const e = this.units[id];
      if (this.inRange(u, e)) {
        this.face(u, e.x - u.x, e.y - u.y);
        if (this.readyToAttack(u)) this.attack(u, e);
      } else {
        this.moveToward(u, e.x, e.y);
      }
      return;
    }
    // Follow the army, staying a few tiles behind its centre.
    const gx = centre.x - this.forward(u.team) * C.kingBehind;
    const gy = centre.y;
    if (dist2(u.x, u.y, gx, gy) > C.kingFollowSlackSq) this.moveToward(u, gx, gy);
  }

  /** Average position of a team's living fighters (not the King, not Medics), or null. */
  private armyCentre(team: Team): { x: number; y: number } | null {
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (const a of this.units) {
      if (!a.alive || a.team !== team || a.type === 'medic' || a.type === 'king') continue;
      sx += a.x;
      sy += a.y;
      n++;
    }
    return n ? { x: Math.trunc(sx / n), y: Math.trunc(sy / n) } : null;
  }

  // ---- Mage ----

  private actMage(u: Unit, t: Unit): void {
    // With an order, walk until the ordered target itself is in range.
    const ordered = this.orderedTarget(u.team);
    const canCast = ordered ? this.inRange(u, ordered) : this.anyEnemyWithin(u, u.stats.rangeSq);
    if (canCast) {
      this.progressCast(u);
    } else {
      // Moving cancels the cast.
      u.castProgress = 0;
      this.moveToward(u, t.x, t.y);
    }
  }

  private progressCast(u: Unit): void {
    if (!this.readyToAttack(u)) return;
    u.castProgress++;
    if (u.castProgress < u.stats.attackTicks) return;
    u.castProgress = 0;
    const ordered = this.orderedTarget(u.team);
    const center = ordered && this.inRange(u, ordered) ? { x: ordered.x, y: ordered.y } : this.bestCastPoint(u);
    if (!center) return;
    this.face(u, center.x - u.x, center.y - u.y);
    for (const e of this.units) {
      if (!e.alive || e.team === u.team) continue; // No friendly fire.
      if (dist2(center.x, center.y, e.x, e.y) <= C.mageRadiusSq) {
        this.pendingDamage.push({ target: e.id, amount: u.stats.damage, melee: false, source: u.id });
      }
    }
    this.events.push({ kind: 'spell', from: u.id, x: center.x, y: center.y, radius: C.mageRadius });
  }

  /** Among enemies in range, the position whose blast would hit the most enemies. */
  private bestCastPoint(u: Unit): { x: number; y: number } | null {
    let best: Unit | null = null;
    let bestCount = 0;
    for (const c of this.units) {
      if (!c.alive || c.team === u.team || !this.inRange(u, c)) continue;
      let count = 0;
      for (const e of this.units) {
        if (e.alive && e.team !== u.team && dist2(c.x, c.y, e.x, e.y) <= C.mageRadiusSq) count++;
      }
      if (count > bestCount) {
        best = c;
        bestCount = count;
      }
    }
    return best ? { x: best.x, y: best.y } : null;
  }

  // ---- Medic ----

  private actMedic(u: Unit): void {
    // 1. Heal the lowest-HP% injured ally in radius (max N medics per ally).
    const healTarget = this.lowestHpAlly(u, C.healRadiusSq, true);
    if (healTarget) {
      healTarget.healersThisTick++;
      u.healTargetId = healTarget.id;
      this.pendingHeal.push({ target: healTarget.id, amount: C.healPerTick });
    }

    // 2. Only fight back against a recent attacker.
    const attacker = u.lastAttackerId >= 0 ? this.units[u.lastAttackerId] : null;
    if (
      attacker &&
      attacker.alive &&
      this.tick - u.lastAttackedTick <= C.medicFightBackTicks &&
      this.inRange(u, attacker)
    ) {
      this.face(u, attacker.x - u.x, attacker.y - u.y);
      if (this.readyToAttack(u)) this.attack(u, attacker);
      return;
    }

    // 3. Move: toward injured fighters nearby, otherwise follow the centre of the army
    //    (not the King); always stay behind the front line.
    const follow =
      this.lowestHpAlly(u, C.medicSeekRangeSq, false, true) ?? this.armyCentre(u.team) ?? this.nearestFighterAlly(u);
    if (!follow) return;
    const fwd = this.forward(u.team);
    let gx = follow.x - fwd * C.medicBehind;
    const front = this.frontLineX(u.team);
    if (front !== null) {
      const limit = front - fwd * C.medicBehind;
      gx = fwd > 0 ? Math.min(gx, limit) : Math.max(gx, limit);
    }
    const gy = follow.y;
    // Already close enough: stand still (avoids jitter).
    if (dist2(u.x, u.y, gx, gy) <= (SUB / 2) * (SUB / 2)) return;
    this.moveToward(u, gx, gy);
  }

  /** Injured ally (not self) with the lowest HP%, within range. */
  private lowestHpAlly(u: Unit, distSq: number, respectHealerCap: boolean, fightersOnly = false): Unit | null {
    let best: Unit | null = null;
    for (const a of this.units) {
      if (!a.alive || a.team !== u.team || a.id === u.id) continue;
      if (fightersOnly && (a.type === 'king' || a.type === 'medic')) continue;
      if (a.hp >= a.stats.maxHp) continue;
      if (respectHealerCap && a.healersThisTick >= C.maxMedicsPerTarget) continue;
      if (dist2(u.x, u.y, a.x, a.y) > distSq) continue;
      // Compare hp% without division: a.hp/a.max < b.hp/b.max
      if (!best || a.hp * best.stats.maxHp < best.hp * a.stats.maxHp) best = a;
    }
    return best;
  }

  private nearestFighterAlly(u: Unit): Unit | null {
    let best: Unit | null = null;
    let bestD = Infinity;
    for (const a of this.units) {
      if (!a.alive || a.team !== u.team || a.type === 'medic') continue;
      const d = dist2(u.x, u.y, a.x, a.y);
      if (d < bestD) {
        best = a;
        bestD = d;
      }
    }
    return best;
  }

  /** X of the most forward living fighter (not Medics or the King). */
  private frontLineX(team: Team): number | null {
    let front: number | null = null;
    const fwd = this.forward(team);
    for (const a of this.units) {
      if (!a.alive || a.team !== team || a.type === 'medic' || a.type === 'king') continue;
      if (front === null || a.x * fwd > front * fwd) front = a.x;
    }
    return front;
  }

  // ---- Flank ----

  private flankMove(u: Unit): void {
    const fwd = this.forward(u.team);
    if (u.flankPhase === 0) {
      if (Math.abs(u.y - u.flankEdgeY) <= SUB / 2) {
        u.flankPhase = 1;
      } else {
        this.moveToward(u, u.x + fwd * 2 * SUB, u.flankEdgeY);
        return;
      }
    }
    // Phase 1: along the edge until the enemy's deployment zone.
    const zone = ARMY_RULES.deployColumns * SUB;
    const goalX = u.team === 0 ? this.widthSub - zone - SUB / 2 : zone + SUB / 2;
    if (Math.abs(u.x - goalX) <= SUB) {
      u.flankPhase = 2;
      return;
    }
    this.moveToward(u, goalX, u.flankEdgeY);
  }

  // ------------------------------------------------------------------
  // Movement
  // ------------------------------------------------------------------

  private face(u: Unit, dx: number, dy: number): void {
    const len = isqrt(dx * dx + dy * dy);
    if (len === 0) return;
    u.facingX = Math.trunc((dx * 1000) / len);
    u.facingY = Math.trunc((dy * 1000) / len);
  }

  /**
   * Step toward (gx, gy). If the direct step is blocked by another unit, try
   * sliding at ±45° then ±90° (the side that gets closer to the goal first).
   */
  private moveToward(u: Unit, gx: number, gy: number): boolean {
    const dx = gx - u.x;
    const dy = gy - u.y;
    const d2 = dx * dx + dy * dy;
    if (d2 === 0) return false;
    const d = isqrt(d2);
    const sp = u.stats.speed;
    let sx: number;
    let sy: number;
    if (d <= sp) {
      sx = dx;
      sy = dy;
    } else {
      sx = Math.trunc((dx * sp) / d);
      sy = Math.trunc((dy * sp) / d);
    }

    const candidates: [number, number][] = [[sx, sy]];
    const pairs: [number, number][][] = [
      [rot45(sx, sy), rotMinus45(sx, sy)],
      [
        [-sy, sx],
        [sy, -sx],
      ],
    ];
    for (const [a, b] of pairs) {
      const da = dist2(u.x + a[0], u.y + a[1], gx, gy);
      const db = dist2(u.x + b[0], u.y + b[1], gx, gy);
      // Prefer the side that gets closer. On a tie, alternate between units, mirrored
      // per team (so a mirrored army dodges in the mirrored direction).
      const preferA = ((u.id >> 1) & 1) === u.team;
      if (da < db || (da === db && preferA)) candidates.push(a, b);
      else candidates.push(b, a);
    }

    const r = C.unitRadius;
    for (const [cx, cy] of candidates) {
      if (cx === 0 && cy === 0) continue;
      const nx = Math.min(Math.max(u.x + cx, r), this.widthSub - r);
      const ny = Math.min(Math.max(u.y + cy, r), this.heightSub - r);
      if (nx === u.x && ny === u.y) continue;
      if (this.isFree(u, nx, ny)) {
        u.x = nx;
        u.y = ny;
        u.moved = true;
        this.face(u, cx, cy);
        return true;
      }
    }
    return false;
  }

  /**
   * A move is allowed if it doesn't bring the unit into (or deeper into) overlap
   * with an ENEMY. Allies don't block each other, so fast units can pass slower
   * ones; separateAllies() then gently pushes overlapping allies apart.
   */
  private isFree(u: Unit, nx: number, ny: number): boolean {
    for (const o of this.units) {
      if (!o.alive || o.team === u.team) continue;
      const nd = dist2(nx, ny, o.x, o.y);
      if (nd < C.minSeparationSq && nd <= dist2(u.x, u.y, o.x, o.y)) return false;
    }
    return true;
  }

  /**
   * Push overlapping allies apart a little each tick (all pushes computed first,
   * then applied). Only units that stood still this tick (fighting or waiting) are
   * pushed, so walking units pass through their own army instead of shoving it.
   */
  private separateAllies(): void {
    const units = this.units;
    const n = units.length;
    const shiftX = new Array<number>(n).fill(0);
    const shiftY = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
      const a = units[i];
      if (!a.alive || a.moved) continue;
      for (let j = i + 1; j < n; j++) {
        const b = units[j];
        if (!b.alive || b.moved || b.team !== a.team) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= C.minSeparationSq) continue;
        const d = isqrt(d2);
        // Each unit moves a quarter of the overlap per tick: smooth, not jumpy.
        const push = Math.trunc((C.minSeparation - d) / 4);
        let ux = 0;
        let uy = 1000; // exactly on top of each other: split vertically
        if (d > 0) {
          ux = Math.trunc((dx * 1000) / d);
          uy = Math.trunc((dy * 1000) / d);
        }
        const px = Math.trunc((ux * push) / 1000);
        const py = Math.trunc((uy * push) / 1000);
        shiftX[i] -= px;
        shiftY[i] -= py;
        shiftX[j] += px;
        shiftY[j] += py;
      }
    }
    const r = C.unitRadius;
    for (let i = 0; i < n; i++) {
      if (shiftX[i] === 0 && shiftY[i] === 0) continue;
      const u = units[i];
      u.x = Math.min(Math.max(u.x + shiftX[i], r), this.widthSub - r);
      u.y = Math.min(Math.max(u.y + shiftY[i], r), this.heightSub - r);
    }
  }

  // ------------------------------------------------------------------
  // End of tick
  // ------------------------------------------------------------------

  private resolve(): void {
    for (const p of this.pendingDamage) {
      const t = this.units[p.target];
      if (!t.alive || t.hp <= 0) continue;
      const src = this.units[p.source];
      this.damageByType[src.team][src.type] += Math.min(p.amount, t.hp);
      t.hp -= p.amount;
      t.lastAttackerId = src.id;
      t.lastAttackedTick = this.tick;
      t.inFormation = false; // being hit means a target has been found
      // Melee damage interrupts a Mage's cast; it must start over.
      if (p.melee && t.type === 'mage' && t.castProgress > 0) {
        t.castProgress = 0;
        this.events.push({ kind: 'interrupt', unit: t.id });
      }
    }
    for (const t of this.units) {
      if (t.alive && t.hp <= 0) {
        t.hp = 0;
        t.alive = false;
        t.castProgress = 0;
        this.unitsLost[t.team]++;
        this.events.push({ kind: 'death', unit: t.id });
        // A focused enemy died: that team goes back to its normal orders.
        for (const team of [0, 1] as Team[]) if (this.focus[team] === t.id) this.focus[team] = -1;
      }
    }
    for (const h of this.pendingHeal) {
      const t = this.units[h.target];
      if (t.alive) t.hp = Math.min(t.stats.maxHp, t.hp + h.amount);
    }
    this.pendingDamage = [];
    this.pendingHeal = [];
  }

  /** Remaining army value ×1000: sum of (unit value × HP%) over living units. */
  armyValue(team: Team): number {
    let v = 0;
    for (const u of this.units) {
      if (u.alive && u.team === team) v += Math.floor((u.stats.value * u.hp * 1000) / u.stats.maxHp);
    }
    return v;
  }

  aliveCount(team: Team): number {
    let n = 0;
    for (const u of this.units) if (u.alive && u.team === team) n++;
    return n;
  }

  private checkEnd(): void {
    const a0 = this.aliveCount(0);
    const a1 = this.aliveCount(1);
    // A team whose King has fallen loses immediately (like checkmate).
    const kingDead = [0, 1].map((t) => this.kingIds[t] >= 0 && !this.units[this.kingIds[t]].alive);
    let winner: Team | null;
    let reason: BattleResult['reason'];
    if (kingDead[0] || kingDead[1]) {
      reason = 'king';
      winner = kingDead[0] && kingDead[1] ? null : kingDead[0] ? 1 : 0;
    } else if (a0 === 0 || a1 === 0) {
      reason = 'annihilation';
      winner = a0 === 0 && a1 === 0 ? null : a0 === 0 ? 1 : 0;
    } else if (this.tick >= C.maxTicks) {
      reason = 'timeout';
      const v0 = this.armyValue(0);
      const v1 = this.armyValue(1);
      winner = v0 === v1 ? null : v0 > v1 ? 0 : 1;
    } else {
      return;
    }
    const toHp = (r: Record<UnitType, number>) =>
      Object.fromEntries(UNIT_TYPES.map((t) => [t, Math.round(r[t] / 100)])) as Record<UnitType, number>;
    this.result = {
      winner,
      reason,
      tick: this.tick,
      values: [this.armyValue(0), this.armyValue(1)],
      unitsLost: [this.unitsLost[0], this.unitsLost[1]],
      damageByType: [toHp(this.damageByType[0]), toHp(this.damageByType[1])],
      hash: this.stateHash(),
    };
  }

  /** Hash of the full battle state. Identical on every device for identical inputs. */
  stateHash(): number {
    const h = new Hasher();
    h.add(this.tick);
    h.add(this.modes[0] === 'king' ? 1 : 0).add(this.modes[1] === 'king' ? 1 : 0);
    h.add(this.focus[0]).add(this.focus[1]);
    for (const u of this.units) {
      h.add(u.id)
        .add(u.team)
        .add(typeCode(u.type))
        .add(u.alive ? 1 : 0)
        .add(u.hp)
        .add(u.x)
        .add(u.y)
        .add(u.cooldown)
        .add(u.engaged ? 1 : 0)
        .add(u.targetId)
        .add(u.castProgress)
        .add(u.inFormation ? 1 : 0)
        .add(u.facingX)
        .add(u.facingY);
    }
    return h.digest();
  }
}

/**
 * Re-issue recorded orders that were given at the battle's current tick.
 * Call before each step(); `next` is the index of the first order not yet applied.
 * Returns the new index.
 */
export function applyRecordedCommands(battle: Battle, commands: readonly RecordedCommand[], next: number): number {
  while (next < commands.length && commands[next].tick <= battle.tick) {
    const c = commands[next++];
    battle.issueCommand(c.team, c.command);
  }
  return next;
}

/** Convenience: run a whole battle headless (optionally with recorded orders). */
export function simulateBattle(
  map: MapDef,
  setups: [ArmySetup, ArmySetup],
  seed: number,
  commands: readonly RecordedCommand[] = [],
): BattleResult {
  const b = new Battle(map, setups, seed);
  let next = 0;
  while (!b.result) {
    next = applyRecordedCommands(b, commands, next);
    b.step();
  }
  return b.result;
}
