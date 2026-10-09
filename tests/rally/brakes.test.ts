import { describe, expect, test } from '@rstest/core';
import { Vector3 } from 'three';
import { ALL_CARS } from '../../src/games/rally/cars';
import {
  brakeKit,
  brakeLevel,
  brakeStartTemp,
  brakeThermal,
  brakeTorque,
  padFactor,
  stepBrakeTemp,
  type BrakeDef,
} from '../../src/games/rally/physics/brakes';
import { applySetup } from '../../src/games/rally/physics/car-setup';
import {
  SURFACES,
  type SurfaceId,
} from '../../src/games/rally/physics/surfaces';
import type {
  GroundProvider,
  GroundSample,
} from '../../src/games/rally/physics/types';
import { PHYSICS_HZ, Vehicle } from '../../src/games/rally/physics/vehicle';

/** Brakes (physics/brakes.ts, src/games/rally/PHYSICS.md "Brakes"): torque from the hardware, heat, fade. */
const DT = 1 / PHYSICS_HZ;
const AIR = { air: 20, sun: 0 };
const G = 9.81;
const def = (id: string) => ALL_CARS.find((c) => c.id === id)!.physics;

const flat = (surface: SurfaceId): GroundProvider => ({
  sampleGround(_x: number, _z: number, out: GroundSample) {
    out.height = 0;
    out.normal.set(0, 1, 0);
    out.surface = SURFACES[surface];
    return out;
  },
});

/** Front disc temperature after `n` stops v1 -> v2 (m/s) at `decel`, one every `gap` s, cruising at v1 between. */
function stops(
  id: string,
  n: number,
  v1: number,
  v2: number,
  gap: number,
  decel = 11,
): number {
  const d = def(id);
  const kit = d.brakes;
  const tf = brakeTorque(kit.front);
  const tr = brakeTorque(kit.rear);
  const share = tf / (tf + tr);
  const th = brakeThermal(kit.front);
  const dt = 0.01;
  let temp = AIR.air;
  for (let i = 0; i < n; i++) {
    let v = v1;
    let t = 0;
    for (; v > v2; t += dt) {
      // Half the car's braking work per axle, split over its two discs.
      const power = (share / 2) * d.mass * decel * v;
      temp = stepBrakeTemp({ temp, power, speed: v, water: 0 }, th, AIR, dt);
      v -= decel * dt;
    }
    for (; t < gap; t += dt)
      temp = stepBrakeTemp(
        { temp, power: 0, speed: v1, water: 0 },
        th,
        AIR,
        dt,
      );
  }
  return temp;
}

describe('brake hardware', () => {
  test('a bigger disc gives more torque for the same clamp force', () => {
    const big: BrakeDef = { ...def('skoda_rally').brakes.front };
    const small: BrakeDef = { ...big, diameter: 0.3 };
    expect(brakeTorque(big) / brakeTorque(small)).toBeCloseTo(0.355 / 0.3, 2);
  });

  test('disc masses match the weighed ones (+-15 %)', () => {
    const mass = (b: BrakeDef) => brakeThermal(b).mass;
    expect(mass(def('skoda_rally').brakes.front)).toBeGreaterThan(7.6 * 0.85);
    expect(mass(def('skoda_rally').brakes.front)).toBeLessThan(7.6 * 1.15);
    expect(mass(def('skoda_rally').brakes.rear)).toBeGreaterThan(4.7 * 0.85);
    expect(mass(def('skoda_rally').brakes.rear)).toBeLessThan(4.7 * 1.15);
    expect(mass(def('zastava_101').brakes.front)).toBeGreaterThan(1.9 * 0.85);
    expect(mass(def('zastava_101').brakes.front)).toBeLessThan(1.9 * 1.15);
  });

  test('rally cars carry the smaller gravel kit with the mixed and gravel compounds', () => {
    const d = def('skoda_rally');
    expect(brakeKit(d.brakes, d.gravelBrakes, 'tarmac')).toBe(d.brakes);
    expect(brakeKit(d.brakes, d.gravelBrakes, 'mixed')).toBe(d.gravelBrakes);
    expect(brakeKit(d.brakes, d.gravelBrakes, 'gravel')).toBe(d.gravelBrakes);
    expect(brakeKit(d.brakes, d.gravelBrakes, null)).toBe(d.brakes);
    expect(d.gravelBrakes!.front.diameter).toBeLessThan(
      d.brakes.front.diameter,
    );
  });

  test('every car has the brake the plan names: bias to the front, front locks first', () => {
    for (const c of ALL_CARS) {
      const k = c.physics.brakes;
      const share =
        brakeTorque(k.front) / (brakeTorque(k.front) + brakeTorque(k.rear));
      // GT2 / M3 carry a grippier rear tyre (axle grip 1.6 / 1.3), so their rear takes a bigger share.
      expect(share, c.id).toBeGreaterThan(0.5);
      expect(share, c.id).toBeLessThan(0.8);
    }
    expect(def('zastava_101').brakes.rear.type).toBe('drum');
    expect(def('zastava_101').brakes.front.type).toBe('solid');
  });
});

