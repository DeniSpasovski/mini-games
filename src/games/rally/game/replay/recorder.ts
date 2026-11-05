/**
 * Records a run while it is driven (DOM-free). `step()` runs once per physics step after `Vehicle.step` and costs a few
 * dozen number writes into preallocated typed arrays: no allocation per step (the frame array doubles when full, a few
 * times per run at most). Two outputs:
 * - the replay rows: the car's state every `stride` steps (format.ts), saved per run;
 * - the physics trace: the last `TRACE_SECONDS` of EVERY step with tyre forces and exact inputs, in memory only
 *   (`traceText`: what a physics-debug session needs, F2 "Copy trace" / `__rally.replay.trace()`).
 */
import type { Vehicle } from '../../physics/vehicle';
import {
  CAR_CHANNELS,
  DEFAULT_STRIDE,
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
  SURFACE_IDS,
  WHEEL_CHANNELS,
  carCol,
  wheelCol,
} from './format';
import type { ReplayRows } from './codec';

/** What the recorder reads from the stage clock (StageTimer fits). */
export interface StageClock {
  phase: 'countdown' | 'running' | 'finished';
  time: number;
  progress: number;
  cutWarning: boolean;
  wrongWay: boolean;
}

/** Longest recording (s): a free drive left running stops recording here (the trace keeps going). */
export const MAX_SECONDS = 30 * 60;
/** Physics steps kept in the trace ring (s). */
export const TRACE_SECONDS = 20;

export const TRACE_COLUMNS = [
  'step',
  'throttle',
  'brake',
  'steer',
  'handbrake',
  'px',
  'py',
  'pz',
  'qx',
  'qy',
  'qz',
  'qw',
  'vx',
  'vy',
  'vz',
  'wx',
  'wy',
  'wz',
  'speed',
  'rpm',
  'gear',
  'effThrottle',
  'tcFactor',
  'impact',
  ...['FL', 'FR', 'RL', 'RR'].flatMap((w) =>
    [
      'load',
      'comp',
      'slipRatio',
      'slipAngle',
      'fx',
      'fy',
      'omega',
      'surface',
      'temp',
      'disc',
    ].map((c) => `${w}.${c}`),
  ),
] as const;
const TCH = TRACE_COLUMNS.length;
const WHEEL_TRACE0 = TRACE_COLUMNS.indexOf('FL.load');

const SURF_INDEX = new Map(SURFACE_IDS.map((s, i) => [s, i]));
const C_RPM = carCol('rpm');
const C_FLAGS = carCol('flags');

export class ReplayRecorder {
  readonly stride: number;
  readonly hz: number;
  private rows: Float64Array;
  frames = 0;
  /** Steps since the start (counts every step, recorded or not). */
  steps = 0;
  private teleport = true;
  /** Set when the run is over or the recording is full. */
  stopped = false;
  private trace: Float64Array;
  private traceSteps: number;
  private traceHead = 0;
  private traceCount = 0;

  /** `enabled` false (`REPLAYS_ENABLED` false): no buffers, `step` does nothing. */
  constructor(
    hz: number,
    stride = DEFAULT_STRIDE,
    readonly enabled = true,
  ) {
    this.hz = hz;
    this.stride = stride;
    // 3 minutes to start with; doubles (rarely) up to MAX_SECONDS.
    this.rows = new Float64Array(
      enabled ? Math.ceil((180 * hz) / stride) * ROW : 0,
    );
    this.traceSteps = enabled ? TRACE_SECONDS * hz : 0;
    this.trace = new Float64Array(this.traceSteps * TCH);
  }

  /** A new run (spawn, restart): drops the frames, keeps the buffers. */
  start(): void {
    this.frames = 0;
    this.steps = 0;
    this.teleport = true;
    this.stopped = false;
  }

  /** The car was moved by the game (reset to road, cut): the next frame starts a new segment. */
  markTeleport(): void {
    this.teleport = true;
  }

  /** After `Vehicle.step` + the stage clock's update. */
  step(v: Vehicle, clock: StageClock): void {
    if (!this.enabled) return;
    this.writeTrace(v);
    const s = this.steps++;
    if (this.stopped || s % this.stride !== 0) return;
    if (this.frames * this.stride >= MAX_SECONDS * this.hz) {
      this.stopped = true;
      return;
    }
    if ((this.frames + 1) * ROW > this.rows.length) {
      const grown = new Float64Array(this.rows.length * 2);
      grown.set(this.rows);
      this.rows = grown;
    }
    const r = this.rows;
    const o = this.frames * ROW;
    r[o] = v.position.x;
    r[o + 1] = v.position.y;
    r[o + 2] = v.position.z;
    r[o + 3] = v.quaternion.x;
    r[o + 4] = v.quaternion.y;
    r[o + 5] = v.quaternion.z;
    r[o + 6] = v.quaternion.w;
    for (let i = 0; i < 4; i++) {
      const w = v.wheels[i];
      const b = o + wheelCol(i, 0);
      r[b] = w.omega;
      r[b + 1] = w.temp;
      r[b + 2] = w.brakeTemp;
    }
    const d = v.drivetrain;
    const c = o + C_RPM;
    r[c] = d.rpm;
    r[c + 1] = d.gear;
    r[c + 2] = d.effectiveThrottle;
    r[c + 3] = v.controls.throttle;
    r[c + 4] = v.controls.brake;
    r[c + 5] = v.controls.steer;
    r[c + 6] = v.controls.handbrake;
    r[c + 7] = v.impact;
    r[o + C_FLAGS] =
      (v.tractionControl ? F_TC_ON : 0) |
      (v.tcFactor < 0.95 ? F_TC_ACTIVE : 0) |
      (v.abs ? F_ABS_ON : 0) |
      (absEasing(v) ? F_ABS_ACTIVE : 0) |
      (v.parked || v.holding ? F_HOLD : 0) |
      (d.automatic ? F_AUTO : 0) |
      (this.teleport ? F_TELEPORT : 0) |
      (clock.cutWarning ? F_CUT_WARN : 0) |
      (clock.wrongWay ? F_WRONG_WAY : 0) |
      (clock.phase === 'running' ? F_RUNNING : 0) |
      (clock.phase === 'finished' ? F_FINISHED : 0);
    r[c + 9] = clock.time;
    r[c + 10] = clock.progress;
    this.teleport = false;
    this.frames++;
  }

