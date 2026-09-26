/**
 * Terrain: what is on each tile of the map, and finding a way around obstacles.
 *
 * Path-finding (deterministic, integers only):
 *  - A unit whose straight line to its goal only crosses easy ground just walks straight
 *    (on Open Plains that is always the case, so nothing changes there).
 *  - Otherwise it follows a "cost map" of the goal tile: the cheapest walking cost from
 *    every tile to that goal (Dijkstra over the 8-neighbour tile grid; slow tiles cost more,
 *    deep water can't be entered). The unit walks "downhill" on that map, looking a few tiles
 *    ahead so it moves in straight lines instead of zig-zagging from tile to tile.
 *  - Terrain never changes during a battle, so each cost map is computed once per map and
 *    reused by every unit, every battle (cheap enough for the future AI's headless battles).
 */
import { TERRAIN, TERRAIN_TYPES, type TerrainType } from '../config/gameConfig';
import { SUB } from './fixed';
import type { MapDef, TileChar } from './types';

/** Which tile character in the map files means which terrain. */
export const TILE_TERRAIN: Record<TileChar, TerrainType> = {
  '.': 'flat',
  '^': 'mountain',
  '~': 'deep',
  '-': 'shallow',
};

/** Terrain code = index in TERRAIN_TYPES (0 flat, 1 mountain, 2 deep, 3 shallow). */
export function terrainCode(type: TerrainType): number {
  return TERRAIN_TYPES.indexOf(type);
}

/** Walking cost of one tile: 10 on flat ground, more on slow ground, 0 = can't walk. */
const TILE_COST = TERRAIN_TYPES.map((t) => (TERRAIN[t].walkable ? Math.round((10 * 100) / TERRAIN[t].speedPct) : 0));

/**
 * Neighbour order for walking "downhill" when two routes are equally good. Team 1 uses
 * it flipped left↔right, so mirrored armies choose mirrored routes (fairness).
 */
