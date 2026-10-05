import { Rng } from '../../../shared/rng';
import type { MapData, WalkGrid } from '../map/types';
import { teeterAmount } from './eat';
import { FallState } from './fall';
import { cameraDistance, holeDiameter, moveSpeed } from './progression';
import { MOVE_KINDS, type World } from './world';

/**
 * Moving items (Animal Island): every mover walks, hops, swims or flutters inside a leash circle around
 * its home. DOM-free and deterministic: one seeded Rng, a fixed iteration order, and the set of awake
 * movers depends only on the hole (never on the camera), so the bot, the tests and the game agree.
 * Only movers near the hole that are big enough to be seen from the camera move at all ("awake");
 * the rest stand still, which also keeps the per-frame matrix upload small.
 */

/** Awake radius = this x the camera distance of the hole. */
const AWAKE_CAMERA = 1.6;
/** A mover is only worth animating while size / distance is above 1 / VISIBLE (m of size per metre). */
const VISIBLE = 150;
/**
 * Flee knobs (the balance page can edit them): an eatable mover of tier >= `minTier` starts to flee when the
 * hole is within `range` x its diameter + size, runs for `time` seconds at `mul` x its walking speed (never
 * above the speed cap below). Insects and giants never flee.
 */
export const FLEE = { range: 1.3, time: 1.6, mul: 1.1, minTier: 1 };
/** No mover is faster than this share of the full speed of the hole level that can first eat it. */
const SPEED_CAP = 0.5;

const K = Object.fromEntries(MOVE_KINDS.map((k, i) => [k, i])) as Record<
  (typeof MOVE_KINDS)[number],
  number
>;

export interface HoleView {
  x: number;
  z: number;
  level: number;
  diameter: number;
}

export class Movers {
  private rng: Rng;
  private walk: WalkGrid | undefined;

  constructor(
    private world: World,
    map: Pick<MapData, 'walk' | 'seed'>,
  ) {
    this.walk = map.walk;
    this.rng = new Rng(map.seed * 7919 + 31);
  }

  get count(): number {
    return this.world.movers.length;
  }

  /** 0 = blocked, 1 = land, 2 = water. Outside the grid counts as blocked. */
  cell(x: number, z: number): number {
    const g = this.walk;
    if (!g) return 1;
    const ix = Math.floor((x - g.x0) / g.cell);
    const iz = Math.floor((z - g.z0) / g.cell);
    if (ix < 0 || iz < 0 || ix >= g.nx || iz >= g.nz) return 0;
    return g.data[iz * g.nx + ix];
  }

  private ok(kind: number, x: number, z: number): boolean {
    const c = this.cell(x, z);
    if (kind === K.swim) return c === 2;
    if (kind === K.flutter) return c > 0;
    return c === 1;
  }

  /** True when the straight line is clear (checked every 2 m, cheap). */
  private clear(kind: number, x0: number, z0: number, x1: number, z1: number) {
    const d = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.min(40, Math.ceil(d / 2));
    for (let s = 1; s <= n; s++) {
      const t = s / n;
      if (!this.ok(kind, x0 + (x1 - x0) * t, z0 + (z1 - z0) * t)) return false;
    }
    return true;
  }

  /** Advance every awake mover by `dt`. */
  step(dt: number, hole: HoleView, over: boolean): void {
    const w = this.world;
    if (over || w.movers.length === 0) return;
    const awake = cameraDistance(hole.diameter) * AWAKE_CAMERA;
    const awake2 = awake * awake;
    for (const i of w.movers) {
      if (w.state[i] !== FallState.Idle) continue;
      const dx = w.x[i] - hole.x;
      const dz = w.z[i] - hole.z;
      const d2 = dx * dx + dz * dz;
      const seen = w.size[i] * VISIBLE;
      if (d2 > awake2 || d2 > seen * seen) {
        if (w.lift[i] !== 0 && w.mKind[i] !== K.flutter) this.settle(i);
        continue;
      }
      const dist = Math.sqrt(d2);
      // a thing too big to eat that the hole is under stands still and teeters
      if (
        w.level[i] > hole.level &&
        teeterAmount(hole.diameter, w.size[i], dist) > 0
      )
        continue;
      this.stepOne(i, dt, hole, dist);
    }
  }

  private settle(i: number): void {
    this.world.lift[i] = 0;
    this.world.moving.add(i);
  }

