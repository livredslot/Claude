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
  /** Hold stance: has an enemy come close enough to release the unit? */
  holdReleased: boolean;
  /** Flank stance: 0 = heading to edge, 1 = moving along edge, 2 = engaging. */
  flankPhase: 0 | 1 | 2;
  /** Which map edge (y in sub-tiles) the flanker uses. */
  flankEdgeY: number;
  /** Starting position (the King stays near it). */
  readonly homeX: number;
  readonly homeY: number;
  lastAttackerId: number;
  lastAttackedTick: number;
  /** Medic: who it is healing this tick, or -1. */
  healTargetId: number;
  healersThisTick: number;
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
  return s === 'advance' ? 0 : s === 'hold' ? 1 : 2;
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
      holdReleased: false,
      flankPhase: 0,
      flankEdgeY: y < this.heightSub / 2 ? C.flankEdgeOffset : this.heightSub - C.flankEdgeOffset,
      homeX: p.tx * SUB + SUB / 2,
      homeY: y,
      lastAttackerId: -1,
      lastAttackedTick: -1000,
      healTargetId: -1,
      healersThisTick: 0,
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
    }

    for (const u of units) if (u.alive) this.updateTarget(u);

    // IDs interleave the teams (Blue 0, Red 1, Blue 2, ...). Each tick the seeded RNG
    // decides whether to swap every Blue/Red pair (1, 0, 3, 2, ...), so neither team
    // systematically moves first. (A fixed alternation locks onto the even attack intervals.)
    const swapPairs = this.rng.int(2) === 1;
    for (let i = 0; i < n; i++) {
      const j = swapPairs && (i ^ 1) < n ? i ^ 1 : i;
      const u = units[j];
      if (u.alive) this.act(u);
    }

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

  private chooseTarget(u: Unit): number {
    if (u.type === 'king') {
      // The King only fights enemies that come close.
      return this.nearestEnemy(u, undefined, C.kingEngageSq);
    }

    // 1. Defend: an enemy near our King that we can reach quickly.
    const myKing = this.king(u.team);
    if (myKing) {
      const t = this.nearestEnemy(
        u,
        (e) => dist2(e.x, e.y, myKing.x, myKing.y) <= C.kingGuardSq,
        C.kingGuardResponseSq,
      );
      if (t >= 0) return t;
    }

    // 2. Hunt: the enemy King, when it is within reach.
    const enemyKing = this.king(u.team === 0 ? 1 : 0);
    if (enemyKing) {
      const huntSq = u.type === 'horseman' ? C.kingHorsemanHuntSq : C.kingHuntSq;
      if (dist2(u.x, u.y, enemyKing.x, enemyKing.y) <= huntSq) return enemyKing.id;
    }

    // 3. Normal targeting rules per unit type.
    if (u.type === 'horseman') {
      const t = this.nearestEnemy(
        u,
        (e) => e.type === 'archer' || e.type === 'mage' || e.type === 'medic',
        C.horsemanPriorityRangeSq,
      );
      if (t >= 0) return t;
    } else if (u.type === 'spearman') {
      const t = this.nearestEnemy(u, (e) => e.type === 'horseman', C.spearmanPriorityRangeSq);
      if (t >= 0) return t;
    }
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

    // Hold stance: stand still until an enemy is close. Ranged units still shoot.
    if (u.stance === 'hold' && !u.holdReleased) {
      if (this.anyEnemyWithin(u, C.holdTriggerSq)) {
        u.holdReleased = true;
      } else {
        if (u.stats.ranged) this.fireInPlace(u);
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

  /** Ranged unit that must not move: shoot its target, or any enemy in range. */
  private fireInPlace(u: Unit): void {
    if (u.type === 'mage') {
      if (this.anyEnemyWithin(u, u.stats.rangeSq)) this.progressCast(u);
      else u.castProgress = 0;
      return;
    }
    let t = u.targetId >= 0 ? this.units[u.targetId] : null;
    if (!t || !t.alive || !this.inRange(u, t)) {
      const id = this.nearestEnemy(u, undefined, u.stats.rangeSq);
      t = id >= 0 ? this.units[id] : null;
    }
    if (!t) return;
    this.face(u, t.x - u.x, t.y - u.y);
    if (this.readyToAttack(u)) this.attack(u, t);
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
    // No enemy close: walk back to the starting tile if pushed/drawn away.
    if (dist2(u.x, u.y, u.homeX, u.homeY) > C.kingHomeSlackSq) this.moveToward(u, u.homeX, u.homeY);
  }

  // ---- Mage ----

  private actMage(u: Unit, t: Unit): void {
    if (this.anyEnemyWithin(u, u.stats.rangeSq)) {
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
    const center = this.bestCastPoint(u);
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

    // 3. Move: toward injured allies nearby, otherwise follow the army; stay behind the front line.
    const follow = this.lowestHpAlly(u, C.medicSeekRangeSq, false) ?? this.nearestFighterAlly(u);
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
  private lowestHpAlly(u: Unit, distSq: number, respectHealerCap: boolean): Unit | null {
    let best: Unit | null = null;
    for (const a of this.units) {
      if (!a.alive || a.team !== u.team || a.id === u.id) continue;
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

  /** X of the most forward living non-medic ally. */
  private frontLineX(team: Team): number | null {
    let front: number | null = null;
    const fwd = this.forward(team);
    for (const a of this.units) {
      if (!a.alive || a.team !== team || a.type === 'medic') continue;
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
        this.face(u, cx, cy);
        return true;
      }
    }
    return false;
  }

  /** A move is allowed if it doesn't bring the unit into (or deeper into) overlap with another. */
  private isFree(u: Unit, nx: number, ny: number): boolean {
    for (const o of this.units) {
      if (!o.alive || o.id === u.id) continue;
      const nd = dist2(nx, ny, o.x, o.y);
      if (nd < C.minSeparationSq && nd <= dist2(u.x, u.y, o.x, o.y)) return false;
    }
    return true;
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
        .add(u.facingX)
        .add(u.facingY);
    }
    return h.digest();
  }
}

/** Convenience: run a whole battle headless. */
export function simulateBattle(map: MapDef, setups: [ArmySetup, ArmySetup], seed: number): BattleResult {
  return new Battle(map, setups, seed).runToEnd();
}
