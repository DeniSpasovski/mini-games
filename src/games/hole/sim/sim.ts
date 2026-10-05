import { clampToMap, type MapData } from '../map/types';
import { FallState, fallDuration, fallParams, fallPose } from './fall';
import { commitRadius, startsFalling, teeterAmount } from './eat';
import {
  CLEAR_BONUS_PER_SECOND,
  MAX_LEVEL,
  TIER_COUNT,
  clampLevel,
  holeDiameter,
  moveSpeed,
  pointsForTier,
  levelTier,
  xpToNext,
} from './progression';
import { Movers } from './movers';
import { World } from './world';

export type SimEvent =
  | { type: 'eat'; item: number; points: number; x: number; z: number }
  | { type: 'levelup'; level: number }
  | { type: 'cleared' }
  | { type: 'end' };

export interface HoleState {
  x: number;
  z: number;
  vx: number;
  vz: number;
  level: number;
  /** XP into the current level. */
  xp: number;
  /** Displayed (animated) diameter. */
  diameter: number;
}

export interface SimOptions {
  seconds: number;
  startLevel?: number;
  start?: { x: number; z: number };
}

/** Time (s) for the hole to reach full speed / stop. */
const ACCEL_TIME = 0.12;
const BRAKE_TIME = 0.08;
/** The hole keeps this fraction of its diameter away from the coast so it never overlaps water. */
export const COAST_INSET = 0.5;
/** Teeter query margin beyond the hole radius (m). */
const TEETER_MARGIN = 12;

/**
 * The whole game simulation: hole, items, score, timer. Fixed step, no
 * rendering and no DOM, so it runs in node (tests, balance bot).
 */
export class Sim {
  readonly world: World;
  /** Moving items (Animal Island); empty on the other maps. */
  readonly movers: Movers;
  readonly hole: HoleState;
  readonly events: SimEvent[] = [];
  /** Items eaten per size tier (index 1..25). */
  readonly eatenPerTier = new Array<number>(TIER_COUNT + 1).fill(0);
  score = 0;
  pointsEaten = 0;
  itemsEaten = 0;
  time = 0;
  readonly limit: number;
  over = false;
  cleared = false;
  clearBonus = 0;

  constructor(
    readonly map: MapData,
    opts: SimOptions,
  ) {
    this.world = new World(map);
    this.movers = new Movers(this.world, map);
    this.limit = opts.seconds;
    const level = clampLevel(opts.startLevel ?? 1);
    const s = opts.start ?? map.start;
    this.hole = {
      x: s.x,
      z: s.z,
      vx: 0,
      vz: 0,
      level,
      xp: 0,
      diameter: holeDiameter(level),
    };
  }

  get timeLeft(): number {
    return Math.max(0, this.limit - this.time);
  }

  get targetDiameter(): number {
    return holeDiameter(this.hole.level);
  }

  /**
   * Advance by `dt` seconds. (dirX, dirZ) is the world-space stick vector,
   * magnitude 0..1 (the game converts the touch joystick with the camera yaw).
   */
  step(dt: number, dirX: number, dirZ: number): void {
    const h = this.hole;
    if (!this.over) {
      this.time += dt;
      this.moveHole(dt, dirX, dirZ);
      this.movers.step(dt, h, false);
      this.commitItems();
      if (this.world.remaining === 0 && !this.cleared) {
        this.cleared = true;
        this.events.push({ type: 'cleared' });
      }
      if (this.time >= this.limit || this.cleared) this.finish();
    } else {
      h.vx = h.vz = 0;
    }
    // grow animation (exponential approach)
    h.diameter +=
      (this.targetDiameter - h.diameter) * (1 - Math.exp(-dt / 0.18));
    this.updateActive(dt);
  }

  /** True once the run is over and every falling item has finished. */
  get settled(): boolean {
    return this.over && this.world.active.size === 0;
  }

  private finish(): void {
    if (this.over) return;
    this.over = true;
    if (this.cleared) {
      this.clearBonus = Math.round(this.timeLeft * CLEAR_BONUS_PER_SECOND);
      this.score += this.clearBonus;
    }
    this.events.push({ type: 'end' });
  }

