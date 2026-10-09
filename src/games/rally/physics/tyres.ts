import { SURFACES, type SurfaceDef, type SurfaceId } from './surfaces';
import type { PressureDef, TempWindow } from './tyre-temp';

/**
 * Tyre compounds. A tyre does not change the tyre model (`tire.ts`): it re-tunes every surface
 * for the wheels that run on it. `TYRE_SURFACES[tyre][surface]` is the effective `SurfaceDef`
 * (same id / dust / bump / loose, different mu / slide / peak slip / peak angle), precomputed
 * once so the physics step allocates nothing. Design + numbers: ../PHYSICS.md.
 *
 * Arcade rules: big readable differences, no wear. Temperature: `temp` window (tyre-temp.ts). The right tyre is a modest
 * bonus over `mixed`, the wrong one is a clear penalty that a careful driver can still finish on.
 */
export type TyreId =
  'tarmac' | 'tarmac_hard' | 'mixed' | 'gravel_hard' | 'gravel';
/**
 * The tyre's kind: sizes (`CarPhysicsDef.tyres.byCompound`), brake kit, wheel models and the tread look follow it, not the
 * compound. The ids `tarmac` and `gravel` are the soft compounds (the names the saved set-ups already use).
 */
export type TyreFamily = 'tarmac' | 'mixed' | 'gravel';

export interface TyreDef {
  id: TyreId;
  family: TyreFamily;
  name: string;
  /** One-line description for the menu. */
  blurb: string;
  /** Menu / HUD stripe colour (sRGB hex). */
  color: number;
  /** mu multiplier per surface - the main "feel the difference" knob. */
  grip: Record<SurfaceId, number>;
  /**
   * Multiplier on the surface's `slide` (grip left when fully sliding) on hard ground and on
   * loose ground (blended by `surface.loose`). < 1 = lets go suddenly, > 1 = progressive.
   */
  slide: readonly [hard: number, loose: number];
  /** Multiplier on peakSlip / peakAngle: < 1 = sharp and direct, > 1 = lazy, squirmy, drifty. */
  response: number;
  /** Temperature window (°C) and the grip left when cold / overheated (physics/tyre-temp.ts). */
  temp: TempWindow;
  /** Heat-up scale (1 = tarmac rubber): harder compounds warm slower (`SLIDE_HEAT` / `ROLL_HEAT` x this). */
  heat: number;
  /**
   * Grip loss per unit of load above the static corner load on hard ground (softer rubber loses more); loose ground
   * keeps 60 % of it (`LOOSE_LOAD_SENS`).
   */
  loadSens: number;
  /** Cold set pressure (bar) - the hot target follows from the window (`targetPressure`). */
  pressure: PressureDef;
}

/** Share of `loadSens` left on fully loose ground. */
export const LOOSE_LOAD_SENS = 0.6;

