import { roadSurfaceAt } from '../maps/shared/types';
import type { VehicleControls } from '../physics/types';
import { PHYSICS_HZ, type Vehicle } from '../physics/vehicle';
import { newRoadQuery, type Road } from '../world/road';

/**
 * Simple road-following driver. No DOM, so it runs in tests too:
 *  - pure pursuit on the VELOCITY direction (not the nose), so it counter-steers
 *    naturally when the car slides
 *  - speed plan from curvature ahead + braking distance
 *  - lifts off when the car is sliding too much
 *  - corner speed follows the grip of the fitted tyre on the road surface ahead (never above the
 *    gravel-grade baseline, so the right tyre drives like before and a wrong one slows down)
 * Used by integration-tests/rally/stage.test.ts (stage is completable, no flips) and
 * in-game with F8 (soak / perf testing, screenshots).
 */
/** Surface mu the cornering plan (0.7 g) was tuned for (gravel); more grip only speeds it up with `useExtraGrip`. */
const REF_MU = 0.86;

export class Autopilot {
  /** 0..1, scales cornering speed (1 = brave). */
  aggression = 0.6;
  /**
   * Corner (and braking) speed also rises with grip above the gravel baseline, so a tyre that grips more
   * is actually driven faster. Off by default: stage.test.ts and the F8 autopilot keep the tuned pace.
   * integration-tests/rally/tyres.test.ts turns it on to measure what a tyre is worth over a whole stage.
   */
  useExtraGrip = false;
  /** Fastest it ever goes (m/s; 42 = 151 km/h keeps the stage tests' pace). Tests raise it to measure top speed. */
  maxSpeed = 42;
  private q = newRoadQuery();
  private progress = 0;
  /** Signed distance from the centreline at the last drive() (+ = left). */
  lateral = 0;

  constructor(private road: Road) {}

  reset(progress = 0): void {
    this.progress = progress;
  }

  /** Cornering-speed scale (0.45..1, up to 1.5 with `useExtraGrip`) for the tyre on the road surface `d` m ahead. */
  private gripAhead(v: Vehicle, d: number): number {
    const id = roadSurfaceAt(this.road.def, this.progress + d).surface;
    const mu = v.surfaceFor(id).mu;
    return Math.min(this.useExtraGrip ? 1.5 : 1, Math.max(0.45, mu / REF_MU));
  }

