/**
 * Integer maths helpers for the deterministic simulation.
 *
 * Positions are stored in "sub-tiles": 1 tile = SUB (1000) sub-tiles.
 * HP and damage are stored in "centi-HP": 1 HP = 100.
 * Only +, -, *, / with Math.trunc/floor are used; these are exactly the
 * same on every JavaScript engine (IEEE-754), unlike sin/cos/pow.
 */

export const SUB = 1000;
export const HP_SCALE = 100;

export function tilesToSub(tiles: number): number {
  return Math.round(tiles * SUB);
}

/** Exact integer square root: floor(sqrt(n)). Result is exact regardless of Math.sqrt precision. */
export function isqrt(n: number): number {
  if (n <= 0) return 0;
  let x = Math.floor(Math.sqrt(n));
  while (x * x > n) x--;
  while ((x + 1) * (x + 1) <= n) x++;
  return x;
}

export function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

/** value × percent / 100, truncated to an integer. */
export function applyPct(value: number, percent: number): number {
  return Math.trunc((value * percent) / 100);
}

/** 1000 × cos(45°), used for integer 45° rotations. */
const R45 = 707;

export function rot45(x: number, y: number): [number, number] {
  return [Math.trunc(((x - y) * R45) / 1000), Math.trunc(((x + y) * R45) / 1000)];
}

export function rotMinus45(x: number, y: number): [number, number] {
  return [Math.trunc(((x + y) * R45) / 1000), Math.trunc(((y - x) * R45) / 1000)];
}