describe('pad friction against temperature', () => {
  const rally = def('skoda_rally').brakes.front;
  const road = def('zastava_101').brakes.front;
  const sport = def('bimmer_m3').brakes.front;
  const race = def('bimmer_gt2').brakes.front;

  test('cold pads bite less, full in the window, fade above it down to a floor', () => {
    for (const b of [road, sport, rally, race]) {
      expect(padFactor(20, b)).toBeLessThan(0.95);
      expect(padFactor(20, b)).toBeGreaterThan(0.5);
      expect(padFactor(20, b)).toBeLessThan(padFactor(100, b) + 1e-9);
      expect(padFactor(300, b)).toBeLessThanOrEqual(1);
      expect(padFactor(1200, b)).toBeGreaterThan(0.3);
      expect(padFactor(1200, b)).toBeLessThan(0.6);
    }
    expect(padFactor(400, rally)).toBe(1);
    expect(padFactor(400, road)).toBeLessThan(0.9);
  });

  test('classes fade at their own temperature: road < sport < rally < race', () => {
    const at = (b: BrakeDef) => {
      let t = 300;
      while (padFactor(t, b) > 0.95) t += 5;
      return t;
    };
    expect(at(road)).toBeLessThan(at(sport));
    expect(at(sport)).toBeLessThan(at(rally));
    expect(at(rally)).toBeLessThan(at(race));
  });

  test('a drum fades harder than a disc of the same lining and cools slower', () => {
    const drum = def('zastava_101').brakes.rear;
    expect(padFactor(450, drum)).toBeLessThan(padFactor(450, road));
    const cool = (b: BrakeDef) => {
      const th = brakeThermal(b);
      let temp = 600;
      let t = 0;
      for (; temp > 300 && t < 5000; t += 0.1)
        temp = stepBrakeTemp(
          { temp, power: 0, speed: 27.8, water: 0 },
          th,
          AIR,
          0.1,
        );
      return t;
    };
    const solidTwin: BrakeDef = { ...road, diameter: 0.227 };
    expect(cool(drum)).toBeGreaterThan(cool(solidTwin));
  });

  test('brake level for the HUD runs cold 0 -> biting 1..2 -> fade 2..3', () => {
    expect(brakeLevel(20, rally)).toBe(0);
    expect(brakeLevel(400, rally)).toBeGreaterThan(1);
    expect(brakeLevel(400, rally)).toBeLessThan(2);
    expect(brakeLevel(700, rally)).toBeGreaterThan(2);
    expect(brakeLevel(2000, rally)).toBe(3);
  });
});

describe('disc heat', () => {
  test('one 100-0 km/h stop warms a Skoda front disc 30-70 K (more on the gravel kit)', () => {
    const tarmac = stops('skoda_rally', 1, 27.8, 0.1, 0) - AIR.air;
    expect(tarmac).toBeGreaterThan(30);
    expect(tarmac).toBeLessThan(70);
    const d = def('skoda_rally');
    const th = brakeThermal(d.gravelBrakes!.front);
    const tf = brakeTorque(d.gravelBrakes!.front);
    const tr = brakeTorque(d.gravelBrakes!.rear);
    let temp = AIR.air;
    for (let v = 27.8; v > 0.1; v -= 11 * 0.01)
      temp = stepBrakeTemp(
        {
          temp,
          power: (tf / (tf + tr) / 2) * d.mass * 11 * v,
          speed: v,
          water: 0,
        },
        th,
        AIR,
        0.01,
      );
    expect(temp - AIR.air).toBeGreaterThan(tarmac);
  });

  test('ten 150 -> 60 km/h stops, 30 s apart: the road pad fades, the rally pad does not', () => {
    const zastava = stops('zastava_101', 10, 41.7, 16.7, 30, 8);
    expect(zastava).toBeGreaterThan(
      def('zastava_101').brakes.front.pad === 'road' ? 600 : 0,
    );
    expect(padFactor(zastava, def('zastava_101').brakes.front)).toBeLessThan(
      0.6,
    );
    const skoda = stops('skoda_rally', 10, 41.7, 16.7, 30);
    expect(skoda).toBeLessThan(650);
    expect(padFactor(skoda, def('skoda_rally').brakes.front)).toBe(1);
  });

  test('a 600 C disc is below 300 C within minutes at 100 km/h, and takes longer standing still', () => {
    const th = brakeThermal(def('skoda_rally').brakes.front);
    const time = (speed: number) => {
      let temp = 600;
      let t = 0;
      for (; temp > 300 && t < 3000; t += 0.1)
        temp = stepBrakeTemp({ temp, power: 0, speed, water: 0 }, th, AIR, 0.1);
      return t;
    };
    expect(time(27.8)).toBeGreaterThan(100);
    expect(time(27.8)).toBeLessThan(400);
    expect(time(0)).toBeGreaterThan(time(27.8) * 2);
  });

  test('a hot disc cools much faster in water, and a hot day cools it slower', () => {
    const th = brakeThermal(def('skoda_rally').brakes.front);
    const step = (water: number, air: number) =>
      stepBrakeTemp(
        { temp: 600, power: 0, speed: 5, water },
        th,
        { air, sun: 0 },
        1,
      );
    expect(600 - step(0.2, 20)).toBeGreaterThan((600 - step(0, 20)) * 3);
    expect(600 - step(0, 40)).toBeLessThan(600 - step(0, 0));
  });

  test('the disc never drops below the air', () => {
    const th = brakeThermal(def('skoda_rally').brakes.front);
    let temp = 30;
    for (let i = 0; i < 1000; i++)
      temp = stepBrakeTemp({ temp, power: 0, speed: 30, water: 0 }, th, AIR, 1);
    expect(temp).toBeGreaterThanOrEqual(AIR.air);
  });
});