  /** The recorded frames (a view: copy before the next `start`). */
  get recording(): ReplayRows {
    return {
      frames: this.frames,
      rows: this.rows.subarray(0, this.frames * ROW),
    };
  }

  /** A copy of the frames for encoding later (the recorder keeps going / restarts). */
  snapshot(): ReplayRows {
    return { frames: this.frames, rows: this.rows.slice(0, this.frames * ROW) };
  }

  /** Seconds recorded. */
  get seconds(): number {
    return (this.frames * this.stride) / this.hz;
  }

  private writeTrace(v: Vehicle): void {
    const t = this.trace;
    const o = this.traceHead * TCH;
    const c = v.controls;
    t[o] = this.steps;
    t[o + 1] = c.throttle;
    t[o + 2] = c.brake;
    t[o + 3] = c.steer;
    t[o + 4] = c.handbrake;
    t[o + 5] = v.position.x;
    t[o + 6] = v.position.y;
    t[o + 7] = v.position.z;
    t[o + 8] = v.quaternion.x;
    t[o + 9] = v.quaternion.y;
    t[o + 10] = v.quaternion.z;
    t[o + 11] = v.quaternion.w;
    t[o + 12] = v.velocity.x;
    t[o + 13] = v.velocity.y;
    t[o + 14] = v.velocity.z;
    t[o + 15] = v.angularVelocity.x;
    t[o + 16] = v.angularVelocity.y;
    t[o + 17] = v.angularVelocity.z;
    t[o + 18] = v.speed;
    t[o + 19] = v.drivetrain.rpm;
    t[o + 20] = v.drivetrain.gear;
    t[o + 21] = v.drivetrain.effectiveThrottle;
    t[o + 22] = v.tcFactor;
    t[o + 23] = v.impact;
    for (let i = 0; i < 4; i++) {
      const w = v.wheels[i];
      const b = o + WHEEL_TRACE0 + i * 10;
      t[b] = w.load;
      t[b + 1] = w.compression;
      t[b + 2] = w.slipRatio;
      t[b + 3] = w.slipAngle;
      t[b + 4] = w.fx;
      t[b + 5] = w.fy;
      t[b + 6] = w.omega;
      t[b + 7] = w.contact ? (SURF_INDEX.get(w.surface.id) ?? 0) : -1;
      t[b + 8] = w.temp;
      t[b + 9] = w.brakeTemp;
    }
    this.traceHead = (this.traceHead + 1) % this.traceSteps;
    this.traceCount = Math.min(this.traceSteps, this.traceCount + 1);
  }

  /**
   * The last `seconds` of the trace as tab-separated text (header line first; surfaces by name, -1 = in the air),
   * every `every`-th step (1 = all 240 per second). Inputs are exact (`toPrecision(17)`); the rest is rounded to 5
   * significant digits.
   */
  traceText(seconds = 5, every = 4): string {
    const n = Math.min(this.traceCount, Math.round(seconds * this.hz));
    const lines = [TRACE_COLUMNS.join('\t')];
    const first = this.traceHead - n;
    for (let k = 0; k < n; k += every) {
      const i = (first + k + this.traceSteps) % this.traceSteps;
      const o = i * TCH;
      const cells: string[] = [];
      for (let j = 0; j < TCH; j++) {
        const x = this.trace[o + j];
        const name = TRACE_COLUMNS[j];
        cells.push(
          j >= 1 && j <= 4
            ? String(x)
            : name.endsWith('.surface')
              ? x < 0
                ? '-'
                : SURFACE_IDS[x]
              : j === 0 || name === 'gear'
                ? String(x)
                : String(Number(x.toPrecision(5))),
        );
      }
      lines.push(cells.join('\t'));
    }
    return lines.join('\n');
  }
}

/** `Vehicle.absActive` without its closure (the recorder allocates nothing per step). */
function absEasing(v: Vehicle): boolean {
  for (let i = 0; i < 4; i++) if (v.wheels[i].absFactor < 0.95) return true;
  return false;
}

/** Every column name in a replay row (debug dumps, tests). */
export const ROW_NAMES: string[] = [
  'px',
  'py',
  'pz',
  'qx',
  'qy',
  'qz',
  'qw',
  ...['FL', 'FR', 'RL', 'RR'].flatMap((w) =>
    WHEEL_CHANNELS.map((c) => `${w}.${c}`),
  ),
  ...CAR_CHANNELS,
];
