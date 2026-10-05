import type { SurfaceDef } from './surfaces';

/**
 * Combined-slip tyre model.
 *
 * Longitudinal slip ratio and lateral slip angle are each normalised by the
 * surface's peak value, combined into one slip magnitude `s`, and run through
 * a Pacejka-like curve that is 1.0 at s = 1 (peak grip) and decays to
 * `surface.slide` when fully sliding. The resulting force is split back along
 * the normalised slip vector, which gives a friction-ellipse for free: a
 * locked / spinning wheel loses side grip (handbrake turns, power slides).
 */

export interface TireShape {
  B: number;
  C: number;
}

const shapeCache = new Map<number, TireShape>();

/** Curve constants for a given sliding/peak ratio (cached). */
export function tireShape(slide: number): TireShape {
  let s = shapeCache.get(slide);
  if (!s) {
    const a = Math.min(0.98, Math.max(0.3, slide));
    // sin(C * pi/2) = a for s -> inf ; peak at s = 1 => C * atan(B) = pi/2
    const C = 2 - (2 * Math.asin(a)) / Math.PI;
    const B = Math.tan(Math.PI / (2 * C));
    s = { B, C };
    shapeCache.set(slide, s);
  }
  return s;
}

/** Normalised grip curve: 0 at s=0, 1 at s=1, -> slide for large s. */
export function gripCurve(s: number, shape: TireShape): number {
  return Math.sin(shape.C * Math.atan(shape.B * s));
}

export interface TireInput {
  /** Wheel angular velocity (rad/s). */
  omega: number;
  radius: number;
  /** Contact patch velocity along wheel heading / sideways (+ = left) (m/s). */
  vx: number;
  vy: number;
  /** Normal load (N). */
  load: number;
  /** Load at which grip is nominal (static corner load). */
  nominalLoad: number;
  grip: number;
  surface: SurfaceDef;
}

export interface TireOutput {
  fx: number;
  fy: number;
  slipRatio: number;
  slipAngle: number;
  /** Combined normalised slip; >1 means past the peak (sliding). */
  slip: number;
}

/** Below these speeds slip uses a fixed denominator, keeping low speed stable. */
export const LOW_SPEED_LONG = 2.5;
export const LOW_SPEED_LAT = 3.0;
/** Grip loss per unit of load above nominal (real tyres lose μ with load). */
const LOAD_SENSITIVITY = 0.08;
const DEG = Math.PI / 180;

export function computeTire(i: TireInput, out: TireOutput): TireOutput {
  const sr =
    (i.omega * i.radius - i.vx) / Math.max(Math.abs(i.vx), LOW_SPEED_LONG);
  const sa = Math.atan2(i.vy, Math.max(Math.abs(i.vx), LOW_SPEED_LAT));
  out.slipRatio = sr;
  out.slipAngle = sa;
  if (i.load <= 0) {
    out.fx = 0;
    out.fy = 0;
    out.slip = 0;
    return out;
  }
  const surf = i.surface;
  const sx = sr / surf.peakSlip;
  const sy = sa / (surf.peakAngle * DEG);
  const s = Math.hypot(sx, sy);
  out.slip = s;
  if (s < 1e-6) {
    out.fx = 0;
    out.fy = 0;
    return out;
  }
  const loadRatio = i.load / i.nominalLoad;
  const mu =
    surf.mu *
    i.grip *
    Math.min(1.15, Math.max(0.6, 1 - LOAD_SENSITIVITY * (loadRatio - 1)));
  const f = mu * i.load * gripCurve(s, tireShape(surf.slide));
  out.fx = (f * sx) / s;
  out.fy = (-f * sy) / s;
  return out;
}