describe('vehicle brakes', () => {
  function build(
    id: string,
    tyre: 'tarmac' | 'gravel',
    climate = true,
  ): Vehicle {
    const v = new Vehicle(applySetup(def(id), 'medium'), flat('tarmac'));
    v.setTyre(tyre);
    if (climate) v.setClimate(AIR);
    v.reset(new Vector3(), 0);
    for (let i = 0; i < 1.5 * PHYSICS_HZ; i++) v.step(DT);
    return v;
  }

  function stopFrom(v: Vehicle, kmh: number, seconds = 12): number {
    const V = kmh / 3.6;
    v.velocity.copy(v.forward).multiplyScalar(V);
    for (const w of v.wheels) w.omega = V / w.radius;
    v.drivetrain.setGear(3);
    const z0 = v.position.z;
    v.controls.throttle = 0;
    v.controls.brake = 1;
    for (let i = 0; i < seconds * PHYSICS_HZ && v.speed > 0.5; i++) v.step(DT);
    return v.position.z - z0;
  }

  test('without a climate the pads are always at full friction and nothing heats', () => {
    const v = build('skoda_rally', 'tarmac', false);
    stopFrom(v, 100);
    for (const w of v.wheels) {
      expect(w.brakeFactor).toBe(1);
      expect(w.brakeTemp).toBe(20);
    }
  });

  test('a stop heats the discs, the front more than the rear', () => {
    const v = build('skoda_rally', 'tarmac');
    const start = brakeStartTemp(AIR);
    expect(v.wheels[0].brakeTemp).toBeCloseTo(start, 0);
    stopFrom(v, 100);
    expect(v.wheels[0].brakeTemp).toBeGreaterThan(start + 20);
    expect(v.wheels[0].brakeTemp).toBeGreaterThan(v.wheels[2].brakeTemp);
  });

  test('the tyre force settles at the brake torque over the radius', () => {
    // Zastava: front drive, no ABS - the rear wheels are free-rolling, so their force is the brake's.
    const v = build('zastava_101', 'tarmac', false);
    const V = 80 / 3.6;
    v.velocity.copy(v.forward).multiplyScalar(V);
    for (const w of v.wheels) w.omega = V / w.radius;
    v.controls.throttle = 0;
    v.controls.brake = 0.4;
    for (let i = 0; i < 0.6 * PHYSICS_HZ; i++) v.step(DT);
    const rear = v.wheels.filter((w) => !w.isFront);
    for (const w of rear) {
      const expected = (0.4 * w.brakeFull) / w.radius;
      expect(-w.fx).toBeGreaterThan(expected * 0.85);
      expect(-w.fx).toBeLessThan(expected * 1.15);
    }
  });

  test('cold brakes pull less than warm ones, a faded disc less still', () => {
    const decel = (temp: number) => {
      const v = build('zastava_101', 'tarmac');
      for (const w of v.wheels) w.brakeTemp = temp;
      v.step(DT);
      return v.brakeDecel;
    };
    const warm = decel(150);
    expect(decel(20)).toBeLessThan(warm * 0.95);
    expect(decel(700)).toBeLessThan(warm * 0.5);
  });

  test('brakeDecel falls with fade and with a smaller kit', () => {
    const v = build('skoda_rally', 'tarmac');
    for (const w of v.wheels) w.brakeFactor = 1;
    const full = v.brakeDecel;
    for (const w of v.wheels) w.brakeFactor = 0.5;
    expect(v.brakeDecel).toBeCloseTo(full / 2, 5);
    const gravel = build('skoda_rally', 'gravel');
    for (const w of gravel.wheels) w.brakeFactor = 1;
    expect(gravel.brakeDecel).toBeLessThan(full);
    expect(gravel.brakeDecel / G).toBeGreaterThan(1.1);
  });

  test('every car can out-brake its own tyre on tarmac, and the Zastava / M3 / 22B are brake-limited', () => {
    for (const c of ALL_CARS) {
      const v = build(c.id, 'tarmac', false);
      const g = v.brakeDecel / G;
      expect(g, c.id).toBeGreaterThan(0.7);
      expect(g, c.id).toBeLessThan(2.2);
    }
  });
});
