import type { Vector3 } from 'three';
import type { SurfaceDef } from './surfaces';
import type { TyreId } from './tyres';

/**
 * Physics conventions (body frame, origin = centre of mass):
 *   +Z forward, +Y up, +X LEFT  (right-handed, same as three.js)
 *   steer input: -1 = full left, +1 = full right
 *   wheel steer angle: positive = rotated towards +X (left)
 *   wheel omega: positive = rolling forward
 * Units: metres, kilograms, seconds, newtons, radians (unless suffixed *Deg / *Rpm).
 */

export interface GroundSample {
  height: number;
  normal: Vector3;
  surface: SurfaceDef;
}

/** Static obstacle the car body can hit (trees, posts, rocks). */
export interface StaticCollider {
  kind: 'cylinder' | 'sphere' | 'box';
  x: number;
  /** cylinder / box: base Y, sphere: centre Y */
  y: number;
  z: number;
  /** Radius (box: bounding radius in XZ, used for culling). */
  r: number;
  /** cylinder / box height (ignored for spheres) */
  h: number;
  /** box: half extents along its local X / Z and yaw (rad, three.js rotation about +Y). */
  hx?: number;
  hz?: number;
  rot?: number;
}

/** What the vehicle needs from the world. Implemented by world/world.ts (and a flat test ground). */
export interface GroundProvider {
  /**
   * Ground under (x, z). `fromY` = height the probe starts from (a wheel mount, a hull point): where the world
   * has more than one level (a street under an overpass) the surface below the probe is returned.
   */
  sampleGround(
    x: number,
    z: number,
    out: GroundSample,
    fromY?: number,
  ): GroundSample;
  /** Fills `out` with colliders near (x,z); returns the count. */
  queryColliders?(
    x: number,
    z: number,
    radius: number,
    out: StaticCollider[],
  ): number;
  /** Water surface height at (x, z) (canals / rivers), NaN where there is no water. */
  waterLevel?(x: number, z: number): number;
}

export interface VehicleControls {
  /** 0..1 */
  throttle: number;
  /** 0..1 (also reverse when stopped) */
  brake: number;
  /** -1 (left) .. +1 (right) */
  steer: number;
  /** 0..1 */
  handbrake: number;
}

export interface AxleDef {
  /** Z of the axle relative to the centre of mass (m, + = front). */
  z: number;
  /** Track width, wheel centre to wheel centre (m). */
  track: number;
  /** Spring rate per wheel (N/m). */
  spring: number;
  /** Damper rate in compression (N·s/m). */
  bump: number;
  /** Damper rate in extension (N·s/m). */
  rebound: number;
  /** Total suspension travel (m). */
  travel: number;
  /** Anti-roll bar rate (N/m of compression difference). */
  antiRoll: number;
  /** Max service-brake torque per wheel (Nm). */
  brakeTorque: number;
  /** Handbrake torque per wheel (Nm), usually only on the rear axle. */
  handbrakeTorque: number;
  /** Fraction of steering applied (1 = steered axle, 0 = fixed). */
  steer: number;
  /** Multiplier on surface grip (tyre compound / width). */
  grip: number;
  /**
   * Where tyre forces are applied: 0 = contact patch, 1 = centre of mass height.
   * Raising it reduces body roll and rollover tendency (a classic sim "roll centre" knob).
   */
  forceHeight: number;
}

export interface EngineDef {
  /** [rpm, torque Nm] points, linearly interpolated. */
  torqueCurve: [number, number][];
  idleRpm: number;
  redlineRpm: number;
  /** Rotational inertia of engine + flywheel (kg·m²). */
  inertia: number;
  /** Engine braking torque at redline with closed throttle (Nm). */
  engineBrake: number;
  /** RPM the clutch lets the engine rev to when launching from standstill. */
  launchRpm: number;
}

export interface GearboxDef {
  /** Forward gear ratios, 1st first. */
  ratios: number[];
  reverse: number;
  finalDrive: number;
  /** Seconds with no drive torque during a shift. */
  shiftTime: number;
  efficiency: number;
  /** Auto box: upshift when engine rpm exceeds this. */
  upshiftRpm: number;
  /** Auto box: downshift when engine rpm drops below this. */
  downshiftRpm: number;
}

export interface DrivetrainDef {
  /** Torque fraction to the front axle: 0 = RWD, 1 = FWD, 0.4 = rear-biased AWD. */
  frontSplit: number;
  /** Viscous coupling between axles (Nm per rad/s of speed difference). */
  centerLock: number;
  /** Limited-slip coupling across each axle (Nm per rad/s). */
  frontDiffLock: number;
  rearDiffLock: number;
}

/** Tyre size like a sidewall marking: 205/65 R15 -> { width: 0.205, aspect: 65, rim: 15 }. */
export interface TyreSize {
  /** Section width (m). */
  width: number;
  /** Sidewall height as a percentage of the width. */
  aspect: number;
  /** Rim diameter (inches). */
  rim: number;
}

