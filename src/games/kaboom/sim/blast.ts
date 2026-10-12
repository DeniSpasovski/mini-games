import {
  CHAIN_DELAY_S,
  CORNER_FROM_RANGE,
  CORNER_REACH,
  FLAME_S,
  MAX_CORNERS,
} from './rules';
import type { SimState, Tnt } from './state';
import { Terrain } from './types';

/** Arm directions: +x, -x, +y, -y (the order of `tntExploded.arms`). */
export const DIRS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
/** The two directions at right angles to direction `d` (indices into `DIRS`). */
const SIDES: readonly (readonly [number, number])[] = [
  [2, 3],
  [2, 3],
  [0, 1],
  [0, 1],
];

/** Most corner branches one blast can make: 4 arms x `MAX_CORNERS` corners x 2 sides. */
export const MAX_BENDS = 4 * MAX_CORNERS * 2;

/** Corners each arm of a blast of `range` turns: none up to level 3, the first at level 4, the first two at level 5. */
export function cornersFor(range: number): number {
  return Math.max(0, Math.min(MAX_CORNERS, range - CORNER_FROM_RANGE + 1));
}

/**
 * What a blast does to each cell it reaches. `burn` is called for every cell that catches fire (never a hard block) and
 * returns true when the flame stops there (a crate it breaks, a TNT it sets off). `arm` reports each straight arm's
 * length, `bend` each corner branch (from the corner cell `x, y` in direction `d`, `len` cells).
 */
export interface BlastVisitor {
  burn(i: number, x: number, y: number): boolean;
  arm?(d: number, len: number): void;
  bend?(x: number, y: number, d: number, len: number): void;
}

/**
 * The one rule for which cells a blast reaches (the sim, the bots' danger map and the map checks all walk it): the TNT's
 * own cell, then a straight arm each way of up to `range` cells that stops before a hard block and at the first crate or
 * TNT. From blast level 4 (`CORNER_FROM_RANGE`) an arm also turns corners: at the first cell along it with an open side
 * (two at level 5) the flames branch `CORNER_REACH` cells down each open side, stopping the same way. Reads `terrain`
 * as it goes, so a crate the visitor clears is open to the arms walked after it. Allocates nothing.
 */
export function walkBlast(
  terrain: Uint8Array,
  w: number,
  h: number,
  x: number,
  y: number,
  range: number,
  v: BlastVisitor,
): void {
  v.burn(y * w + x, x, y);
  const corners = cornersFor(range);
  for (let d = 0; d < 4; d++) {
    const [dx, dy] = DIRS[d];
    let len = 0;
    let turned = 0;
    for (let k = 1; k <= range; k++) {
      const cx = x + dx * k;
      const cy = y + dy * k;
      if (cx < 0 || cy < 0 || cx >= w || cy >= h) break;
      const i = cy * w + cx;
      if (terrain[i] === Terrain.Hard) break;
      len = k;
      if (v.burn(i, cx, cy)) break;
      if (turned >= corners) continue;
      // a corner: an open side here - the flames go round it
      let open = false;
      for (const s of SIDES[d]) {
        const [sx, sy] = DIRS[s];
        const nx = cx + sx;
        const ny = cy + sy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (terrain[ny * w + nx] === Terrain.Hard) continue;
        open = true;
        let blen = 0;
        for (let m = 1; m <= CORNER_REACH; m++) {
          const bx = cx + sx * m;
          const by = cy + sy * m;
          if (bx < 0 || by < 0 || bx >= w || by >= h) break;
          const j = by * w + bx;
          if (terrain[j] === Terrain.Hard) break;
          blen = m;
          if (v.burn(j, bx, by)) break;
        }
        if (blen > 0) v.bend?.(cx, cy, s, blen);
      }
      if (open) turned++;
    }
    v.arm?.(d, len);
  }
}

/** Where explosion events go (the sim's pooled event writer; tests use a plain collector). */
export interface BlastSink {
  blockBroken(x: number, y: number): void;
  /** `bends` = `bendCount` corner branches as flat (x, y, dir, len) quads. */
  tntExploded(
    t: Tnt,
    arms: readonly [number, number, number, number],
    bends: readonly number[],
    bendCount: number,
  ): void;
}

function setFlame(s: SimState, i: number, owner: number): void {
  s.flame[i] = FLAME_S;
  s.flameOwner[i] = owner;
}

/** The sim's visitor: one reused object (no allocation per blast). */
const live = {
  s: null as unknown as SimState,
  t: null as unknown as Tnt,
  sink: null as unknown as BlastSink,
  arms: [0, 0, 0, 0] as [number, number, number, number],
  bends: new Array<number>(MAX_BENDS * 4).fill(0),
  bendCount: 0,
  burn(i: number, x: number, y: number): boolean {
    const { s, t } = live;
    setFlame(s, i, t.owner);
    if (s.terrain[i] === Terrain.Crate) {
      s.terrain[i] = Terrain.Empty;
      live.sink.blockBroken(x, y);
      return true;
    }
    const j = s.tntAt[i];
    if (j >= 0 && (x !== t.x || y !== t.y)) {
      const other = s.tnts[j];
      if (other.active && other.fuse > CHAIN_DELAY_S) {
        other.fuse = CHAIN_DELAY_S;
        other.depth = t.depth + 1;
      }
      return true;
    }
    return false;
  },
  arm(d: number, len: number): void {
    live.arms[d] = len;
  },
  bend(x: number, y: number, d: number, len: number): void {
    const o = live.bendCount * 4;
    live.bends[o] = x;
    live.bends[o + 1] = y;
    live.bends[o + 2] = d;
    live.bends[o + 3] = len;
    live.bendCount++;
  },
};

/**
 * Detonate `t` (`walkBlast`): the cross, and from level 4 the corners it turns. A crate in the way breaks and stops the
 * flame; a TNT it reaches goes off `CHAIN_DELAY_S` later (so a chain spreads over frames). Frees the owner's TNT slot.
 */
export function explode(s: SimState, t: Tnt, sink: BlastSink): void {
  const { w, h } = s;
  t.active = false;
  s.tntAt[t.y * w + t.x] = -1;
  const owner = s.players[t.owner];
  if (owner) owner.tntLeft = Math.min(owner.maxTnt, owner.tntLeft + 1);
  live.s = s;
  live.t = t;
  live.sink = sink;
  live.bendCount = 0;
  walkBlast(s.terrain, w, h, t.x, t.y, t.range, live);
  sink.tntExploded(t, live.arms, live.bends, live.bendCount);
}

/**
 * Cells a TNT of `range` at `(x, y)` burns on `terrain` with no other TNT around (`walkBlast`: crates burn and stop the
 * flame, nothing is changed). Allocates: for map generation, the map viewer and tests, not the tick.
 */
export function crossCells(
  terrain: Uint8Array,
  w: number,
  h: number,
  x: number,
  y: number,
  range: number,
): number[] {
  const out: number[] = [];
  walkBlast(terrain, w, h, x, y, range, {
    burn: (i) => {
      out.push(i);
      return terrain[i] === Terrain.Crate;
    },
  });
  return [...new Set(out)];
}
