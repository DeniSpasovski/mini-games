import { Rng } from '../../../shared/rng';

/**
 * Scripted fall of one item into the hole: idle -> tipping -> falling -> gone.
 * Deterministic (seeded per item) and independent of any renderer.
 */
export const FallState = {
  Idle: 0,
  Tipping: 1,
  Falling: 2,
  Gone: 3,
} as const;

export interface FallParams {
  /** Seconds the item tips over the rim. */
  tipTime: number;
  /** Seconds the item sinks into the hole. */
  fallTime: number;
  /** Max lean (radians) while tipping. */
  maxTilt: number;
  /** Total drop (m) after which the item is gone. */
  drop: number;
  /** Yaw spin (rad/s) while falling. */
  spin: number;
  /** Seeded variation 0..1. */
  jitter: number;
}

/** Fall tuning derived from the item and hole size (big items sink, small ones tip and tumble). */
export function fallParams(
  size: number,
  height: number,
  holeDiameter: number,
  seed: number,
): FallParams {
  const rng = new Rng(seed);
  const rel = Math.min(1, size / holeDiameter); // 0 = tiny vs hole, 1 = fills the hole
  return {
    tipTime: 0.16 + 0.2 * rel,
    fallTime: Math.min(3, 0.55 + 0.22 * Math.sqrt(Math.max(1, height))),
    // tall items must not swing their top far sideways: cap the lean so the top moves < 0.4 hole diameters
    maxTilt: Math.min(
      ((40 - 30 * rel) * Math.PI) / 180,
      Math.atan2(0.4 * holeDiameter, Math.max(height, 0.01)),
    ),
    drop: height + 1,
    spin: (rng.next() - 0.5) * 6 * (1 - rel),
    jitter: rng.next(),
  };
}

export interface FallPose {
  /** Offset towards the hole centre (0..1 of the horizontal distance). */
  slide: number;
  /** Tilt around the axis perpendicular to the hole direction (rad). */
  tilt: number;
  /** Vertical offset (<= 0). */
  y: number;
  /** Extra yaw (rad). */
  yaw: number;
  done: boolean;
}

/** Pose at time `t` seconds after the item committed. */
export function fallPose(p: FallParams, t: number): FallPose {
  if (t < p.tipTime) {
    const k = t / p.tipTime;
    const e = k * k * (3 - 2 * k);
    return { slide: 0.5 * e, tilt: p.maxTilt * e, y: 0, yaw: 0, done: false };
  }
  const f = Math.min(1, (t - p.tipTime) / p.fallTime);
  const ease = f * f;
  return {
    slide: 0.5 + 0.5 * Math.min(1, f * 3),
    tilt: p.maxTilt * (1 + 0.6 * f),
    y: -p.drop * ease,
    yaw: p.spin * (t - p.tipTime),
    done: f >= 1,
  };
}

export function fallDuration(p: FallParams): number {
  return p.tipTime + p.fallTime;
}
