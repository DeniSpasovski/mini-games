import { Rng } from '../../../shared/rng';
import { RING_CORNERS } from '../map/city-movers';
import type { MapData, WalkGrid } from '../map/types';
import { teeterAmount } from './eat';
import { FallState } from './fall';
import { cameraDistance, holeDiameter, moveSpeed } from './progression';
import { RoadGraph } from './roads';
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
/** Cars: distance (m) from a crossing centre where the crossing starts (half the 10 m road). */
const CROSS_EDGE = 5;
/** Cars: a car held up this long (s) drives on regardless for `CREEP` seconds (breaks four-way stand-offs). */
const HELD_MAX = 3;
const CREEP = 2;
/** Cars: bumper gap (m) at which a car brakes for the vehicle in front. */
const GAP = 2.5;

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
  private roads: RoadGraph | undefined;

  constructor(
    private world: World,
    map: Pick<MapData, 'walk' | 'seed' | 'roads'>,
  ) {
    this.walk = map.walk;
    this.roads = map.roads ? new RoadGraph(map.roads) : undefined;
    this.rng = new Rng(map.seed * 7919 + 31);
    this.initPaths();
  }

  /** Resolve the road nodes of the cars and the first corner of the strollers from their specs. */
  private initPaths(): void {
    const w = this.world;
    for (const i of w.movers) {
      const kind = w.mKind[i];
      if (kind === K.drive && this.roads) {
        w.mFrom[i] = this.roads.nodeAt(w.mHx[i], w.mHz[i]);
        w.mNode[i] = this.roads.nodeAt(w.mPx[i], w.mPz[i]);
        if (w.mFrom[i] < 0) w.mNode[i] = -1;
      } else if (kind === K.stroll) {
        const sx = w.mPx[i] > w.mHx[i] ? 1 : -1;
        const sz = w.mPz[i] > w.mHz[i] ? 1 : -1;
        w.mNode[i] = RING_CORNERS.findIndex(
          ([cx, cz]) => cx === sx && cz === sz,
        );
        w.mTx[i] = w.mPx[i];
        w.mTz[i] = w.mPz[i];
      }
    }
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
      w.mVx[i] = 0;
      w.mVz[i] = 0;
      if (w.state[i] !== FallState.Idle) continue;
      const dx = w.x[i] - hole.x;
      const dz = w.z[i] - hole.z;
      const d2 = dx * dx + dz * dz;
      const seen = w.size[i] * VISIBLE;
      // cars never sleep: a frozen car would make the ones behind it queue up and merge with it (there are
      // only a few dozen, so driving them everywhere costs nothing)
      if (w.mKind[i] !== K.drive && (d2 > awake2 || d2 > seen * seen)) {
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
    if (kind === K.drive) return this.drive(i, dt);
    if (kind === K.stroll) return this.stroll(i, dt);
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
    w.mVx[i] = (nx - w.x[i]) / dt;
    w.mVz[i] = (nz - w.z[i]) / dt;
    w.x[i] = nx;
    w.z[i] = nz;
    w.relocate(i);
    this.face(i, dx, dz, (kind === K.roam ? 1.4 : 7) * dt);
    this.animate(i, kind, dt, speed);
    w.moving.add(i);
  }

  /** Turn towards the way it moves, at most `rate` rad: animals and vehicles face +X, people +Z. */
  private face(i: number, dx: number, dz: number, rate: number): void {
    const w = this.world;
    const want =
      w.types[w.type[i]].group === 'people'
        ? Math.atan2(dx, dz)
        : -Math.atan2(dz, dx);
    let turn = want - w.rot[i];
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    w.rot[i] += Math.max(-rate, Math.min(rate, turn));
  }

  /** Move `i` towards (tx, tz) at `speed`; returns the distance left. Sets the velocity the bot leads with. */
  private advance(
    i: number,
    dt: number,
    tx: number,
    tz: number,
    speed: number,
    turnRate: number,
  ): number {
    const w = this.world;
    const dx = tx - w.x[i];
    const dz = tz - w.z[i];
    const d = Math.hypot(dx, dz);
    if (d < 1e-6) return 0;
    const step = Math.min(d, speed * dt);
    const nx = w.x[i] + (dx / d) * step;
    const nz = w.z[i] + (dz / d) * step;
    w.mVx[i] = (nx - w.x[i]) / dt;
    w.mVz[i] = (nz - w.z[i]) / dt;
    w.x[i] = nx;
    w.z[i] = nz;
    w.relocate(i);
    this.face(i, dx, dz, turnRate * dt);
    w.moving.add(i);
    return d - step;
  }

  /** City Island people: walk the sidewalk ring of a block, pausing at corners and now and then turning back. */
  private stroll(i: number, dt: number): void {
    const w = this.world;
    if (w.mWait[i] > 0) {
      w.mWait[i] -= dt;
      return;
    }
    if (Math.hypot(w.mTx[i] - w.x[i], w.mTz[i] - w.z[i]) < 0.4) {
      let dir = w.mStage[i];
      if (this.rng.chance(0.25)) dir = -dir;
      w.mStage[i] = dir;
      const idx = (w.mNode[i] + dir + 4) % 4;
      w.mNode[i] = idx;
      w.mTx[i] = w.mHx[i] + RING_CORNERS[idx][0] * w.mLeash[i];
      w.mTz[i] = w.mHz[i] + RING_CORNERS[idx][1] * w.mLeash[i];
      if (this.rng.chance(0.3)) w.mWait[i] = this.rng.range(0.5, 2.5);
      return;
    }
    const speed = Math.min(
      SPEED_CAP * moveSpeed(holeDiameter(w.level[i])),
      w.mSpeed[i],
    );
    this.advance(i, dt, w.mTx[i], w.mTz[i], speed, 7);
    this.animate(i, K.stroll, dt, speed);
  }

  /**
   * City Island cars: drive along the road graph in the right-hand lane. On an arm the car heads for the
   * lane point where the next crossing starts; there it picks an exit (mostly straight on, a dead end turns
   * it round) and heads for the lane point where that arm starts, slower. It brakes for a vehicle in front
   * and, held up for `HELD_MAX` s (a four-way stand-off), creeps on for `CREEP` s.
   */
  private drive(i: number, dt: number): void {
    const w = this.world;
    const g = this.roads;
    if (!g || w.mNode[i] < 0) return;
    if (w.mWait[i] > 0) {
      w.mWait[i] -= dt;
      return;
    }
    const lane = w.mLeash[i];
    let tx = w.x[i];
    let tz = w.z[i];
    let found = false;
    for (let guard = 0; guard < 3 && !found; guard++) {
      const n = w.mNode[i];
      const f = w.mFrom[i];
      const nx = g.x[n];
      const nz = g.z[n];
      let dx = nx - g.x[f];
      let dz = nz - g.z[f];
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;
      const stage = w.mStage[i];
      if (stage === 0) {
        const along = (nx - w.x[i]) * dx + (nz - w.z[i]) * dz;
        if (along > CROSS_EDGE + 0.3) {
          tx = nx - dx * CROSS_EDGE - dz * lane;
          tz = nz - dz * CROSS_EDGE + dx * lane;
          found = true;
        } else {
          w.mNext[i] = this.pickExit(n, f, dx, dz);
          w.mStage[i] = w.mNext[i] === f ? 2 : 1;
        }
      } else if (stage === 2) {
        // dead end: swing round past the centre of the crossing, then leave on the other lane
        tx = nx + dx * 2;
        tz = nz + dz * 2;
        if (Math.hypot(tx - w.x[i], tz - w.z[i]) < 0.8) w.mStage[i] = 1;
        else found = true;
      } else {
        const m = w.mNext[i];
        let ex = g.x[m] - nx;
        let ez = g.z[m] - nz;
        const el = Math.hypot(ex, ez) || 1;
        ex /= el;
        ez /= el;
        tx = nx + ex * CROSS_EDGE - ez * lane;
        tz = nz + ez * CROSS_EDGE + ex * lane;
        if (Math.hypot(tx - w.x[i], tz - w.z[i]) < 0.8) {
          w.mFrom[i] = n;
          w.mNode[i] = m;
          w.mNext[i] = -1;
          w.mStage[i] = 0;
        } else found = true;
      }
    }
    if (!found) return;
    const cap = SPEED_CAP * moveSpeed(holeDiameter(w.level[i]));
    let speed = Math.min(cap, w.mSpeed[i]) * (w.mStage[i] === 0 ? 1 : 0.55);
    if (this.held(i, dt)) speed = 0;
    if (speed > 0) this.advance(i, dt, tx, tz, speed, 6);
  }

  /** Where a car at node `n` (coming from `f`, heading (dx, dz)) goes next. */
  private pickExit(n: number, f: number, dx: number, dz: number): number {
    const g = this.roads!;
    const adj = g.adj[n];
    if (adj.length <= 1) return f;
    let total = 0;
    const weight = (m: number): number => {
      if (m === f) return 0;
      const ex = g.x[m] - g.x[n];
      const ez = g.z[m] - g.z[n];
      return (ex * dx + ez * dz) / (Math.hypot(ex, ez) || 1) > 0.9 ? 4 : 1.5;
    };
    for (const m of adj) total += weight(m);
    let roll = this.rng.next() * total;
    for (const m of adj) {
      roll -= weight(m);
      if (roll <= 0 && weight(m) > 0) return m;
    }
    return adj.find((m) => m !== f) ?? f;
  }

  /** True while another vehicle is close in front of car `i` (and it has not been held up too long). */
  private held(i: number, dt: number): boolean {
    const w = this.world;
    if (w.mBlock[i] < 0) {
      w.mBlock[i] = Math.min(0, w.mBlock[i] + dt);
      return false;
    }
    const me = w.types[w.type[i]];
    const yaw = w.rot[i];
    const hx = Math.cos(yaw);
    const hz = -Math.sin(yaw);
    const reach = me.w / 2 + GAP + 6.5;
    let blocked = false;
    w.query(
      w.x[i] + (hx * reach) / 2,
      w.z[i] + (hz * reach) / 2,
      reach / 2 + 3,
      (j) => {
        if (blocked || j === i || w.state[j] !== FallState.Idle) return;
        const o = w.types[w.type[j]];
        if (o.group !== 'vehicle') return;
        const ox = w.x[j] - w.x[i];
        const oz = w.z[j] - w.z[i];
        const along = ox * hx + oz * hz;
        const lat = Math.abs(-ox * hz + oz * hx);
        const c = Math.abs(Math.cos(w.rot[j] - yaw));
        const s = Math.abs(Math.sin(w.rot[j] - yaw));
        const oAlong = c * (o.w / 2) + s * (o.d / 2);
        const oLat = c * (o.d / 2) + s * (o.w / 2);
        if (along > 0.2 && along - oAlong - me.w / 2 < GAP)
          if (lat < (me.d / 2 + oLat) * 0.95) blocked = true;
      },
    );
    if (!blocked) {
      w.mBlock[i] = Math.max(0, w.mBlock[i] - dt);
      return false;
    }
    w.mBlock[i] += dt;
    if (w.mBlock[i] > HELD_MAX) {
      w.mBlock[i] = -CREEP;
      return false;
    }
    return true;
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