/** One axle's tyre sizes: `size` = default, `byCompound` = per compound overrides. */
export interface AxleTyres {
  size: TyreSize;
  byCompound?: Partial<Record<TyreId, TyreSize>>;
}

/** Suspension set-up preset names; the menu shows them as spring colours yellow / orange / red. */
export type SetupId = 'soft' | 'medium' | 'stiff';

/** The axle numbers a set-up changes (the rest of `AxleDef` - brakes, steer, grip - stays). */
export interface SetupAxle {
  /** Spring rate per wheel (N/m). */
  spring: number;
  bump: number;
  rebound: number;
  antiRoll: number;
}

export interface SetupPreset {
  front: SetupAxle;
  rear: SetupAxle;
  /** Total suspension travel (m) of both axles (= how far the wheel can drop). */
  travel: number;
  /**
   * Ride height of this preset (m) relative to the car's standard one (`comHeight`): + = the body sits higher (gravel
   * kit: more ground clearance, higher centre of mass, more roll), - = lower (tarmac kit).
   */
  ride: number;
}

/** Final drive preset (setup screen): short = pull, long = top speed. */
export type GearingId = 'short' | 'medium' | 'long';

export interface GearingPreset {
  /** Final drive ratio of this preset (`medium` = the car's own `gearbox.finalDrive`). */
  finalDrive: number;
}

export interface CarPhysicsDef {
  mass: number;
  /** Bounding box used for inertia + default hull (m). */
  length: number;
  width: number;
  height: number;
  /**
   * Centre of mass height above flat ground at the car's standard ride height (m). Also the body's reference: the
   * model and the hull are placed from it. The current preset's offset is `rideHeight`.
   */
  comHeight: number;
  /** Ride height offset of the current set-up (m, set by `applySetup` from the preset's `ride`); missing = 0. */
  rideHeight?: number;
  /** No traction control fitted (a 1970s road car): the assist is always off and its option / key do nothing. */
  noTractionControl?: boolean;
  /** No ABS fitted: the brakes always lock when pushed hard, and its option / key do nothing. */
  noAbs?: boolean;
  /** Only the stiff bump stop past full travel, no progressive one (short-travel cars that rarely bottom out). */
  hardBumpStop?: boolean;
  /** Scales the box inertia (real cars are ~0.8-1.0 of a solid box). */
  inertiaScale: number;
  /**
   * Wheel radius (m) on the default front size (`tyres.size`): the model's hubs, arches, hull and boxy profile. Other
   * sizes roll on this scaled by their marking (`axleRadius`, physics/car-tyres.ts), within 4 % (tests/rally/car-setup.test.ts).
   */
  wheelRadius: number;
  /** Default tyre width (m): water drag + hull. The drawn / graded width is `tyres` (within 5 cm of this). */
  wheelWidth: number;
  /**
   * Tyre sizes per compound (see physics/car-tyres.ts for what width / sidewall do to grip): `size` is the default,
   * `byCompound` overrides it (rally cars change rim size with the compound). A taller size than the default rolls on a
   * bigger radius, lifting its end of the car (the hubs stay put) and lengthening the gearing. `rear` = the rear axle's
   * sizes when they differ (staggered RWD cars; missing = the front's).
   */
  tyres: AxleTyres & { rear?: AxleTyres };
  /** Per-wheel spin inertia (kg·m²), engine inertia is added for driven wheels. */
  wheelInertia: number;
  /** Max steering angle of the front wheels (deg). */
  maxSteerDeg: number;
  /** Axles as currently set up = the `setup` preset (see `applySetup` in physics/car-setup.ts). */
  front: AxleDef;
  rear: AxleDef;
  /** The preset `front` / `rear` hold. */
  setup: SetupId;
  /**
   * Suspension presets with this car's limits (rally car: full soft..stiff range; road / race car: a narrow band).
   * Build with `deriveSetups` from the car's own axle numbers.
   */
  setups: Record<SetupId, SetupPreset>;
  engine: EngineDef;
  gearbox: GearboxDef;
  /**
   * Gearing presets the player can pick (physics/gearing.ts; race cars only). Undefined = fixed gearing (the setup
   * screen says "no configuration available").
   */
  gearings?: Record<GearingId, GearingPreset>;
  /** The gearing preset `gearbox.finalDrive` holds (set by `applyGearing`); missing = medium. */
  gearing?: GearingId;
  drivetrain: DrivetrainDef;
  /** Drag coefficient × frontal area (m²). */
  dragArea: number;
  /** Downforce coefficient × area (m²), 0 for most gravel cars. */
  downforceArea: number;
  /**
   * Body collision spheres [x, y, z, r] relative to the centre of mass. Fit them to the real body with `bodyHull`
   * (physics/hull.ts) so the underside is where the model's is; undefined = `autoHull` from the bounding box.
   */
  hull?: [number, number, number, number][];
}

export type WheelId = 'FL' | 'FR' | 'RL' | 'RR';
