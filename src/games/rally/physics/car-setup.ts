import type { TyreId } from './tyres';
import type {
  AxleDef,
  CarPhysicsDef,
  SetupAxle,
  SetupId,
  SetupPreset,
} from './types';

/**
 * Suspension set-ups. A car carries three presets (`CarPhysicsDef.setups`) - always Soft / Medium / Stiff, shown as
 * yellow / orange / red springs - but every car defines its own values: that is where the limits live (a rally car
 * spans the whole range, a road car only the soft half, a race car only the stiff half).
 *
 * `applySetup` swaps a preset's numbers into the axles; `compliance` turns the springs + travel into one 0..1 number
 * (0 stiff tarmac set-up, 1 soft gravel set-up) that physics/car-tyres.ts uses to decide how the set-up grips on
 * smooth and rough surfaces. Design + numbers: ../PHYSICS.md.
 */
export const SETUP_IDS: readonly SetupId[] = ['soft', 'medium', 'stiff'];

/** Spring colour per preset (menu / parts bench): soft -> stiff = yellow, orange, red. */
export const SETUP_COLORS: Record<SetupId, number> = {
  soft: 0xf2c230,
  medium: 0xf08a24,
  stiff: 0xe0413a,
};

export const SETUP_NAMES: Record<SetupId, string> = {
  soft: 'Soft',
  medium: 'Medium',
  stiff: 'Stiff',
};

/** Recommended set-up for a tyre (and so for a stage: its recommended tyre): gravel soft ... tarmac stiff. */
export const SETUP_FOR_TYRE: Record<TyreId, SetupId> = {
  gravel: 'soft',
  gravel_hard: 'soft',
  mixed: 'medium',
  tarmac_hard: 'stiff',
  tarmac: 'stiff',
};

export interface SetupPoint {
  front: number;
  rear: number;
  /** Total travel (m). */
  travel: number;
  /** Ride height vs the car's standard one (m, + = higher); default 0. */
  ride?: number;
}

/**
 * Presets from spring rates + travel. Dampers scale with sqrt(spring) from the base axles (so the damping ratio
 * stays put) and the anti-roll bars with the spring rate. `baseId`'s point must use the base axles' own spring
 * rates, which makes that preset equal to the car's base numbers.
 */
export function deriveSetups(
  base: { front: AxleDef; rear: AxleDef },
  points: Record<SetupId, SetupPoint>,
): Record<SetupId, SetupPreset> {
  const axle = (b: AxleDef, spring: number): SetupAxle => ({
    spring,
    bump: Math.round(b.bump * Math.sqrt(spring / b.spring)),
    rebound: Math.round(b.rebound * Math.sqrt(spring / b.spring)),
    antiRoll: Math.round((b.antiRoll * spring) / b.spring),
  });
  const out = {} as Record<SetupId, SetupPreset>;
  for (const id of SETUP_IDS) {
    const p = points[id];
    out[id] = {
      front: axle(base.front, p.front),
      rear: axle(base.rear, p.rear),
      travel: p.travel,
      ride: p.ride ?? 0,
    };
  }
  return out;
}

/**
 * The car with a preset's springs / dampers / anti-roll bars / travel and ride height (`rideHeight`; the Vehicle keeps
 * that height whatever the springs - the wheel mounts follow).
 */
export function applySetup(def: CarPhysicsDef, id: SetupId): CarPhysicsDef {
  const p = def.setups[id];
  return {
    ...def,
    setup: id,
    rideHeight: p.ride,
    front: { ...def.front, ...p.front, travel: p.travel },
    rear: { ...def.rear, ...p.rear, travel: p.travel },
  };
}

/** Centre of mass height above flat ground at rest with the current set-up (m): standard + the preset's offset. */
export function staticComHeight(def: CarPhysicsDef): number {
  return def.comHeight + (def.rideHeight ?? 0);
}

/** Static mass on one wheel of the axle (kg). */
export function cornerMass(def: CarPhysicsDef, front: boolean): number {
  const wheelbase = def.front.z - def.rear.z;
  const otherZ = front ? def.rear.z : def.front.z;
  return (def.mass * Math.abs(otherZ)) / wheelbase / 2;
}

/** Suspension ride frequency of an axle (Hz). */
export function rideFrequency(def: CarPhysicsDef, front: boolean): number {
  const a = front ? def.front : def.rear;
  return Math.sqrt(a.spring / cornerMass(def, front)) / (2 * Math.PI);
}

/** 0 = stiff tarmac set-up (high ride frequency, short travel) ... 1 = soft gravel set-up. */
export function compliance(def: CarPhysicsDef): number {
  const f = (rideFrequency(def, true) + rideFrequency(def, false)) / 2;
  const travel = (def.front.travel + def.rear.travel) / 2;
  const c = 0.5 * (2.6 - f) + (0.5 * (travel - 0.14)) / 0.12;
  return Math.min(1, Math.max(0, c));
}

/** Damping ratio of an axle in compression / extension (0.25-0.8 is the sane band). */
export function dampingRatio(
  def: CarPhysicsDef,
  front: boolean,
): { bump: number; rebound: number } {
  const a = front ? def.front : def.rear;
  const crit = 2 * Math.sqrt(a.spring * cornerMass(def, front));
  return { bump: a.bump / crit, rebound: a.rebound / crit };
}

/** Menu wording for a compliance value. */
export function setupCharacter(c: number): string {
  return c > 0.66 ? 'Soft · gravel' : c < 0.33 ? 'Stiff · tarmac' : 'Medium';
}
