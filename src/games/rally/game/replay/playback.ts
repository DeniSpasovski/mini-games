/**
 * Replay playback (DOM-free): poses the game's own `Vehicle` from the recorded frames at any time `t`, so everything that
 * reads the car - model, wheels, lamps, dust, tyre marks, sound, HUD, camera - runs unchanged and the physics never
 * steps. Position: Catmull-Rom through the frames (its derivative is the velocity); rotation: slerp; wheels and pedals:
 * linear; gear, surface and flags: the nearer frame. Never interpolates across a `F_TELEPORT` frame (reset, cut).
 */
import { Quaternion, Vector3 } from 'three';
import { LOW_SPEED_LAT, LOW_SPEED_LONG } from '../../physics/tire';
import type { Vehicle } from '../../physics/vehicle';
import type { DecodedReplay } from './codec';
import { sectorGaps, sectorsOf } from '../stage';
import {
  F_ABS_ACTIVE,
  F_ABS_ON,
  F_AUTO,
  F_CUT_WARN,
  F_FINISHED,
  F_HOLD,
  F_RUNNING,
  F_TC_ACTIVE,
  F_TC_ON,
  F_TELEPORT,
  F_WRONG_WAY,
  ROW,
  WHEEL_CHANNELS,
  carCol,
  wheelCol,
  type ReplayHeader,
} from './format';

const C = {
  rpm: carCol('rpm'),
  gear: carCol('gear'),
  eff: carCol('effThrottle'),
  thr: carCol('throttle'),
  brk: carCol('brake'),
  steer: carCol('steer'),
  hb: carCol('handbrake'),
  impact: carCol('impact'),
  flags: carCol('flags'),
  time: carCol('stageTime'),
  progress: carCol('progress'),
};
const W = Object.fromEntries(WHEEL_CHANNELS.map((c, i) => [c, i])) as Record<
  (typeof WHEEL_CHANNELS)[number],
  number
>;

const _qa = new Quaternion();
const _qb = new Quaternion();
const _qd = new Quaternion();
const _v = new Vector3();
const _vp = new Vector3();
const _fwd = new Vector3();
const _side = new Vector3();

export class ReplayTrack {
  readonly header: ReplayHeader;
  readonly rows: Float64Array;
  readonly frames: number;
  /** Frames per second. */
  readonly rate: number;
  /** Seconds of recording. */
  readonly duration: number;
  /** Replay time (s) of GO (the first running frame; 0 = none). */
  readonly goTime: number;
  /** Replay time (s) the car crossed the finish line (= duration when it never did). */
  readonly finishTime: number;
  /** Replay times (s) of each split crossing (from the recorded clock). */
  readonly splitAt: number[];
  /** Frame index of the last frame that played (impacts fire once per frame passed). */
  private lastFrame = -1;
  private airTime = 0;

  constructor(r: DecodedReplay) {
    this.header = r.header;
    this.rows = r.rows;
    this.frames = r.header.frames;
    this.rate = r.header.hz / r.header.stride;
    this.duration = Math.max(0, (this.frames - 1) / this.rate);
    let go = 0;
    let fin = this.duration;
    for (let f = 0; f < this.frames; f++) {
      const fl = this.rows[f * ROW + C.flags];
      if (!go && fl & F_RUNNING) go = f / this.rate;
      if (fl & F_FINISHED && (f === 0 || !(this.flags(f - 1) & F_FINISHED))) {
        fin = f / this.rate;
        break;
      }
    }
    this.goTime = go;
    this.finishTime = fin;
    this.splitAt = r.header.splits.map((s) => this.timeOfClock(s));
  }

  private flags(f: number): number {
    return this.rows[f * ROW + C.flags];
  }

  /** Replay time (s) when the recorded stage clock first reached `clock` (s). */
  timeOfClock(clock: number): number {
    for (let f = 0; f < this.frames; f++)
      if (
        this.flags(f) & (F_RUNNING | F_FINISHED) &&
        this.rows[f * ROW + C.time] >= clock - 1e-6
      )
        return f / this.rate;
    return this.duration;
  }

  value(f: number, col: number): number {
    return this.rows[Math.max(0, Math.min(this.frames - 1, f)) * ROW + col];
  }

  /** The car's position at time `t` (no vehicle needed: TV camera planning, the timeline). */
  positionAt(t: number, out: Vector3): Vector3 {
    const { i, u } = this.locate(t);
    return this.catmull(i, u, out, false);
  }

  /** Frame index + fraction at time `t`, held at a teleport. */
  locate(t: number): { i: number; u: number } {
    const x = Math.max(0, Math.min(this.frames - 1, t * this.rate));
    const i = Math.min(this.frames - 1, Math.floor(x));
    let u = x - i;
    if (i + 1 >= this.frames || this.flags(i + 1) & F_TELEPORT) u = 0;
    return { i, u };
  }