  drive(v: Vehicle, out: VehicleControls): VehicleControls {
    const p = v.position;
    const q = this.road.query(p.x, p.z, this.q);
    if (q.found && Math.abs(q.along - this.progress) < 40)
      this.progress = q.along;
    const speed = v.speed;
    const def = v.def;
    const maxSteer = (def.maxSteerDeg * Math.PI) / 180;

    // Body sideslip beta: velocity direction relative to the nose (+ = towards the left).
    const vLong = v.velocity.dot(v.forward);
    const vLat = v.velocity.dot(v.right); // +X is left
    const moving = Math.hypot(vLong, vLat) > 2;
    const beta = moving ? Math.atan2(vLat, Math.max(0.5, vLong)) : 0;

    // Pure pursuit relative to the direction of travel.
    const look = 8 + Math.max(0, speed) * 0.5;
    const t = this.road.at(this.progress + look);
    const travel = moving
      ? Math.atan2(v.velocity.x, v.velocity.z)
      : Math.atan2(v.forward.x, v.forward.z);
    let alpha = Math.atan2(t.x - p.x, t.z - p.z) - travel;
    alpha = Math.atan2(Math.sin(alpha), Math.cos(alpha));
    // Wheel angle (+ = left): proportional on the pursuit angle (the tyres need
    // slip angle, not just the kinematic angle, to bend the path) + partial
    // sideslip compensation (= counter-steer when the rear steps out).
    const delta = alpha * 1.6 + beta * 1.0;
    // Steer input + = right.
    out.steer = Math.max(-1, Math.min(1, -delta / maxSteer));

    // Speed plan: for each point ahead, the speed we could still brake down
    // to its cornering limit (v^2 = v_corner^2 + 2 a d); take the minimum.
    const grip = 0.7 * 9.81 * (0.55 + this.aggression * 0.45);
    const decel = 4.2 * this.gripAhead(v, 0); // conservative: gravel + downhill
    let target = this.maxSpeed;
    const horizon = 30 + Math.max(0, speed) * 3;
    // Over a crest that launches the car (v^2 * vertical curvature > g) there is
    // no braking in the air: corners after it get that much less braking distance.
    let flight = 0;
    for (let d = 0; d < horizon; d += 4) {
      const s = this.road.at(this.progress + d);
      if (!flight && d > 0) {
        const y0 = this.road.at(this.progress + d - 4).y;
        const y2 = this.road.at(this.progress + d + 4).y;
        const kv = (y2 - 2 * s.y + y0) / 16;
        if (-kv * speed * speed > 9.81 * 0.8) flight = speed * 0.55;
      }
      // Low grip (a wrong tyre) also caps speed on straights - there is no braking left for the
      // next surprise - by pretending the road bends a little. Zero effect at gravel-grade grip.
      const g = this.gripAhead(v, d);
      const k = Math.max(
        Math.abs(s.curvature),
        1e-3 + Math.max(0, 1 - g) * 0.01,
      );
      const vc = Math.sqrt((grip * g) / k);
      const braking = Math.max(0, d - flight);
      target = Math.min(target, Math.sqrt(vc * vc + 2 * decel * braking));
    }
    const lateral = q.found ? q.lateral : 0;
    this.lateral = lateral;
    target *= 1 - Math.min(0.5, Math.max(0, Math.abs(lateral) - 1.5) * 0.12);
    const e = target - speed;
    // Lift off while sliding (|beta| > 3 deg) so the tyres can recover.
    const slideCut = Math.max(0, 1 - Math.max(0, Math.abs(beta) - 0.05) / 0.12);
    out.throttle = e > 0 ? Math.min(1, e * 0.4 + 0.3) * slideCut : 0;
    out.brake = e < -1.5 ? Math.min(1, -e * 0.15) : 0;
    out.handbrake = 0;
    return out;
  }

  get along(): number {
    return this.progress;
  }
}

/**
 * Controls for the automatic stop after the finish line: keep following the
 * road, no throttle, progressive braking (firm at speed, gentle near 0 so the
 * wheels don't lock and spin the car) with ABS. Vehicle auto-hold takes over at rest.
 */
export function finishStopControls(
  pilot: Autopilot,
  v: Vehicle,
  out: VehicleControls,
): VehicleControls {
  const prevBrake = out.brake;
  pilot.drive(v, out);
  const sp = Math.abs(v.speed);
  // Pull back towards the centreline while slowing down (+lateral = left -> steer right).
  out.steer = Math.max(-1, Math.min(1, out.steer + pilot.lateral * 0.06));
  out.throttle = 0;
  out.handbrake = 0;
  // Below 0.3 m/s release so Vehicle auto-hold (engages < 0.5 m/s, no pedals) parks it.
  // (A floor of 0.45: a weak-braked car creeping on a slight downhill must still stop.)
  let brake = sp > 0.3 ? Math.min(0.7, 0.45 + sp / 40) : 0;
  // ABS (called once per physics step): locked wheels can't steer - from 150 km/h on gravel 0.7 locked all four and
  // slid the car off a bend. Eased, not switched every step (that bounced the car on its springs).
  if (sp > 3) {
    const locking = v.wheels.some((w) => w.contact && w.slipRatio < -0.2);
    brake = locking
      ? prevBrake - 3 / PHYSICS_HZ
      : Math.min(brake, prevBrake + 1.5 / PHYSICS_HZ);
  }
  out.brake = Math.max(0, brake);
  return out;
}
