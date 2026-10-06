import { getItem, type ItemInfo } from '../items/catalog';
import type { MapData, MoveKind } from '../map/types';
import { hashString } from '../../../shared/rng';
import { FallState, type FallParams } from './fall';

const CELL = 8;

/** Numeric ids of `MoveKind` (struct-of-arrays). */
export const MOVE_KINDS: MoveKind[] = [
  'wander',
  'hop',
  'crawl',
  'skitter',
  'flutter',
  'swim',
  'trail',
  'patrol',
  'roam',
  'drive',
  'stroll',
];

/**
 * Item instances of a map in struct-of-arrays form plus a spatial hash. Most items never move on
 * the ground (only their fall pose changes); `movers` (Animal Island) walk inside a leash circle and
 * are re-bucketed in the hash when they cross a cell (`relocate`).
 */
export class World {
  readonly n: number;
  readonly types: ItemInfo[] = [];
  readonly typeIndex = new Map<string, number>();
  readonly x: Float32Array;
  readonly z: Float32Array;
  readonly rot: Float32Array;
  readonly type: Uint16Array;
  readonly variant: Uint8Array;
  readonly paint: Int8Array;
  readonly size: Float32Array;
  readonly height: Float32Array;
  /** First hole level that can eat the item. */
  readonly level: Uint8Array;
  /** Size tier 1..25 (points, results histogram). */
  readonly tier: Uint8Array;
  readonly points: Uint8Array;
  /** Per item seed (stable across runs). */
  readonly seed: Uint32Array;
  readonly state: Uint8Array;
  /** Seconds since the item committed to falling. */
  readonly t: Float32Array;
  /** Teeter amount 0..1 (items that are too big lean towards the hole). */
  readonly teeter: Float32Array;
  /** Angle (rad) of the direction from the item to the hole when it committed or teeters. */
  readonly dir: Float32Array;
  /** Distance from the item to the hole centre when it committed (m). */
  readonly pull: Float32Array;
  /** Height above the ground (m) of an idle item: hops and flutters. */
  readonly lift: Float32Array;
  /** Indices of the items that move, in placement order. */
  readonly movers: number[] = [];
  /** Per item: 1 when it moves (the arrays below are only meaningful for those). */
  readonly isMover: Uint8Array;
  readonly mKind: Uint8Array;
  readonly mHx: Float32Array;
  readonly mHz: Float32Array;
  readonly mLeash: Float32Array;
  readonly mSpeed: Float32Array;
  /** Current walk target (or the far end of a trail). */
  readonly mTx: Float32Array;
  readonly mTz: Float32Array;
  /** Far end of a trail / patrol path. */
  readonly mPx: Float32Array;
  readonly mPz: Float32Array;
  /** Velocity (m/s) of the last step, 0 while idle or asleep (the bot leads its target with it). */
  readonly mVx: Float32Array;
  readonly mVz: Float32Array;
  /** `drive`: road node the car is heading to / came from / has chosen to turn into (-1 = not yet), and the crossing stage. */
  readonly mNode: Int32Array;
  readonly mFrom: Int32Array;
  readonly mNext: Int32Array;
  /** `drive`: 0 = on the arm, 1 = crossing, 2 = U-turn at a dead end. `stroll`: walking direction (+1 / -1). */
  readonly mStage: Int8Array;
  /** `drive`: seconds the car has been held up by traffic (negative = ignoring traffic for a moment). */
  readonly mBlock: Float32Array;
  /** Seconds left to idle. */
  readonly mWait: Float32Array;
  /** Animation clock (hop arc, flutter bob, waddle). */
  readonly mPhase: Float32Array;
  /** Seconds left of fleeing (0 = calm). */
  readonly mFlee: Float32Array;
  /** 1 when the mover may flee from the hole. */
  readonly mCanFlee: Uint8Array;
  /** Movers that moved this tick (the renderer rewrites their matrices). */
  readonly moving = new Set<number>();
  /** Items that finished falling since the renderer last drained this list. */
  readonly gone: number[] = [];
  readonly fall: (FallParams | null)[];
  /** Items that need a matrix update (teetering, tipping, falling). */
  readonly active = new Set<number>();
  /** Items not yet committed to falling. */
  remaining: number;
  readonly totalPoints: number;
  private hash = new Map<number, number[]>();
  private cellOf: Int32Array;
  private slotOf: Int32Array;

