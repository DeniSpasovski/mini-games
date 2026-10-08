import { describe, expect, test } from '@rstest/core';
import { Vector3 } from 'three';
import { ALL_CARS } from '../../src/games/rally/cars';
import { Autopilot } from '../../src/games/rally/game/autopilot';
import { jackieMap } from '../../src/games/rally/maps/jackie/map';
import {
  applySetup,
  SETUP_FOR_TYRE,
} from '../../src/games/rally/physics/car-setup';
import {
  applyGearing,
  GEARING_IDS,
  hasGearings,
  topSpeed,
} from '../../src/games/rally/physics/gearing';
import {
  SURFACES,
  type SurfaceId,
} from '../../src/games/rally/physics/surfaces';
import type {
  CarPhysicsDef,
  GroundSample,
} from '../../src/games/rally/physics/types';
import { PHYSICS_HZ, Vehicle } from '../../src/games/rally/physics/vehicle';
import { newRoadQuery } from '../../src/games/rally/world/road';
import { World } from '../../src/games/rally/world/world';

/**
 * Gearing presets (physics/gearing.ts, PHYSICS.md "Gearing"): Short / Medium / Long final drive on the race cars,
 * fixed on the road car; medium = the car's own gearbox; the Fabia on long reaches 200 km/h on Jackie.
 */
const DT = 1 / PHYSICS_HZ;
const car = (id: string) => ALL_CARS.find((c) => c.id === id)!.physics;
const flat = (s: SurfaceId) => ({
  sampleGround(_x: number, _z: number, o: GroundSample) {
    o.height = 0;
    o.normal.set(0, 1, 0);
    o.surface = SURFACES[s];
    return o;
  },
  queryColliders: () => 0,
});

/** Full throttle on flat tarmac for 60 s: speed reached (m/s). */
function simTop(def: CarPhysicsDef): number {
  const v = new Vehicle(applySetup(def, 'stiff'), flat('tarmac'));
  v.setTyre('tarmac');
  v.reset(new Vector3(), 0);
  v.controls.throttle = 1;
  for (let i = 0; i < 60 * PHYSICS_HZ; i++) v.step(DT);
  return v.speed;
}

test('the race cars can change gearing, the road car cannot', () => {
  expect(hasGearings(car('skoda_rally'))).toBe(true);
  expect(hasGearings(car('bimmer_m3'))).toBe(true);
  expect(hasGearings(car('zastava_101'))).toBe(false);
  // Fixed gearing: every preset id leaves the car as it is.
  const z = car('zastava_101');
  for (const id of GEARING_IDS) expect(applyGearing(z, id)).toBe(z);
});

describe.each(ALL_CARS.filter((c) => hasGearings(c.physics)).map((c) => c.id))(
  '%s',
  (carId) => {
    const def = car(carId);

    test('medium is the car own final drive; short < medium < long in top speed', () => {
      expect(def.gearings!.medium.finalDrive).toBe(def.gearbox.finalDrive);
      const top = GEARING_IDS.map((id) => topSpeed(applyGearing(def, id)));
      expect(top[0]).toBeLessThan(top[1]);
      expect(top[1]).toBeLessThan(top[2]);
    });

    test('the setup screen top speed matches the simulation', () => {
      for (const id of ['medium', 'long'] as const) {
        const d = applyGearing(def, id);
        const sim = simTop(d) * 3.6;
        const calc = topSpeed(d) * 3.6;
        console.info(
          `[${carId} ${id}] top speed calc ${calc.toFixed(0)} / sim ${sim.toFixed(0)} km/h`,
        );
        expect(Math.abs(sim - calc)).toBeLessThan(5);
      }
    });
  },
);

test('jackie recommends long gearing and the Fabia reaches 200 km/h on it', () => {
  expect(jackieMap.gearing).toBe('long');
  const world = new World(jackieMap);
  const def = applyGearing(
    applySetup(car('skoda_rally'), SETUP_FOR_TYRE[jackieMap.tyre]),
    'long',
  );
  const v = new Vehicle(def, world);
  v.setTyre(jackieMap.tyre);
  const spawn = world.roadSpawn();
  v.reset(spawn.position, spawn.heading);
  // A driver who uses the car's speed (the stage tests' autopilot never goes past 151 km/h): the long straight
  // before 5 000 m is where 200 km/h is reached. Flat out, the autopilot is on a knife edge in the bends after it
  // (a millimetre of terrain beside the road decides whether a guard-rail brush spins it), so finishing the whole
  // stage is the stage test's job (at its own speed), not this one's.
  const ap = new Autopilot(world.road);
  ap.useExtraGrip = true;
  ap.maxSpeed = 70;
  ap.reset(world.stage.start - 9);
  let t = 0;
  let top = 0;
  let topOnRoad = false;
  const rq = newRoadQuery();
  while (t < 300 && ap.along < 5000) {
    ap.drive(v, v.controls);
    v.step(DT);
    t += DT;
    if (v.speed > top) {
      top = v.speed;
      world.road.query(v.position.x, v.position.z, rq);
      topOnRoad = rq.found && rq.distance <= rq.halfWidth;
    }
  }
  console.info(
    `[fabia long on jackie] ${t.toFixed(1)} s to ${ap.along.toFixed(0)} m, top ${(top * 3.6).toFixed(0)} km/h`,
  );
  expect(ap.along).toBeGreaterThanOrEqual(5000);
  expect(top * 3.6).toBeGreaterThanOrEqual(200);
  expect(topOnRoad).toBe(true);
}, 600000);