  private moveHole(dt: number, dirX: number, dirZ: number): void {
    const h = this.hole;
    const speed = moveSpeed(h.diameter);
    const mag = Math.hypot(dirX, dirZ);
    const k = mag > 1 ? 1 / mag : 1;
    const tx = dirX * k * speed;
    const tz = dirZ * k * speed;
    const accelerating = mag > 0.001;
    const rate = speed / (accelerating ? ACCEL_TIME : BRAKE_TIME);
    const dvx = tx - h.vx;
    const dvz = tz - h.vz;
    const dv = Math.hypot(dvx, dvz);
    const maxDv = rate * dt;
    if (dv <= maxDv) {
      h.vx = tx;
      h.vz = tz;
    } else {
      h.vx += (dvx / dv) * maxDv;
      h.vz += (dvz / dv) * maxDv;
    }
    h.x += h.vx * dt;
    h.z += h.vz * dt;
    const inset = this.map.bounds?.inset ?? COAST_INSET;
    const c = clampToMap(this.map, h.x, h.z, inset * this.targetDiameter);
    if (c.nx !== 0 || c.nz !== 0) {
      // slide along the edge: drop the velocity component pointing outwards
      const out = h.vx * c.nx + h.vz * c.nz;
      if (out > 0) {
        h.vx -= out * c.nx;
        h.vz -= out * c.nz;
      }
      h.x = c.x;
      h.z = c.z;
    }
  }

  private commitItems(): void {
    const { world, hole } = this;
    const d = hole.diameter;
    world.query(hole.x, hole.z, d / 2 + TEETER_MARGIN, (i) => {
      if (world.state[i] !== FallState.Idle) return;
      const dx = hole.x - world.x[i];
      const dz = hole.z - world.z[i];
      const dist = Math.hypot(dx, dz);
      const size = world.size[i];
      if (startsFalling(hole.level, d, size, dist)) {
        this.commit(i, Math.atan2(dz, dx), dist);
      } else if (world.level[i] > hole.level) {
        if (teeterAmount(d, size, dist) > 0) world.active.add(i);
      }
    });
  }

  private commit(i: number, dir: number, dist: number): void {
    const { world, hole } = this;
    world.state[i] = FallState.Tipping;
    world.t[i] = 0;
    world.dir[i] = dir;
    world.pull[i] = dist;
    world.teeter[i] = 0;
    world.fall[i] = fallParams(
      world.size[i],
      world.height[i],
      hole.diameter,
      world.seed[i],
    );
    world.active.add(i);
    world.remaining--;
    const pts = world.points[i];
    this.score += pts;
    this.pointsEaten += pts;
    this.itemsEaten++;
    this.eatenPerTier[world.tier[i]]++;
    this.events.push({
      type: 'eat',
      item: i,
      points: pts,
      x: world.x[i],
      z: world.z[i],
    });
    this.addXp(pts);
  }

  private addXp(pts: number): void {
    const h = this.hole;
    h.xp += pts;
    while (h.level < MAX_LEVEL && h.xp >= xpToNext(h.level)) {
      h.xp -= xpToNext(h.level);
      h.level++;
      this.events.push({ type: 'levelup', level: h.level });
    }
  }

  private updateActive(dt: number): void {
    const { world, hole } = this;
    for (const i of world.active) {
      if (world.state[i] === FallState.Idle) {
        // teeter: lean towards the hole, relax when it leaves
        const dx = hole.x - world.x[i];
        const dz = hole.z - world.z[i];
        const target = this.over
          ? 0
          : teeterAmount(hole.diameter, world.size[i], Math.hypot(dx, dz));
        if (target > 0) world.dir[i] = Math.atan2(dz, dx);
        world.teeter[i] +=
          (target - world.teeter[i]) * (1 - Math.exp(-dt / 0.12));
        if (world.teeter[i] < 0.003 && target === 0) {
          world.teeter[i] = 0;
          world.active.delete(i);
        }
        continue;
      }
      world.t[i] += dt;
      const p = world.fall[i]!;
      if (world.t[i] >= fallDuration(p) || fallPose(p, world.t[i]).done) {
        world.state[i] = FallState.Gone;
        world.fall[i] = null;
        world.active.delete(i);
        world.gone.push(i);
      }
    }
  }

  /** Jump to a level (viewers / dev keys): no XP, the diameter animates. */
  setLevel(level: number): void {
    const l = clampLevel(level);
    if (l !== this.hole.level) this.events.push({ type: 'levelup', level: l });
    this.hole.level = l;
    this.hole.xp = 0;
  }

  /** Pop the events produced since the last call. */
  drainEvents(): SimEvent[] {
    return this.events.splice(0, this.events.length);
  }

  /** Radius (m) inside which an item of `size` would commit right now. */
  commitRadiusFor(size: number): number {
    return commitRadius(this.hole.diameter, size);
  }

  /** XP progress 0..1 of the current level. */
  get levelProgress(): number {
    const need = xpToNext(this.hole.level);
    return Number.isFinite(need) ? this.hole.xp / need : 1;
  }

  /** Points of the biggest size tier a level can eat (for HUD labels). */
  pointsAtLevel(level: number): number {
    return pointsForTier(levelTier(level));
  }
}