const DIRS: readonly [number, number][] = [
  [1, 0],
  [0, 1],
  [0, -1],
  [-1, 0],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/** How many tiles along the route a unit looks ahead for a straight-line shortcut. */
const LOOKAHEAD = 6;

export class Terrain {
  readonly width: number;
  readonly height: number;
  /** Terrain code of every tile, row by row. */
  readonly codes: Uint8Array;
  /** Every tile is walkable at the same speed: path-finding is never needed. */
  readonly uniform: boolean;
  private readonly cost: Int32Array;
  /** Cost maps by goal tile, computed on first use. */
  private readonly fields = new Map<number, Int32Array>();

  constructor(map: MapDef) {
    this.width = map.width;
    this.height = map.height;
    const n = map.width * map.height;
    this.codes = new Uint8Array(n);
    this.cost = new Int32Array(n);
    if (map.rows.length !== map.height) throw new Error(`Map ${map.id}: expected ${map.height} rows`);
    map.rows.forEach((row, ty) => {
      if (row.length !== map.width) throw new Error(`Map ${map.id}: row ${ty} should be ${map.width} tiles long`);
      for (let tx = 0; tx < map.width; tx++) {
        const type = TILE_TERRAIN[row[tx] as TileChar];
        if (!type) throw new Error(`Map ${map.id}: unknown tile '${row[tx]}' at (${tx}, ${ty})`);
        const i = ty * map.width + tx;
        this.codes[i] = terrainCode(type);
        this.cost[i] = TILE_COST[this.codes[i]];
      }
    });
    this.uniform = this.cost.every((c) => c === this.cost[0] && c > 0);
  }

  // ------------------------------------------------------------------
  // Tiles
  // ------------------------------------------------------------------

  /** Tile column of a sub-tile x (clamped to the map). */
  tileX(x: number): number {
    return Math.min(this.width - 1, Math.max(0, Math.floor(x / SUB)));
  }

  tileY(y: number): number {
    return Math.min(this.height - 1, Math.max(0, Math.floor(y / SUB)));
  }

  /** Terrain code under a position in sub-tiles. */
  codeAt(x: number, y: number): number {
    return this.codes[this.tileY(y) * this.width + this.tileX(x)];
  }

  /** Terrain code of a tile. */
  codeOfTile(tx: number, ty: number): number {
    return this.codes[ty * this.width + tx];
  }

  walkableTile(tx: number, ty: number): boolean {
    return tx >= 0 && ty >= 0 && tx < this.width && ty < this.height && this.cost[ty * this.width + tx] > 0;
  }

  /** Can a unit's centre stand at this position (in sub-tiles)? */
  walkableAt(x: number, y: number): boolean {
    return this.cost[this.tileY(y) * this.width + this.tileX(x)] > 0;
  }

  // ------------------------------------------------------------------
  // Straight lines
  // ------------------------------------------------------------------

  /**
   * Can a unit walk in a straight line from (x0, y0) to (x1, y1) without meeting an
   * obstacle or ground slower than at either end? (Walking INTO slow ground to reach a
   * goal standing there is fine; crossing a mountain on the way is not "clear".)
   * Visits every tile the line passes through, using only integer maths.
   */
  lineClear(x0: number, y0: number, x1: number, y1: number): boolean {
    const w = this.width;
    let tx = this.tileX(x0);
    let ty = this.tileY(y0);
    const ex = this.tileX(x1);
    const ey = this.tileY(y1);
    const limit = Math.max(this.cost[ty * w + tx], this.cost[ey * w + ex]);
    const ok = (cx: number, cy: number) => {
      if (cx < 0 || cy < 0 || cx >= w || cy >= this.height) return false;
      const c = this.cost[cy * w + cx];
      return c > 0 && c <= limit;
    };
    if (!ok(tx, ty)) return false;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const sx = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const sy = dy > 0 ? 1 : dy < 0 ? -1 : 0;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    for (let guard = w + this.height + 2; tx !== ex || ty !== ey; guard--) {
      if (guard <= 0) return false;
      if (sy === 0 || (sx !== 0 && ty === ey)) {
        tx += sx;
      } else if (sx === 0 || tx === ex) {
        ty += sy;
      } else {
        // Which tile border does the line cross first? Compare (border − start) / direction
        // for x and y by cross-multiplying, so no division is needed.
        const bx = sx > 0 ? (tx + 1) * SUB : tx * SUB;
        const by = sy > 0 ? (ty + 1) * SUB : ty * SUB;
        const lx = Math.abs(bx - x0) * ady;
        const ly = Math.abs(by - y0) * adx;
        if (lx < ly) {
          tx += sx;
        } else if (ly < lx) {
          ty += sy;
        } else {
          // Exactly through a corner: both side tiles must be clear too.
          if (!ok(tx + sx, ty) || !ok(tx, ty + sy)) return false;
          tx += sx;
          ty += sy;
        }
      }
      if (!ok(tx, ty)) return false;
    }
    return true;
  }

  // ------------------------------------------------------------------
  // Path-finding
  // ------------------------------------------------------------------

  /**
   * Where a unit at (x, y) should walk next to reach (gx, gy). Returns the goal itself if
   * the straight line is clear; otherwise the furthest point along the cheapest route
   * (up to a few tiles ahead) that can be reached in a straight line.
   * `mirror` flips left/right tie-breaks (pass true for team 1).
   */
  waypoint(x: number, y: number, gx: number, gy: number, mirror: boolean): [number, number] {
    if (this.uniform || this.lineClear(x, y, gx, gy)) return [gx, gy];
    const w = this.width;
    const start = this.tileY(y) * w + this.tileX(x);
    const goal = this.tileY(gy) * w + this.tileX(gx);
    if (start === goal) return [gx, gy];
    const field = this.field(goal);
    if (field[start] < 0) return [gx, gy]; // no route at all: head straight (blocked steps slide)

    const half = SUB / 2;
    let best: [number, number] | null = null;
    let cur = start;
    for (let k = 0; k < LOOKAHEAD; k++) {
      const next = this.downhill(cur, field, mirror);
      if (next < 0) break;
      if (next === goal) {
        // Reached the goal tile: aim at the goal itself if possible.
        if (this.cost[goal] > 0 && (k === 0 || this.lineClear(x, y, gx, gy))) best = [gx, gy];
        break;
      }
      const cx = (next % w) * SUB + half;
      const cy = Math.floor(next / w) * SUB + half;
      if (k > 0 && !this.lineClear(x, y, cx, cy)) break;
      best = [cx, cy];
      cur = next;
    }
    return best ?? [gx, gy];
  }

  /** The neighbour of `tile` that is one step along the cheapest route, or −1. */
  private downhill(tile: number, field: Int32Array, mirror: boolean): number {
    const w = this.width;
    const tx = tile % w;
    const ty = Math.floor(tile / w);
    let best = -1;
    let bestCost = Infinity;
    for (const [ddx, dy] of DIRS) {
      const dx = mirror ? -ddx : ddx;
      const nx = tx + dx;
      const ny = ty + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= this.height) continue;
      const n = ny * w + nx;
      if (field[n] < 0) continue;
      if (this.cost[n] === 0 && field[n] !== 0) continue; // only the goal itself may be unwalkable
      if (dx !== 0 && dy !== 0 && (!this.walkableTile(tx + dx, ty) || !this.walkableTile(tx, ty + dy))) continue;
      const c = field[n] + this.stepCost(tile, n, dx !== 0 && dy !== 0);
      if (c < bestCost) {
        best = n;
        bestCost = c;
      }
    }
    return best;
  }

  /** Cost of stepping between two neighbouring tiles (average of both tiles; diagonals ×1.4). */
  private stepCost(a: number, b: number, diagonal: boolean): number {
    return (this.cost[a] + this.cost[b]) * (diagonal ? 7 : 5);
  }

  /**
   * Cheapest walking cost from every tile to `goal` (−1 = can't get there).
   * The goal tile itself may be unwalkable (e.g. a formation slot in a lake): units then
   * get as close as they can.
   */
  private field(goal: number): Int32Array {
    const cached = this.fields.get(goal);
    if (cached) return cached;
    const w = this.width;
    const n = w * this.height;
    const dist = new Int32Array(n).fill(-1);
    const done = new Uint8Array(n);
    // Binary heap of (cost × n + tile): ties pop lowest tile first, so it is fully deterministic.
    const heap: number[] = [];
    const push = (v: number) => {
      heap.push(v);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p] <= heap[i]) break;
        [heap[p], heap[i]] = [heap[i], heap[p]];
        i = p;
      }
    };
    const pop = (): number => {
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length > 0) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1;
          const r = l + 1;
          let m = i;
          if (l < heap.length && heap[l] < heap[m]) m = l;
          if (r < heap.length && heap[r] < heap[m]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top;
    };

    dist[goal] = 0;
    push(goal);
    while (heap.length > 0) {
      const v = pop();
      const tile = v % n;
      if (done[tile]) continue;
      done[tile] = 1;
      const tx = tile % w;
      const ty = Math.floor(tile / w);
      for (const [dx, dy] of DIRS) {
        const nx = tx + dx;
        const ny = ty + dy;
        if (!this.walkableTile(nx, ny)) continue;
        const diagonal = dx !== 0 && dy !== 0;
        if (diagonal && (!this.walkableTile(tx + dx, ty) || !this.walkableTile(tx, ty + dy))) continue;
        const nb = ny * w + nx;
        const d = dist[tile] + this.stepCost(tile, nb, diagonal);
        if (dist[nb] < 0 || d < dist[nb]) {
          dist[nb] = d;
          push(d * n + nb);
        }
      }
    }
    this.fields.set(goal, dist);
    return dist;
  }
}

/** Terrain is built once per map and shared (it never changes during a battle). */
const cache = new WeakMap<MapDef, Terrain>();

export function terrainOf(map: MapDef): Terrain {
  let t = cache.get(map);
  if (!t) {
    t = new Terrain(map);
    cache.set(map, t);
  }
  return t;
}
