import { sampleTorque } from './drivetrain';
import type { CarPhysicsDef, GearingId } from './types';

/**
 * Gearing presets (setup screen): Short / Medium / Long final drive - the gearbox ratios stay, like a rally team
 * swapping the final drive for a fast or a twisty stage. Short = harder pull, lower top speed; Long = the other way.
 * Only cars with `CarPhysicsDef.gearings` can change it (the race cars); the others show their fixed gearing.
 * Medium is always the car's own `gearbox.finalDrive` (integration-tests/rally/gearing.test.ts). Design: ../PHYSICS.md "Gearing".
 */
export const GEARING_IDS: readonly GearingId[] = ['short', 'medium', 'long'];

export const GEARING_NAMES: Record<GearingId, string> = {
  short: 'Short',
  medium: 'Medium',
  long: 'Long',
};

export function isGearingId(v: unknown): v is GearingId {
  return (
    typeof v === 'string' && (GEARING_IDS as readonly string[]).includes(v)
  );
}

/** Whether the player can change this car's gearing. */
export function hasGearings(def: CarPhysicsDef): boolean {
  return !!def.gearings;
}

/** The car with a gearing preset's final drive (cars without presets come back unchanged, gearing 'medium'). */
export function applyGearing(def: CarPhysicsDef, id: GearingId): CarPhysicsDef {
  const g = def.gearings?.[id];
  if (!g) return def;
  return {
    ...def,
    gearing: id,
    gearbox: { ...def.gearbox, finalDrive: g.finalDrive },
  };
}

const RPM_TO_RADS = (2 * Math.PI) / 60;
const AIR_DENSITY = 1.2;
const G = 9.81;

/** Road speed (m/s) at `rpm` in a gear (1-based). */
export function gearSpeed(
  def: CarPhysicsDef,
  gear: number,
  rpm: number,
): number {
  const gb = def.gearbox;
  return (
    ((rpm * RPM_TO_RADS) / (gb.ratios[gear - 1] * gb.finalDrive)) *
    def.wheelRadius
  );
}

/**
 * Flat-ground top speed (m/s) on tarmac: the fastest speed in any gear where the wheel force still beats drag +
 * rolling resistance, capped by the redline (the setup screen's number; the sim agrees within a few km/h).
 */
export function topSpeed(def: CarPhysicsDef, rolling = 0.013): number {
  const gb = def.gearbox;
  const eng = def.engine;
  let best = 0;
  for (let gear = 1; gear <= gb.ratios.length; gear++) {
    const ratio = gb.ratios[gear - 1] * gb.finalDrive;
    for (let rpm = eng.idleRpm; rpm <= eng.redlineRpm; rpm += 25) {
      const v = gearSpeed(def, gear, rpm);
      const drive =
        (sampleTorque(eng, rpm) * ratio * gb.efficiency) / def.wheelRadius;
      const resist =
        0.5 * AIR_DENSITY * def.dragArea * v * v + rolling * def.mass * G;
      if (drive >= resist) best = Math.max(best, v);
    }
  }
  return best;
}

/** Top speed (m/s) at the redline in every gear - the setup screen's gear chart. */
export function gearTopSpeeds(def: CarPhysicsDef): number[] {
  return def.gearbox.ratios.map((_, i) =>
    gearSpeed(def, i + 1, def.engine.redlineRpm),
  );
}
