import { SURFACES, type SurfaceDef, type SurfaceId } from './surfaces';

/**
 * Tyre compounds. A tyre does not change the tyre model (`tire.ts`): it re-tunes every surface
 * for the wheels that run on it. `TYRE_SURFACES[tyre][surface]` is the effective `SurfaceDef`
 * (same id / dust / bump / loose, different mu / slide / peak slip / peak angle), precomputed
 * once so the physics step allocates nothing. Design + numbers: ../PHYSICS.md.
 *
 * Arcade rules: big readable differences, no wear / temperature. The right tyre is a modest
 * bonus over `mixed`, the wrong one is a clear penalty that a careful driver can still finish on.
 */
export type TyreId = 'tarmac' | 'mixed' | 'gravel';

export interface TyreDef {
  id: TyreId;
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
}

export const TYRES: Record<TyreId, TyreDef> = {
  tarmac: {
    id: 'tarmac',
    name: 'Tarmac',
    blurb: 'Sharp and sticky on clean asphalt. Skates on anything loose.',
    color: 0xe0413a,
    grip: {
      tarmac: 1.12,
      tarmac_gravel: 0.95,
      rock: 1,
      gravel: 0.72,
      gravel_loose: 0.65,
      dirt: 0.68,
      grass: 0.62,
      mud: 0.55,
      snow: 0.6,
    },
    slide: [0.95, 0.9],
    response: 0.8,
  },
  mixed: {
    id: 'mixed',
    name: 'Mixed',
    blurb: 'The all-rounder. Best on dusty asphalt, never bad anywhere.',
    color: 0xf2c230,
    grip: {
      tarmac: 0.98,
      tarmac_gravel: 1.06,
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
  },
  gravel: {
    id: 'gravel',
    name: 'Gravel',
    blurb: 'Deep tread. Bites into loose ground, floaty and lazy on asphalt.',
    color: 0xf2f2f2,
    grip: {
      tarmac: 0.84,
      tarmac_gravel: 0.94,
      rock: 0.95,
      gravel: 1.05,
      gravel_loose: 1.06,
      dirt: 1.05,
      grass: 1.04,
      mud: 1,
      snow: 0.95,
    },
    slide: [1.08, 1.03],
    response: 1.25,
  },
};

/** Menu order. */
export const TYRE_IDS: readonly TyreId[] = ['tarmac', 'mixed', 'gravel'];

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
export const TYRE_SURFACES: Record<TyreId, Record<SurfaceId, SurfaceDef>> = {
  tarmac: build(TYRES.tarmac),
  mixed: build(TYRES.mixed),
  gravel: build(TYRES.gravel),
};

/** How a tyre does on a surface compared with the best tyre there: 3 best, 2 good, 1 poor, 0 bad. */
export type GripRating = 0 | 1 | 2 | 3;

export function gripRating(tyre: TyreId, surface: SurfaceId): GripRating {
  const best = Math.max(...TYRE_IDS.map((t) => TYRE_SURFACES[t][surface].mu));
  const r = TYRE_SURFACES[tyre][surface].mu / best;
  return r >= 0.97 ? 3 : r >= 0.82 ? 2 : r >= 0.65 ? 1 : 0;
}

export const GRIP_LABELS: readonly string[] = ['Bad', 'Poor', 'Good', 'Best'];
