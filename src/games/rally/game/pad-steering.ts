import { paramNumber, paramOneOf } from '../../../shared/url-params';

/**
 * Gamepad steering: stick -> steer (-1..1, + = right). A stick has ~2 cm of travel and no force feedback, so racing
 * games don't map it straight to the wheel angle. The usual tools (Assetto Corsa / ACC "steering speed", "speed
 * sensitivity", "gamma"; EA WRC "linearity", "sensitivity"; gamepad mods that aim the front tyres at their peak slip
 * angle and add a caster-like self-steer):
 *  - a rack speed: the wheel takes a few hundred ms to wind on, and comes back faster;
 *  - speed-sensitive lock: full stick is the lock that grips best at that speed, not full lock (past it the fronts
 *    slide and the car turns less);
 *  - counter-steer allowance: steering into a slide may go past the speed limit;
 *  - a curve near the centre (gamma) for small corrections.
 *
 * Modes (Options -> Pad steering, or `?padsteer=` to test):
 *  - direct: the old mapping, stick ^1.4 straight to the wheels, no limit.
 *  - smooth: rack speed + speed-sensitive lock (the keyboard's) + counter-steer allowance.
 *  - buildup: like smooth but starts below the keyboard lock; holding the stick over to one side keeps winding
 *    more lock on (up to `build` more over `buildTime`), like turning a real wheel further in a long corner.
 *  - assist: aims the front tyres at a slip angle (full stick = the tyre's peak), measured from where the front axle
 *    is travelling, so the lock adapts to speed and surface and the wheels counter-steer a slide by themselves
 *    (`selfSteer`, like caster).
 */
export type PadSteerMode = 'direct' | 'smooth' | 'buildup' | 'assist';
export const PAD_STEER_MODES: readonly PadSteerMode[] = [
  'direct',
  'smooth',
  'buildup',
  'assist',
];
export const PAD_STEER_LABELS: Record<PadSteerMode, string> = {
  direct: 'Direct',
  smooth: 'Smooth',
  buildup: 'Build-up',
  assist: 'Grip assist',
};

export interface PadSteerTuning {
  /** Seconds to wind from centre to the current lock. */
  turnIn: number;
  /** Seconds back from the current lock to centre (stick released or eased). */
  release: number;
  /** Multiplier on the speed-sensitive lock (`keyboardSteerLimit`). Not used by direct / assist. */
  lock: number;
  /** Build-up: extra lock (share of `lock`) wound on while the stick is held over. */
  build: number;
  /** Build-up: seconds of holding to get all of `build`. */
  buildTime: number;
  /** Assist: front slip angle at full stick (1 = the tyre's peak on this surface). */
  slip: number;
  /** Assist: how far the wheels follow the front axle's travel with the stick centred (0..1, caster feel). */
  selfSteer: number;
}

export const PAD_STEER_TUNING: Record<PadSteerMode, PadSteerTuning> = {
  direct: {
    turnIn: 0,
    release: 0,
    lock: 1,
    build: 0,
    buildTime: 1,
    slip: 1,
    selfSteer: 0,
  },
  smooth: {
    turnIn: 0.2,
    release: 0.12,
    lock: 1,
    build: 0,
    buildTime: 1,
    slip: 1,
    selfSteer: 0,
  },
  buildup: {
    turnIn: 0.3,
    release: 0.12,
    lock: 0.6,
    build: 1,
    buildTime: 1,
    slip: 1,
    selfSteer: 0,
  },
  assist: {
    turnIn: 0.15,
    release: 0.1,
    lock: 1,
    build: 0,
    buildTime: 1,
    slip: 1,
    selfSteer: 0.7,
  },
};

/** URL tuning params -> tuning field (`?padsteer=buildup&steerturn=0.4&steerbuild=0.8`). */
const URL_TUNING: Record<string, [keyof PadSteerTuning, number, number]> = {
  steerturn: ['turnIn', 0, 2],
  steerrelease: ['release', 0, 2],
  steerlock: ['lock', 0.2, 3],
  steerbuild: ['build', 0, 3],
  steerbuildtime: ['buildTime', 0.1, 5],
  steerslip: ['slip', 0.2, 3],
  steerself: ['selfSteer', 0, 1],
};

/** Mode + tuning overrides from the URL (dev / tuning), each param validated. */
export function padSteerFromUrl(search: string): {
  mode: PadSteerMode | null;
  tuning: Partial<PadSteerTuning>;
} {
  const p = new URLSearchParams(search);
  const tuning: Partial<PadSteerTuning> = {};
  for (const [key, [field, min, max]] of Object.entries(URL_TUNING)) {
    const n = paramNumber(p.get(key), min, max, null);
    if (n !== null) tuning[field] = n;
  }
  return { mode: paramOneOf(p.get('padsteer'), PAD_STEER_MODES, null), tuning };
}