  private stepOne(i: number, dt: number, hole: HoleView, dist: number): void {
    const w = this.world;
    const kind = w.mKind[i];
    // flee (only things the hole can eat; insects never)
    if (
      w.mCanFlee[i] &&
      w.level[i] <= hole.level &&
      w.tier[i] >= FLEE.minTier
    ) {
      if (dist < FLEE.range * hole.diameter + w.size[i] && w.mFlee[i] <= 0) {
        w.mFlee[i] = FLEE.time;
        const ax = w.x[i] - hole.x;
        const az = w.z[i] - hole.z;
        const len = Math.hypot(ax, az) || 1;
        this.aimAt(
          i,
          kind,
          w.x[i] + (ax / len) * 12,
          w.z[i] + (az / len) * 12,
          true,
        );
        w.mWait[i] = 0;
      }
    }
    const fleeing = w.mFlee[i] > 0;
    if (fleeing) w.mFlee[i] -= dt;

    if (w.mWait[i] > 0 && !fleeing) {
      w.mWait[i] -= dt;
      if (w.lift[i] !== 0 && kind !== K.flutter) this.settle(i);
      else if (kind === K.flutter) this.bob(i, dt, 0);
      return;
    }

    let tx = w.mTx[i];
    let tz = w.mTz[i];
    let dx = tx - w.x[i];
    let dz = tz - w.z[i];
    let d = Math.hypot(dx, dz);
    if (d < 0.3) {
      this.arrive(i, kind);
      tx = w.mTx[i];
      tz = w.mTz[i];
      dx = tx - w.x[i];
      dz = tz - w.z[i];
      d = Math.hypot(dx, dz);
      if (d < 0.3 || w.mWait[i] > 0) {
        if (w.lift[i] !== 0 && kind !== K.flutter) this.settle(i);
        return;
      }
    }
    const cap = SPEED_CAP * moveSpeed(holeDiameter(w.level[i]));
    const base =
      w.mSpeed[i] * (fleeing ? FLEE.mul : 1) * (kind === K.skitter ? 1.4 : 1);
    const speed = Math.min(cap, base);
    const step = Math.min(d, speed * dt);
    const nx = w.x[i] + (dx / d) * step;
    const nz = w.z[i] + (dz / d) * step;
    if (!this.ok(kind, nx, nz)) {
      // blocked: give up this target
      w.mTx[i] = w.x[i];
      w.mTz[i] = w.z[i];
      w.mWait[i] = this.rng.range(0.3, 1.2);
      return;
    }
    w.x[i] = nx;
    w.z[i] = nz;
    w.relocate(i);
    // face the way it walks (animals face +X: yaw = -atan2(dz, dx)), turning smoothly
    const want = -Math.atan2(dz, dx);
    let turn = want - w.rot[i];
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    const rate = (kind === K.roam ? 1.4 : 7) * dt;
    w.rot[i] += Math.max(-rate, Math.min(rate, turn));
    this.animate(i, kind, dt, speed);
    w.moving.add(i);
  }

  /** Pick the next target when the current one is reached. */
  private arrive(i: number, kind: number): void {
    const w = this.world;
    if (kind === K.trail || kind === K.patrol) {
      // go to the other end of the path
      const atHome =
        Math.hypot(w.x[i] - w.mHx[i], w.z[i] - w.mHz[i]) <
        Math.hypot(w.x[i] - w.mPx[i], w.z[i] - w.mPz[i]);
      w.mTx[i] = atHome ? w.mPx[i] : w.mHx[i];
      w.mTz[i] = atHome ? w.mPz[i] : w.mHz[i];
      w.mWait[i] = kind === K.patrol ? this.rng.range(0.4, 2) : 0;
      return;
    }
    const r = this.rng;
    for (let tries = 0; tries < 6; tries++) {
      const a = r.range(0, Math.PI * 2);
      const rad = Math.sqrt(r.next()) * w.mLeash[i];
      const tx = w.mHx[i] + Math.cos(a) * rad;
      const tz = w.mHz[i] + Math.sin(a) * rad;
      if (this.ok(kind, tx, tz) && this.clear(kind, w.x[i], w.z[i], tx, tz)) {
        w.mTx[i] = tx;
        w.mTz[i] = tz;
        break;
      }
    }
    w.mWait[i] =
      kind === K.skitter
        ? r.range(0.1, 0.8)
        : kind === K.hop
          ? r.range(0.3, 1.6)
          : kind === K.crawl
            ? r.range(0.5, 2)
            : kind === K.roam
              ? r.range(3, 9)
              : kind === K.flutter
                ? r.range(0, 0.6)
                : r.range(1, 4.5);
  }

  /** Point the mover at (x, z), pulled back inside its leash and onto ground it can use. */
  private aimAt(i: number, kind: number, x: number, z: number, flee: boolean) {
    const w = this.world;
    let dx = x - w.mHx[i];
    let dz = z - w.mHz[i];
    const d = Math.hypot(dx, dz);
    if (d > w.mLeash[i]) {
      dx *= w.mLeash[i] / d;
      dz *= w.mLeash[i] / d;
    }
    const tx = w.mHx[i] + dx;
    const tz = w.mHz[i] + dz;
    if (this.ok(kind, tx, tz) && this.clear(kind, w.x[i], w.z[i], tx, tz)) {
      w.mTx[i] = tx;
      w.mTz[i] = tz;
    } else if (flee) {
      // nowhere to run: freeze instead of walking into water
      w.mTx[i] = w.x[i];
      w.mTz[i] = w.z[i];
    }
  }

  /** Body motion in the instance matrix: hop arcs, flutter bob, a small walking bounce. */
  private animate(i: number, kind: number, dt: number, speed: number): void {
    const w = this.world;
    const size = w.size[i];
    if (kind === K.hop) {
      w.mPhase[i] += dt * 2.4;
      const s = Math.sin((w.mPhase[i] % 1) * Math.PI);
      w.lift[i] = s * Math.min(1.4, size * 0.7);
    } else if (kind === K.flutter) {
      this.bob(i, dt, speed);
    } else if (kind === K.swim) {
      w.mPhase[i] += dt * 3;
      w.lift[i] = Math.sin(w.mPhase[i]) * size * 0.015;
    } else {
      w.mPhase[i] += dt * (1.5 + speed * 0.8);
      w.lift[i] = Math.abs(Math.sin(w.mPhase[i] * Math.PI)) * size * 0.03;
    }
  }

  private bob(i: number, dt: number, speed: number): void {
    const w = this.world;
    w.mPhase[i] += dt * (2 + speed);
    w.lift[i] = 0.5 + 0.3 * Math.sin(w.mPhase[i] * 4);
    w.moving.add(i);
  }
}
