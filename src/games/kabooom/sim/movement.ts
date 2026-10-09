import { CORNER_MIN, PLAYER_RADIUS as R, STEP } from './rules';
import type { Player, SimState } from './state';
import { Terrain } from './types';

/** Gap left to a wall so float error never re-collides. */
const SKIN = 1e-4;

/** Is cell `(cx, cy)` solid for player `pid`? Walls, crates, and TNT unless the player may still walk through it. */
export function solidAt(
  s: SimState,
  cx: number,
  cy: number,
  pid: number,
): boolean {
  if (cx < 0 || cy < 0 || cx >= s.w || cy >= s.h) return true;
  const i = cy * s.w + cx;
  if (s.terrain[i] !== Terrain.Empty) return true;
  const t = s.tntAt[i];
  return t >= 0 && ((s.tnts[t].pass >> pid) & 1) === 0;
}

/** Does a player hitbox centred on `(x, y)` overlap a solid cell? */
function blockedAt(s: SimState, x: number, y: number, pid: number): boolean {
  const x0 = Math.floor(x - R);
  const x1 = Math.floor(x + R - 1e-9);
  const y0 = Math.floor(y - R);
  const y1 = Math.floor(y + R - 1e-9);
  for (let cy = y0; cy <= y1; cy++)
    for (let cx = x0; cx <= x1; cx++) if (solidAt(s, cx, cy, pid)) return true;
  return false;
}

/** Does the hitbox centred on `(x, y)` overlap the cell `(cx, cy)`? */
export function overlapsCell(
  x: number,
  y: number,
  cx: number,
  cy: number,
): boolean {
  return (
    Math.abs(x - (cx + 0.5)) < 0.5 + R && Math.abs(y - (cy + 0.5)) < 0.5 + R
  );
}

/**
 * Move one axis by up to `d` cells towards `sign`. Returns the distance covered (also when it was spent sliding along a
 * wall corner into the free lane). Position changes are written to the player.
 */
function stepAxis(
  s: SimState,
  p: Player,
  axis: 0 | 1,
  sign: number,
  d: number,
): number {
  const along = axis === 0 ? p.x : p.y;
  const perp = axis === 0 ? p.y : p.x;
  const next = along + sign * d;
  const hit =
    axis === 0
      ? blockedAt(s, next, perp, p.id)
      : blockedAt(s, perp, next, p.id);
  if (!hit) {
    if (axis === 0) p.x = next;
    else p.y = next;
    return d;
  }

  // Blocked: the cell column / row we run into, and the two lanes (own + the neighbour we overlap) next to it.
  const lead = Math.floor(next + sign * R);
  const lane = Math.floor(perp);
  const off = perp - (lane + 0.5);
  const free = (l: number) =>
    axis === 0 ? !solidAt(s, lead, l, p.id) : !solidAt(s, l, lead, p.id);
  let target = -1;
  if (free(lane)) target = lane;
  else if (Math.abs(off) >= CORNER_MIN && free(lane + (off > 0 ? 1 : -1)))
    target = lane + (off > 0 ? 1 : -1);

  if (target >= 0) {
    const goal = target + 0.5;
    const slide = Math.min(d, Math.abs(goal - perp));
    const moved = perp + Math.sign(goal - perp) * slide;
    if (axis === 0) p.y = moved;
    else p.x = moved;
    return slide;
  }

  // Wall: stop flush against it.
  const face = sign > 0 ? lead - R - SKIN : lead + 1 + R + SKIN;
  const clamped =
    sign > 0
      ? Math.min(next, Math.max(along, face))
      : Math.max(next, Math.min(along, face));
  const moved = Math.abs(clamped - along);
  if (axis === 0) p.x = clamped;
  else p.y = clamped;
  return moved;
}

/**
 * One tick of movement from an analog input (`dx`, `dy` in -1..1). Movement is one axis at a time (the larger input; a
 * tie keeps the last axis, and falls back to the other axis when blocked) so a diagonal key press turns corners
 * instead of sliding off them.
 */
export function movePlayer(
  s: SimState,
  p: Player,
  dx: number,
  dy: number,
): void {
  const mag = Math.hypot(dx, dy);
  if (mag < 1e-3) {
    p.moving = false;
    return;
  }
  const d = Math.min(1, mag) * p.speed * STEP;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  let axis: 0 | 1 = ax > ay + 0.01 ? 0 : ay > ax + 0.01 ? 1 : p.axis;
  const comp = (a: 0 | 1) => (a === 0 ? dx : dy);
  let moved =
    Math.abs(comp(axis)) < 0.01
      ? 0
      : stepAxis(s, p, axis, Math.sign(comp(axis)), d);
  const other: 0 | 1 = axis === 0 ? 1 : 0;
  if (moved < d * 0.5 && Math.abs(comp(other)) > 0.01) {
    const m2 = stepAxis(s, p, other, Math.sign(comp(other)), d);
    if (m2 > moved) {
      moved = m2;
      axis = other;
    }
  }
  p.axis = axis;
  p.moving = moved > 1e-6;
  if (p.moving) p.facing = Math.atan2(dy, dx);
}

/** Drop the pass-through right of every player whose hitbox no longer overlaps a TNT they stood on when it was placed. */
export function updateTntPass(s: SimState): void {
  for (const t of s.tnts) {
    if (!t.active || t.pass === 0) continue;
    for (const p of s.players) {
      if (((t.pass >> p.id) & 1) !== 0 && !overlapsCell(p.x, p.y, t.x, t.y))
        t.pass &= ~(1 << p.id);
    }
  }
}