  /** Catmull-Rom of the positions (or its derivative in m/s), clamped to the frames of this segment. */
  private catmull(
    i: number,
    u: number,
    out: Vector3,
    derivative: boolean,
  ): Vector3 {
    const r = this.rows;
    const last = this.frames - 1;
    const i1 = Math.min(last, i + 1);
    const seg1 = i1 !== i && !(this.flags(i1) & F_TELEPORT);
    const j1 = seg1 ? i1 : i;
    const i0 = i > 0 && !(this.flags(i) & F_TELEPORT) ? i - 1 : i;
    const i2 =
      seg1 && i1 + 1 <= last && !(this.flags(i1 + 1) & F_TELEPORT)
        ? i1 + 1
        : j1;
    const u2 = u * u;
    const u3 = u2 * u;
    for (let k = 0; k < 3; k++) {
      const p0 = r[i0 * ROW + k];
      const p1 = r[i * ROW + k];
      const p2 = r[j1 * ROW + k];
      const p3 = r[i2 * ROW + k];
      const val = derivative
        ? 0.5 *
          (-p0 +
            p2 +
            2 * u * (2 * p0 - 5 * p1 + 4 * p2 - p3) +
            3 * u2 * (-p0 + 3 * p1 - 3 * p2 + p3)) *
          this.rate
        : 0.5 *
          (2 * p1 +
            (-p0 + p2) * u +
            (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 +
            (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
      out.setComponent(k, val);
    }
    return out;
  }

  /** Recorded stage clock / progress / flags at `t`. */
  clockAt(t: number): {
    time: number;
    progress: number;
    flags: number;
  } {
    const { i, u } = this.locate(t);
    const f = u > 0.5 ? i + 1 : i;
    return {
      time: this.lerp(i, u, C.time),
      progress: this.lerp(i, u, C.progress),
      flags: this.flags(Math.min(this.frames - 1, f)),
    };
  }

  private lerp(i: number, u: number, col: number): number {
    const a = this.value(i, col);
    return u ? a + (this.value(i + 1, col) - a) * u : a;
  }

  /** Forget which frames played (after a seek: no impacts fire for the frames skipped). */
  seeked(t: number): void {
    this.lastFrame = this.locate(t).i;
  }

  /**
   * Pose `v` at time `t`. `dt` = real playback step (s, signed: negative while scrubbing back) for the wheel spin.
   * Returns true when this frame crossed a teleport (the camera should snap).
   */
  apply(t: number, dt: number, v: Vehicle): boolean {
    const { i, u } = this.locate(t);
    const r = this.rows;
    const j = Math.min(this.frames - 1, i + (u > 0 ? 1 : 0));
    const near = u > 0.5 ? j : i;
    const a = i * ROW;
    const b = j * ROW;
    const fl = r[near * ROW + C.flags];

    this.catmull(i, u, v.position, false);
    this.catmull(i, u, v.velocity, true);
    _qa.set(r[a + 3], r[a + 4], r[a + 5], r[a + 6]).normalize();
    _qb.set(r[b + 3], r[b + 4], r[b + 5], r[b + 6]).normalize();
    v.quaternion.slerpQuaternions(_qa, _qb, u);
    v.prev.position.copy(v.position);
    v.prev.quaternion.copy(v.quaternion);
    // Angular velocity from the two frames' rotations (the slide speeds need the yaw rate).
    _qd.copy(_qb).multiply(_qa.invert());
    if (_qd.w < 0) _qd.set(-_qd.x, -_qd.y, -_qd.z, -_qd.w);
    const half = Math.acos(Math.min(1, _qd.w));
    const sinHalf = Math.sin(half);
    if (j !== i && sinHalf > 1e-9)
      v.angularVelocity
        .set(_qd.x, _qd.y, _qd.z)
        .multiplyScalar((2 * half * this.rate) / sinHalf);
    else v.angularVelocity.set(0, 0, 0);
    v.right.set(1, 0, 0).applyQuaternion(v.quaternion);
    v.up.set(0, 1, 0).applyQuaternion(v.quaternion);
    v.forward.set(0, 0, 1).applyQuaternion(v.quaternion);
    // The wheels on the ground: the physics' own ray at this pose (extension, contact, surface, contact patch).
    v.probeGround();

    const L = (col: number) => r[a + col] + (r[b + col] - r[a + col]) * u;
    const steer = L(C.steer);
    const steerRad = -steer * v.def.maxSteerDeg * (Math.PI / 180);
    let contacts = 0;
    for (let k = 0; k < 4; k++) {
      const w = v.wheels[k];
      w.omega = L(wheelCol(k, W.omega));
      w.spin += w.omega * dt;
      w.temp = L(wheelCol(k, W.temp));
      w.brakeTemp = L(wheelCol(k, W.disc));
      w.steerAngle = steerRad * w.axle.steer;
      w.absFactor = fl & F_ABS_ACTIVE ? 0.5 : 1;
      if (!w.contact) {
        w.contactSpeed = w.slideSpeed = 0;
        w.slipAngle = w.slipRatio = 0;
        continue;
      }
      contacts++;
      // Contact patch velocity in the wheel's frame, as Vehicle.wheelPass works it out.
      const n = w.contactNormal;
      _fwd
        .set(Math.sin(w.steerAngle), 0, Math.cos(w.steerAngle))
        .applyQuaternion(v.quaternion);
      _fwd.addScaledVector(n, -_fwd.dot(n)).normalize();
      _side.crossVectors(n, _fwd).normalize();
      _v.subVectors(w.contactPoint, v.position);
      _vp.crossVectors(v.angularVelocity, _v).add(v.velocity);
      const vx = _vp.dot(_fwd);
      const vy = _vp.dot(_side);
      w.contactSpeed = Math.hypot(vx, vy);
      w.slideSpeed = Math.hypot(w.omega * w.radius - vx, vy);
      // Slip as physics/tire.ts computeTire has it (tyre marks read the angle: scuffs vs rolling prints).
      w.slipRatio =
        (w.omega * w.radius - vx) / Math.max(Math.abs(vx), LOW_SPEED_LONG);
      w.slipAngle = Math.atan2(vy, Math.max(Math.abs(vx), LOW_SPEED_LAT));
    }
    this.airTime = contacts ? 0 : this.airTime + Math.abs(dt);
    v.airTime = this.airTime;

    const d = v.drivetrain;
    d.rpm = L(C.rpm);
    d.gear = r[near * ROW + C.gear];
    d.effectiveThrottle = L(C.eff);
    d.automatic = !!(fl & F_AUTO);
    v.controls.throttle = L(C.thr);
    v.controls.brake = L(C.brk);
    v.controls.steer = steer;
    v.controls.handbrake = L(C.hb);
    v.tractionControl = !!(fl & F_TC_ON);
    v.tcFactor = fl & F_TC_ACTIVE ? 0.5 : 1;
    v.abs = !!(fl & F_ABS_ON);
    v.holding = !!(fl & F_HOLD);
    v.parked = false;

    // Impacts fire once for the frames passed since the last call (none when scrubbing back).
    let impact = 0;
    let teleport = false;
    if (i > this.lastFrame && dt >= 0) {
      for (let f = this.lastFrame + 1; f <= i; f++) {
        impact = Math.max(impact, r[f * ROW + C.impact]);
        if (f > 0 && this.flags(f) & F_TELEPORT) teleport = true;
      }
    } else if (i !== this.lastFrame)
      teleport = Math.abs(i - this.lastFrame) > 2;
    v.impact = impact;
    this.lastFrame = i;
    return teleport;
  }
}

/** The stage clock seen by the HUD during a replay (the part of StageTimer it reads). */
export class ReplayClock {
  phase: 'countdown' | 'running' | 'finished' = 'countdown';
  time = 0;
  progress = 0;
  splitTimes: number[] = [];
  finishTime: number | null = null;
  cutWarning = false;
  wrongWay = false;
  shortcut = false;
  returning = false;
  cutTimer = 0;

  constructor(
    private track: ReplayTrack,
    readonly sectorBounds: number[],
  ) {}

  update(t: number): void {
    const c = this.track.clockAt(t);
    const h = this.track.header;
    this.time = c.time;
    this.progress = c.progress;
    this.phase =
      c.flags & F_FINISHED
        ? 'finished'
        : c.flags & F_RUNNING
          ? 'running'
          : 'countdown';
    this.cutWarning = !!(c.flags & F_CUT_WARN);
    this.wrongWay = !!(c.flags & F_WRONG_WAY);
    let n = 0;
    while (n < h.splits.length && t >= this.track.splitAt[n]) n++;
    if (this.splitTimes.length !== n) this.splitTimes = h.splits.slice(0, n);
    this.finishTime =
      this.phase === 'finished' && h.time !== undefined ? h.time : null;
    if (this.finishTime !== null) this.time = this.finishTime;
  }

  sectorTimes(): number[] {
    return sectorsOf(this.splitTimes, this.finishTime);
  }

  sectorDeltas(): (number | undefined)[] {
    return sectorGaps(this.sectorTimes(), this.track.header.refSectors);
  }
}