export const TYRES: Record<TyreId, TyreDef> = {
  tarmac: {
    id: 'tarmac',
    family: 'tarmac',
    name: 'Tarmac Soft',
    blurb:
      'Sharp and sticky on clean asphalt, warms fast. Skates on anything loose.',
    color: 0xe0413a,
    grip: {
      tarmac: 1.26,
      tarmac_gravel: 1.07,
      rock: 1,
      gravel: 0.72,
      gravel_loose: 0.64,
      dirt: 0.68,
      grass: 0.62,
      mud: 0.55,
      snow: 0.6,
    },
    slide: [0.95, 0.9],
    response: 0.8,
    temp: { lo: 66, hi: 104, cold: 0.72, hot: 0.78 },
    heat: 1,
    loadSens: 0.14,
    pressure: { cold: 1.85 },
  },
  tarmac_hard: {
    id: 'tarmac_hard',
    family: 'tarmac',
    name: 'Tarmac Hard',
    blurb: 'Less peak grip, but keeps it on a hot day. Slow to warm up.',
    color: 0xf08a24,
    grip: {
      tarmac: 1.19,
      tarmac_gravel: 1.05,
      rock: 1,
      gravel: 0.72,
      gravel_loose: 0.64,
      dirt: 0.68,
      grass: 0.62,
      mud: 0.55,
      snow: 0.6,
    },
    slide: [1, 0.92],
    response: 0.85,
    temp: { lo: 78, hi: 120, cold: 0.7, hot: 0.86 },
    heat: 0.9,
    loadSens: 0.12,
    pressure: { cold: 1.85 },
  },
  mixed: {
    id: 'mixed',
    family: 'mixed',
    name: 'Mixed',
    blurb: 'The all-rounder. Best on dusty asphalt, never bad anywhere.',
    color: 0xf2c230,
    grip: {
      tarmac: 1.1,
      tarmac_gravel: 1.19,
      rock: 1,
      gravel: 0.93,
      gravel_loose: 0.9,
      dirt: 0.92,
      grass: 0.9,
      mud: 0.85,
      snow: 0.85,
    },
    slide: [1, 1],
    response: 1,
    temp: { lo: 60, hi: 100, cold: 0.8, hot: 0.84 },
    heat: 1,
    loadSens: 0.12,
    pressure: { cold: 1.8 },
  },
  gravel_hard: {
    id: 'gravel_hard',
    family: 'gravel',
    name: 'Gravel Hard',
    blurb:
      'Tough tread for hard-packed, abrasive gravel. Less bite in mud and loose stuff.',
    color: 0x5ab0e0,
    grip: {
      tarmac: 0.96,
      tarmac_gravel: 1.03,
      rock: 0.96,
      gravel: 1.03,
      gravel_loose: 1,
      dirt: 1.02,
      grass: 1,
      mud: 0.9,
      snow: 0.92,
    },
    slide: [1.06, 1],
    response: 1.15,
    temp: { lo: 58, hi: 98, cold: 0.86, hot: 0.88 },
    heat: 0.75,
    loadSens: 0.09,
    pressure: { cold: 1.8 },
  },
  gravel: {
    id: 'gravel',
    family: 'gravel',
    name: 'Gravel Soft',
    blurb:
      'Deep tread. Bites into loose ground and mud, floaty and lazy on asphalt.',
    color: 0xf2f2f2,
    grip: {
      tarmac: 0.92,
      tarmac_gravel: 1.03,
      rock: 0.94,
      gravel: 1.04,
      gravel_loose: 1.08,
      dirt: 1.06,
      grass: 1.06,
      mud: 1.04,
      snow: 0.98,
    },
    slide: [1.08, 1.03],
    response: 1.25,
    temp: { lo: 46, hi: 86, cold: 0.9, hot: 0.83 },
    heat: 0.85,
    loadSens: 0.1,
    pressure: { cold: 1.75 },
  },
};

/** Menu order. */
export const TYRE_IDS: readonly TyreId[] = [
  'tarmac',
  'tarmac_hard',
  'mixed',
  'gravel_hard',
  'gravel',
];

/** The tyre's kind (sizes, brake kit, wheels, tread follow it). */
export const familyOf = (tyre: TyreId): TyreFamily => TYRES[tyre].family;

export function isTyreId(v: unknown): v is TyreId {
  return typeof v === 'string' && v in TYRES;
}

/** `v` when it is a known tyre, else `fallback` (URL / storage values are untrusted). */
export function parseTyre<F extends TyreId | null>(
  v: unknown,
  fallback: F,
): TyreId | F {
  return isTyreId(v) ? v : fallback;
}

function effective(t: TyreDef, s: SurfaceDef): SurfaceDef {
  const slideMul = t.slide[0] + (t.slide[1] - t.slide[0]) * s.loose;
  return {
    ...s,
    mu: s.mu * t.grip[s.id],
    slide: Math.min(0.95, s.slide * slideMul),
    peakSlip: s.peakSlip * t.response,
    peakAngle: s.peakAngle * t.response,
  };
}

const build = (t: TyreDef) =>
  Object.fromEntries(
    (Object.values(SURFACES) as SurfaceDef[]).map((s) => [
      s.id,
      effective(t, s),
    ]),
  ) as Record<SurfaceId, SurfaceDef>;

/** Effective surface per tyre: `TYRE_SURFACES[tyre][surfaceId]`. */
export const TYRE_SURFACES = Object.fromEntries(
  TYRE_IDS.map((id) => [id, build(TYRES[id])]),
) as Record<TyreId, Record<SurfaceId, SurfaceDef>>;

/** How a tyre does on a surface compared with the best tyre there: 3 best, 2 good, 1 poor, 0 bad. */
export type GripRating = 0 | 1 | 2 | 3;

export function gripRating(tyre: TyreId, surface: SurfaceId): GripRating {
  const best = Math.max(...TYRE_IDS.map((t) => TYRE_SURFACES[t][surface].mu));
  const r = TYRE_SURFACES[tyre][surface].mu / best;
  return r >= 0.97 ? 3 : r >= 0.82 ? 2 : r >= 0.65 ? 1 : 0;
}

export const GRIP_LABELS: readonly string[] = ['Bad', 'Poor', 'Good', 'Best'];
