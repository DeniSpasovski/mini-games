import { compliance } from './car-setup';
import { SURFACES, type SurfaceDef, type SurfaceId } from './surfaces';
import { TYRE_IDS, TYRE_SURFACES, type GripRating, type TyreId } from './tyres';
import type { CarPhysicsDef, TyreSize } from './types';

/**
 * Per-car effective surfaces: the compound table (tyres.ts) re-tuned for the car's tyre SIZE and its suspension
 * SET-UP. One table per (tyre size, compound, compliance), cached, so the physics step allocates nothing.
 *
 *   effective surface = surface x compound x size x set-up match      (then x axle.grip in tire.ts)
 *
 * Size (reference 205/65 R15 = 1): width is grip on hard ground and flotation / plough on loose ground, sidewall
 * height (aspect x width) is how soft and lazy (tall) or sharp and snappy (low) the tyre feels.
 * Set-up: a soft set-up gains on rough ground and loses on smooth, a stiff one the other way (`SurfaceDef.rough`).
 * Design + numbers: ../PHYSICS.md.
 */
const REF_WIDTH = 0.205;
const REF_SIDEWALL = 0.133; // 205/65

/** Overall tyre radius (m) of a size. */
export function tyreRadius(s: TyreSize): number {
  return (s.rim * 0.0254) / 2 + (s.width * s.aspect) / 100;
}

/** Sidewall marking, e.g. "205/65 R15". */
export function tyreLabel(s: TyreSize): string {
  return `${Math.round(s.width * 1000)}/${s.aspect} R${s.rim}`;
}

export type Axle = 'front' | 'rear';

/** The size a car runs on an axle with a compound (null = the default size). */
export function tyreSizeFor(
  def: CarPhysicsDef,
  tyre: TyreId | null,
  axle: Axle = 'front',
): TyreSize {
  const set = (axle === 'rear' && def.tyres.rear) || def.tyres;
  return (tyre && set.byCompound?.[tyre]) || set.size;
}

/** Whether the rear axle runs another size than the front on a compound. */
export function isStaggered(def: CarPhysicsDef, tyre: TyreId | null): boolean {
  const f = tyreSizeFor(def, tyre, 'front');
  const r = tyreSizeFor(def, tyre, 'rear');
  return f.width !== r.width || f.aspect !== r.aspect || f.rim !== r.rim;
}

/**
 * Rolling radius of an axle's wheels on a compound (null = the default size): the car's `wheelRadius` for its default
 * front size, any other size scaled by its marking (`tyreRadius`) - a taller tyre is a taller wheel, and a car's own
 * radius (and with it its default handling) stays as measured.
 */
export function axleRadius(
  def: CarPhysicsDef,
  tyre: TyreId | null,
  axle: Axle,
): number {
  const size = tyreSizeFor(def, tyre, axle);
  return size === def.tyres.size
    ? def.wheelRadius
    : (def.wheelRadius * tyreRadius(size)) / tyreRadius(def.tyres.size);
}

/** Radius the gearbox sees: the driven axle's (torque-split average for 4WD - its axles run one radius). */
export function drivenRadius(def: CarPhysicsDef, tyre: TyreId | null): number {
  const s = def.drivetrain.frontSplit;
  return (
    s * axleRadius(def, tyre, 'front') + (1 - s) * axleRadius(def, tyre, 'rear')
  );
}

/** Label for both axles: "245/40 R18" or "245/40 R18 · rear 265/40 R18" when staggered. */
export function carTyreLabel(def: CarPhysicsDef, tyre: TyreId | null): string {
  const f = tyreLabel(tyreSizeFor(def, tyre, 'front'));
  return isStaggered(def, tyre)
    ? `${f} · rear ${tyreLabel(tyreSizeFor(def, tyre, 'rear'))}`
    : f;
}

export interface SizeFactors {
  /** mu multiplier on hard ground (surface.loose = 0). */
  hard: number;
  /** mu multiplier on loose ground (surface.loose = 1). */
  loose: number;
  /** peakSlip / peakAngle multiplier (< 1 sharp, > 1 lazy). */
  response: number;
  slide: number;
  /** Extra rolling resistance on loose ground (wide tyres plough). */
  plough: number;
}

export function sizeFactors(s: TyreSize): SizeFactors {
  const w = s.width / REF_WIDTH;
  const h = (s.width * (s.aspect / 100)) / REF_SIDEWALL;
  return {
    hard: w ** 0.3,
    loose: w < 1 ? w ** 0.12 : 1 - 0.22 * (w - 1),
    response: h ** 0.3,
    slide: h ** 0.1,
    plough: 1 + 0.3 * Math.max(0, w - 1),
  };
}

const cache = new Map<string, Record<SurfaceId, SurfaceDef>>();

/**
 * Effective surfaces for one axle of a car (as currently set up) on a tyre compound: `table[surfaceId]`. Axles on the
 * same size share one cached table.
 */
export function carSurfaces(
  def: CarPhysicsDef,
  tyre: TyreId,
  axle: Axle = 'front',
): Record<SurfaceId, SurfaceDef> {
  const size = tyreSizeFor(def, tyre, axle);
  const c = compliance(def);
  const key = `${tyre}|${size.width}|${size.aspect}|${c.toFixed(3)}`;
  let table = cache.get(key);
  if (!table) {
    const f = sizeFactors(size);
    const match = (c - 0.5) * 2; // -1 stiff ... +1 soft
    table = {} as Record<SurfaceId, SurfaceDef>;
    for (const base of Object.values(TYRE_SURFACES[tyre])) {
      const loose = base.loose;
      const rough = SURFACES[base.id].rough;
      const sizeMu = f.hard + (f.loose - f.hard) * loose;
      // Rough 0.12 (was 0.08: on gravel a soft vs stiff set-up was worth only +-2.4 % against +-6 % on tarmac, so stiff
      // was the safe pick everywhere). 0.15 tipped two knife edges: the Bimmer's loose-gravel launch and the limit
      // driver over the test map's crest at ~870 m.
      const setupMu = 1 + 0.12 * match * rough - 0.06 * match * (1 - rough);
      const setupResponse = 1 + 0.08 * match * (1 - rough);
      table[base.id] = {
        ...base,
        mu: base.mu * sizeMu * setupMu,
        slide: Math.min(0.95, base.slide * f.slide),
        peakSlip: base.peakSlip * f.response * setupResponse,
        peakAngle: base.peakAngle * f.response * setupResponse,
        rolling: base.rolling * (1 + (f.plough - 1) * loose),
      };
    }
    cache.set(key, table);
  }
  return table;
}

/**
 * How the tyre does on a surface for this car (as set up), compared with the best compound there:
 * 3 best, 2 good, 1 poor, 0 bad.
 */
export function carGripRating(
  def: CarPhysicsDef,
  tyre: TyreId,
  surface: SurfaceId,
): GripRating {
  const mu = (t: TyreId) =>
    (carSurfaces(def, t, 'front')[surface].mu +
      carSurfaces(def, t, 'rear')[surface].mu) /
    2;
  const best = Math.max(...TYRE_IDS.map(mu));
  const r = mu(tyre) / best;
  return r >= 0.97 ? 3 : r >= 0.82 ? 2 : r >= 0.65 ? 1 : 0;
}
