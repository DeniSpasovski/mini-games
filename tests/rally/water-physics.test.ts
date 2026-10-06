import { describe, expect, test } from '@rstest/core';
import { Vector3 } from 'three';
import { ALL_CARS, getCar } from '../../src/games/rally/cars';
import { SURFACES } from '../../src/games/rally/physics/surfaces';
import type {
  GroundProvider,
  GroundSample,
} from '../../src/games/rally/physics/types';
import { ALL_MAPS } from '../../src/games/rally/maps/all';
import { PHYSICS_HZ, Vehicle } from '../../src/games/rally/physics/vehicle';
import { World } from '../../src/games/rally/world/world';

/**
 * Driving through water (canals / rivers): flat ground, a pool of `depth` m of water
 * from z = `from` on. The bed is mud like in the game (`surfaceAt`).
 */
const DT = 1 / PHYSICS_HZ;

function pond(depth: number, from = -Infinity): GroundProvider {
  return {
    sampleGround(_x: number, z: number, out: GroundSample) {
      out.height = 0;
      out.normal.set(0, 1, 0);
      out.surface = depth > 0 && z >= from ? SURFACES.mud : SURFACES.gravel;
      return out;
    },
    waterLevel: (_x, z) => (depth > 0 && z >= from ? depth : NaN),
  };
}

function car(carId: string, ground: GroundProvider): Vehicle {
  const v = new Vehicle(ALL_CARS.find((c) => c.id === carId)!.physics, ground);
  v.reset(new Vector3(0, 0, 0), 0);
  for (let i = 0; i < 2 * PHYSICS_HZ; i++) v.step(DT);
  return v;
}

/** Full throttle from standstill for `seconds`: speed reached (km/h). */
function launch(v: Vehicle, seconds: number): number {
  v.controls = { throttle: 1, brake: 0, steer: 0, handbrake: 0 };
  for (let i = 0; i < seconds * PHYSICS_HZ; i++) v.step(DT);
  return v.speed * 3.6;
}

describe.each(ALL_CARS.map((c) => c.id))('water %s', (carId) => {
  test('wading slows acceleration, deeper water more', () => {
    const dry = launch(car(carId, pond(0)), 6);
    const shallow = launch(car(carId, pond(0.2)), 6);
    const deep = launch(car(carId, pond(0.6)), 6);
    console.info(
      `[${carId}] 6 s full throttle: dry ${dry.toFixed(0)} km/h, 0.2 m water ${shallow.toFixed(0)} km/h, 0.6 m ${deep.toFixed(0)} km/h`,
    );
    expect(shallow).toBeLessThan(dry * 0.75);
    expect(deep).toBeLessThan(shallow * 0.7);
    // Deep water: walking-pace wading, but still moving (the car can drive out).
    expect(deep).toBeGreaterThan(3);
    expect(deep).toBeLessThan(25);
  });

  test('hitting water at speed brakes the car hard and keeps it upright', () => {
    const v = car(carId, pond(0.5, 60));
    v.controls = { throttle: 1, brake: 0, steer: 0, handbrake: 0 };
    let t = 0;
    let minUp = 1;
    while (v.position.z < 60 && t < 30) {
      v.step(DT);
      t += DT;
    }
    const entry = v.speed * 3.6;
    for (let i = 0; i < 2 * PHYSICS_HZ; i++) {
      v.step(DT);
      minUp = Math.min(minUp, v.up.y);
    }
    const after = v.speed * 3.6;
    console.info(
      `[${carId}] into 0.5 m water at ${entry.toFixed(0)} km/h -> ${after.toFixed(0)} km/h after 2 s (depth ${v.waterDepth.toFixed(2)} m, engine ${(v.engineWater * 100).toFixed(0)}%, min up.y ${minUp.toFixed(2)})`,
    );
    expect(entry).toBeGreaterThan(60);
    expect(after).toBeLessThan(entry * 0.5);
    expect(v.waterDepth).toBeGreaterThan(0.3);
    expect(minUp).toBeGreaterThan(0.7);
  });
});

test('real canal: the car wades along the Ajvatovci drain', () => {
  const world = new World(ALL_MAPS.find((m) => m.id === 'ajvatovci')!);
  const net = world.gen.channels!;
  const a = { x: 0, z: 0 };
  const b = { x: 0, z: 0 };
  net.pointAt(1, 700, a);
  net.pointAt(1, 712, b);
  const v = new Vehicle(getCar('skoda_rally').physics, world);
  v.reset(
    new Vector3(a.x, world.heightAt(a.x, a.z), a.z),
    Math.atan2(b.x - a.x, b.z - a.z),
  );
  for (let i = 0; i < 2 * PHYSICS_HZ; i++) v.step(DT);
  const surfaces = v.wheels.map((w) => w.surface.id);
  const depth = v.waterDepth;
  const kmh = launch(v, 6);
  console.info(
    `[ajvatovci drain] water ${depth.toFixed(2)} m, wheels on ${surfaces.join('/')}, 6 s full throttle -> ${kmh.toFixed(0)} km/h, engine ${(v.engineWater * 100).toFixed(0)}%`,
  );
  expect(depth).toBeGreaterThan(0.5);
  expect(surfaces.every((s) => s === 'mud')).toBe(true);
  expect(kmh).toBeLessThan(20);
});