  constructor(map: MapData) {
    const n = map.placements.length;
    this.n = n;
    this.x = new Float32Array(n);
    this.z = new Float32Array(n);
    this.rot = new Float32Array(n);
    this.type = new Uint16Array(n);
    this.variant = new Uint8Array(n);
    this.paint = new Int8Array(n);
    this.size = new Float32Array(n);
    this.height = new Float32Array(n);
    this.level = new Uint8Array(n);
    this.tier = new Uint8Array(n);
    this.points = new Uint8Array(n);
    this.seed = new Uint32Array(n);
    this.state = new Uint8Array(n);
    this.t = new Float32Array(n);
    this.teeter = new Float32Array(n);
    this.dir = new Float32Array(n);
    this.pull = new Float32Array(n);
    this.lift = new Float32Array(n);
    this.isMover = new Uint8Array(n);
    this.mKind = new Uint8Array(n);
    this.mHx = new Float32Array(n);
    this.mHz = new Float32Array(n);
    this.mLeash = new Float32Array(n);
    this.mSpeed = new Float32Array(n);
    this.mTx = new Float32Array(n);
    this.mTz = new Float32Array(n);
    this.mPx = new Float32Array(n);
    this.mPz = new Float32Array(n);
    this.mVx = new Float32Array(n);
    this.mVz = new Float32Array(n);
    this.mNode = new Int32Array(n).fill(-1);
    this.mFrom = new Int32Array(n).fill(-1);
    this.mNext = new Int32Array(n).fill(-1);
    this.mStage = new Int8Array(n);
    this.mBlock = new Float32Array(n);
    this.mWait = new Float32Array(n);
    this.mPhase = new Float32Array(n);
    this.mFlee = new Float32Array(n);
    this.mCanFlee = new Uint8Array(n);
    this.cellOf = new Int32Array(n);
    this.slotOf = new Int32Array(n);
    this.fall = new Array<FallParams | null>(n).fill(null);
    let total = 0;
    for (let i = 0; i < n; i++) {
      const p = map.placements[i];
      let ti = this.typeIndex.get(p.item);
      if (ti === undefined) {
        ti = this.types.length;
        this.types.push(getItem(p.item));
        this.typeIndex.set(p.item, ti);
      }
      const info = this.types[ti];
      this.x[i] = p.x;
      this.z[i] = p.z;
      this.rot[i] = p.rot;
      this.type[i] = ti;
      this.variant[i] = p.variant;
      this.paint[i] = p.paint;
      this.size[i] = info.size;
      this.height[i] = info.h;
      this.level[i] = info.level;
      this.tier[i] = info.tier;
      this.points[i] = info.points;
      this.seed[i] = hashString(`${p.item}:${i}`);
      total += info.points;
      const key = cellKey(Math.floor(p.x / CELL), Math.floor(p.z / CELL));
      const bucket = this.hash.get(key);
      this.cellOf[i] = key;
      if (bucket) {
        this.slotOf[i] = bucket.length;
        bucket.push(i);
      } else {
        this.slotOf[i] = 0;
        this.hash.set(key, [i]);
      }
      const mv = p.move;
      if (mv) {
        this.isMover[i] = 1;
        this.movers.push(i);
        this.mKind[i] = MOVE_KINDS.indexOf(mv.kind);
        this.mHx[i] = mv.hx;
        this.mHz[i] = mv.hz;
        this.mLeash[i] = mv.leash;
        this.mSpeed[i] = mv.speed;
        this.mTx[i] = p.x;
        this.mTz[i] = p.z;
        this.mPx[i] = mv.tx ?? p.x;
        this.mPz[i] = mv.tz ?? p.z;
        this.mWait[i] = mv.delay ?? 0;
        this.mPhase[i] = (this.seed[i] % 1000) / 1000;
        this.mCanFlee[i] = mv.flee === false ? 0 : 1;
        this.mStage[i] = mv.kind === 'stroll' ? (mv.dir ?? 1) : 0;
        if (mv.kind === 'flutter') this.lift[i] = 0.6;
      }
    }
    this.remaining = n;
    this.totalPoints = total;
  }

  /** Visit items whose pivot is within `radius` of (x, z). */
  query(
    x: number,
    z: number,
    radius: number,
    visit: (i: number) => void,
  ): void {
    const x0 = Math.floor((x - radius) / CELL);
    const x1 = Math.floor((x + radius) / CELL);
    const z0 = Math.floor((z - radius) / CELL);
    const z1 = Math.floor((z + radius) / CELL);
    const r2 = radius * radius;
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const bucket = this.hash.get(cellKey(cx, cz));
        if (!bucket) continue;
        for (const i of bucket) {
          const dx = this.x[i] - x;
          const dz = this.z[i] - z;
          if (dx * dx + dz * dz <= r2) visit(i);
        }
      }
    }
  }

  /** Re-bucket a mover after its x / z changed (cheap: only when it crossed a cell). */
  relocate(i: number): void {
    const key = cellKey(
      Math.floor(this.x[i] / CELL),
      Math.floor(this.z[i] / CELL),
    );
    if (key === this.cellOf[i]) return;
    const old = this.hash.get(this.cellOf[i])!;
    const last = old.pop()!;
    if (last !== i) {
      old[this.slotOf[i]] = last;
      this.slotOf[last] = this.slotOf[i];
    }
    const bucket = this.hash.get(key);
    this.cellOf[i] = key;
    if (bucket) {
      this.slotOf[i] = bucket.length;
      bucket.push(i);
    } else {
      this.slotOf[i] = 0;
      this.hash.set(key, [i]);
    }
  }

  isIdle(i: number): boolean {
    return this.state[i] === FallState.Idle;
  }
}

function cellKey(cx: number, cz: number): number {
  return (cx + 512) * 1024 + (cz + 512);
}