/** Stick X -> -1..1 after the dead zone, with a curve (gamma 1.4) so small corrections stay small. */
export function stickCurve(x: number): number {
  const dz = 0.08;
  const a = Math.abs(x);
  return a < dz ? 0 : Math.sign(x) * ((Math.min(1, a) - dz) / (1 - dz)) ** 1.4;
}

export interface PadDriveState {
  /** Forward speed (m/s). */
  speed: number;
  /** Body slip angle (rad), + = sliding towards the car's left. */
  slipAngle: number;
  /** Max wheel steer angle (rad). */
  maxSteer: number;
  /** Direction the front axle is travelling, relative to the car's nose (rad, + = left). */
  frontTravel: number;
  /** Front tyres' peak slip angle on the surface under them (rad). */
  frontPeakAngle: number;
  /** Speed-sensitive lock (fraction of full lock): `keyboardSteerLimit(speed)`. */
  speedLock: number;
}

const smoothstep = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

export class PadSteering {
  mode: PadSteerMode = 'buildup';
  tuning: PadSteerTuning = { ...PAD_STEER_TUNING.buildup };
  /** Seconds the stick has been held over to one side (build-up). */
  private held = 0;
  private heldSide = 0;
  /** Smoothed front-axle travel (steer units), assist. */
  private travel = 0;
  /** Last lock limit, for the telemetry line. */
  limit = 1;

  set(mode: PadSteerMode, overrides: Partial<PadSteerTuning> = {}): void {
    this.mode = mode;
    this.tuning = { ...PAD_STEER_TUNING[mode], ...overrides };
    this.held = 0;
  }

  /** New steer from the stick (`x` raw axis -1..1) and the current steer `cur`. */
  update(dt: number, x: number, cur: number, s: PadDriveState): number {
    const t = this.tuning;
    const stick = stickCurve(x);
    if (this.mode === 'direct') {
      this.limit = 1;
      return stick;
    }
    if (this.mode === 'assist') return this.assist(dt, stick, cur, s);

    // Hold timer: stick pushed most of the way to one side.
    const side = Math.abs(stick) > 0.7 ? Math.sign(stick) : 0;
    if (side !== 0 && side === this.heldSide) this.held += dt;
    else this.held = 0;
    this.heldSide = side;

    let limit = Math.min(1, s.speedLock * t.lock);
    if (t.build > 0)
      limit = Math.min(
        1,
        limit * (1 + t.build * smoothstep(this.held / t.buildTime)),
      );
    // Counter-steering into a slide may go past the speed limit (sliding left -> steering left).
    const counter = stick !== 0 && Math.sign(stick) === -Math.sign(s.slipAngle);
    if (counter)
      limit = Math.min(
        1,
        Math.max(limit, Math.abs(s.slipAngle) / s.maxSteer + limit),
      );
    this.limit = limit;
    const goal = stick * limit;
    return rack(dt, cur, goal, limit, t, counter);
  }

  private assist(
    dt: number,
    stick: number,
    cur: number,
    s: PadDriveState,
  ): number {
    const t = this.tuning;
    // Steer that points the fronts along their travel (+ steer = right, travel + = left).
    const travel = -s.frontTravel / s.maxSteer;
    this.travel += (travel - this.travel) * Math.min(1, dt / 0.05);
    const slip = (t.slip * s.frontPeakAngle) / s.maxSteer;
    const a = Math.abs(stick);
    const follow = t.selfSteer + (1 - t.selfSteer) * a;
    const aimed = this.travel * follow + stick * slip;
    // Below ~15 km/h the travel direction means little (and hairpins want full lock): plain stick there.
    const w = smoothstep((s.speed - 3) / 5);
    const goal = Math.max(-1, Math.min(1, stick * (1 - w) + aimed * w));
    this.limit = Math.abs(goal);
    return rack(dt, cur, goal, 1, t, false);
  }
}

/** Move `cur` towards `goal`: wind on over `turnIn` s of `range`, back (or into a counter-steer) over `release` s. */
function rack(
  dt: number,
  cur: number,
  goal: number,
  range: number,
  t: PadSteerTuning,
  counter: boolean,
): number {
  const returning = Math.abs(goal) < Math.abs(cur) || goal * cur < 0;
  const time = returning || counter ? t.release : t.turnIn;
  if (time <= 0) return goal;
  const rate = Math.max(range, 0.3) / time;
  return goal > cur
    ? Math.min(goal, cur + rate * dt)
    : Math.max(goal, cur - rate * dt);
}
