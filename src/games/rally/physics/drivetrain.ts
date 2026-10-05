import type { CarPhysicsDef, EngineDef } from './types';

const RPM_TO_RADS = (2 * Math.PI) / 60;

/**
 * Engine + gearbox + clutch, "lumped" style: when in gear the engine is rigidly
 * coupled to the driven wheels (its inertia is reflected onto them), except at
 * very low speed where an automatic clutch slips so the car can launch.
 *
 * Gear indices: -1 = reverse, 0 = neutral, 1..n = forward gears.
 */
export class Drivetrain {
  gear = 1;
  rpm: number;
  automatic = true;
  /** Seconds left in the current shift (no torque while > 0). */
  shiftTimer = 0;
  /** Total torque delivered to the driven wheels this step (Nm, signed). */
  wheelTorque = 0;
  /** True while the launch clutch is slipping. */
  clutchSlipping = false;
  /** Throttle actually seen by the engine (after rev limiter). */
  effectiveThrottle = 0;

  private sinceShift = 0;
  private declutched = false;
  private limiterCut = 0;

  constructor(private def: CarPhysicsDef) {
    this.rpm = def.engine.idleRpm;
  }

  get gearCount(): number {
    return this.def.gearbox.ratios.length;
  }

  /** Overall ratio engine:wheel for a gear (negative in reverse, 0 in neutral). */
  ratio(gear = this.gear): number {
    const gb = this.def.gearbox;
    if (gear === 0) return 0;
    if (gear < 0) return -gb.reverse * gb.finalDrive;
    return gb.ratios[gear - 1] * gb.finalDrive;
  }

  /** Engine inertia as seen by the driven wheels (sum over all of them). */
  reflectedInertia(): number {
    if (
      this.shiftTimer > 0 ||
      this.gear === 0 ||
      this.clutchSlipping ||
      this.declutched
    )
      return 0;
    const r = this.ratio();
    return this.def.engine.inertia * r * r;
  }

  setGear(gear: number): void {
    const g = Math.max(-1, Math.min(this.gearCount, gear));
    if (g === this.gear) return;
    this.gear = g;
    this.shiftTimer = this.def.gearbox.shiftTime;
    this.sinceShift = 0;
  }

  shiftUp(): void {
    this.setGear(this.gear + 1);
  }

  shiftDown(): void {
    this.setGear(this.gear - 1);
  }

  /**
   * @param drivenOmega average angular velocity of driven wheels (rad/s)
   * @param groundOmega wheel angular velocity implied by the car's ground speed;
   *        shift decisions use it so wheelspin doesn't cause gear hunting.
   */
  update(
    dt: number,
    throttle: number,
    drivenOmega: number,
    groundOmega = drivenOmega,
    declutch = false,
  ): void {
    const eng = this.def.engine;
    const gb = this.def.gearbox;
    this.sinceShift += dt;
    this.declutched = declutch;
    if (this.shiftTimer > 0)
      this.shiftTimer = Math.max(0, this.shiftTimer - dt);

    const ratio = this.ratio();
    const wheelRpm = (drivenOmega * ratio) / RPM_TO_RADS; // engine rpm implied by wheels
    const groundRpm = (groundOmega * ratio) / RPM_TO_RADS; // ... and by road speed

    // --- automatic gearbox -------------------------------------------------
    if (
      this.automatic &&
      this.gear >= 1 &&
      this.shiftTimer === 0 &&
      this.sinceShift > 0.35
    ) {
      if (
        wheelRpm > gb.upshiftRpm &&
        groundRpm > gb.upshiftRpm * 0.85 &&
        this.gear < this.gearCount
      ) {
        this.shiftUp();
      } else if (
        this.gear > 1 &&
        groundRpm < gb.downshiftRpm &&
        this.sinceShift > 1
      ) {
        const lowerRpm = groundRpm * (this.ratio(this.gear - 1) / ratio);
        if (lowerRpm < eng.redlineRpm * 0.88) this.shiftDown();
      }
    }

    // --- engine speed ------------------------------------------------------
    const clutchRpm = eng.idleRpm + throttle * (eng.launchRpm - eng.idleRpm);
    const freeRev = this.gear === 0 || this.shiftTimer > 0 || declutch;
    let targetRpm: number;
    if (freeRev) {
      targetRpm = eng.idleRpm + throttle * (eng.redlineRpm - eng.idleRpm);
      this.clutchSlipping = false;
    } else {
      const absWheelRpm = Math.abs(wheelRpm);
      this.clutchSlipping = absWheelRpm < clutchRpm;
      targetRpm = Math.max(
        absWheelRpm,
        this.clutchSlipping ? clutchRpm : eng.idleRpm,
      );
    }
    // Engaged: follow wheels exactly; free / slipping: spin up smoothly.
    const follow = !freeRev && !this.clutchSlipping ? 1 : Math.min(1, dt * 8);
    this.rpm += (targetRpm - this.rpm) * follow;
    this.rpm = Math.min(this.rpm, eng.redlineRpm + 200);

    // --- rev limiter ---------------------------------------------------------
    if (this.rpm >= eng.redlineRpm) this.limiterCut = 0.06;
    if (this.limiterCut > 0) this.limiterCut -= dt;
    const t = this.limiterCut > 0 ? 0 : throttle;
    this.effectiveThrottle = t;

    // --- torque to wheels --------------------------------------------------
    if (freeRev) {
      this.wheelTorque = 0;
      return;
    }
    let engineTorque = sampleTorque(eng, this.rpm) * t;
    // Engine braking only when the clutch is engaged.
    if (!this.clutchSlipping)
      engineTorque -= eng.engineBrake * (1 - t) * (this.rpm / eng.redlineRpm);
    this.wheelTorque = engineTorque * ratio * gb.efficiency;
  }
}

export function sampleTorque(eng: EngineDef, rpm: number): number {
  const c = eng.torqueCurve;
  if (rpm <= c[0][0]) return c[0][1];
  for (let i = 1; i < c.length; i++) {
    if (rpm <= c[i][0]) {
      const t = (rpm - c[i - 1][0]) / (c[i][0] - c[i - 1][0]);
      return c[i - 1][1] + (c[i][1] - c[i - 1][1]) * t;
    }
  }
  return c[c.length - 1][1];
}

/** Peak power in kW and the rpm it occurs at (for spec readouts). */
export function peakPower(eng: EngineDef): { kw: number; rpm: number } {
  let best = { kw: 0, rpm: 0 };
  for (let rpm = eng.idleRpm; rpm <= eng.redlineRpm; rpm += 50) {
    const kw = (sampleTorque(eng, rpm) * rpm * RPM_TO_RADS) / 1000;
    if (kw > best.kw) best = { kw, rpm };
  }
  return best;
}
