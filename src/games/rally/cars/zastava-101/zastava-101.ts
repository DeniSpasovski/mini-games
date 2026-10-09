import { deriveSetups } from '../../physics/car-setup';
import type { AxleDef } from '../../physics/types';
import type { CarDef } from '../shared/types';
import { buildZastavaBody } from './body';
import { zastavaAtlas } from './paint';
import { buildZastavaWheel } from './wheels';

const FRONT: AxleDef = {
  z: 0.98,
  track: 1.3,
  spring: 23000,
  bump: 1700,
  rebound: 2400,
  travel: 0.22,
  antiRoll: 6000,
  brakeTorque: 1200,
  handbrakeTorque: 0,
  steer: 1,
  grip: 1,
  forceHeight: 0.35,
};

const REAR: AxleDef = {
  z: -1.47,
  track: 1.3,
  spring: 17000,
  bump: 1400,
  rebound: 2000,
  travel: 0.22,
  antiRoll: 4000,
  // 23 % rear (front 1200): the light rear (40 % static, less under braking) must not lock before the front - at
  // 35 % braking mid-corner spun the car. Total torque kept so part-pedal stops stay the same.
  brakeTorque: 350,
  handbrakeTorque: 1800,
  steer: 0,
  grip: 1.05,
  forceHeight: 0.35,
};

/**
 * Zastava 101 "Stojadin" - 70s Yugoslav FWD 5-door hatch with a mildly tuned 1.3 (~85 hp) and a
 * plated diff. Still the stock-looking car: the body is hand-built from the factory blueprint
 * (blueprint.ts / body.ts / paint.ts, see DETAILS.md); the rally conversion comes next.
 * Light and slow - wins on momentum, understeers if you're greedy.
 */
export const zastava101: CarDef = {
  id: 'zastava_101',
  name: 'Zastava 101',
  className: 'Historic · FWD',
  description:
    '70s "Stojadin": light FWD hatch with a tuned 1.3. Carry speed, use the handbrake.',
  sources: [
    {
      label: '"Zastava 101 (Stojadin)" by Tomislav Tomljenović',
      url: 'https://sketchfab.com/3d-models/zastava-101-stojadin-52c885cfc52a4ac1acb14f84a3feacfa',
      note: 'styling reference for the hand-built body + optional imported model, CC BY 4.0',
    },
  ],
  // Carburettor 1.3 four on a road silencer, no turbo: weak, thin and buzzy - mostly intake honk and a rough idle,
  // the odd carb backfire on a lift, soft road gearbox.
  sound: {
    layout: 'i4',
    displacement: 1.3,
    exhaust: 0.15,
    intake: 0.7,
    pops: 0.1,
    gearWhine: 0.1,
    gearbox: 'manual',
    cam: 0.1,
    roughness: 0.15,
  },
  physics: {
    noTractionControl: true,
    noAbs: true,
    mass: 870,
    length: 3.84,
    width: 1.59,
    height: 1.4,
    comHeight: 0.5,
    inertiaScale: 0.9,
    wheelRadius: 0.285,
    wheelWidth: 0.165,
    // 13" steel wheels on every compound, the tyre changes: stock 145/80 R13 (mixed), a wider 165/70 R13 on tarmac,
    // a taller 155/80 R13 on gravel.
    tyres: {
      size: { width: 0.145, aspect: 80, rim: 13 },
      byCompound: {
        tarmac: { width: 0.165, aspect: 70, rim: 13 },
        gravel: { width: 0.155, aspect: 80, rim: 13 },
      },
    },
    wheelInertia: 0.9,
    maxSteerDeg: 32,
    front: FRONT,
    rear: REAR,
    setup: 'soft',
    setups: deriveSetups(
      { front: FRONT, rear: REAR },
      {
        // Road car: a narrow band, always on the soft side (soft = today's numbers).
        // Ride height: road car, a narrow band (+15 / 0 / -10 mm around the stock 0.24 m floor).
        soft: { front: 23000, rear: 17000, travel: 0.22, ride: 0.015 },
        medium: { front: 32000, rear: 21000, travel: 0.2, ride: 0 },
        stiff: { front: 39000, rear: 26000, travel: 0.18, ride: -0.01 },
      },
    ),
    engine: {
      // ~84 hp: 160 km/h flat out, 0-100 ~11 s (was ~105 hp, 192 km/h, 8.7 s - too quick for a 70s 1.3).
      torqueCurve: [
        [1500, 56],
        [3000, 80],
        [4500, 96],
        [5500, 100],
        [6500, 92],
        [7300, 80],
      ],
      idleRpm: 900,
      redlineRpm: 7000,
      inertia: 0.12,
      engineBrake: 40,
      launchRpm: 4500,
    },
    gearbox: {
      ratios: [3.58, 2.24, 1.52, 1.1, 0.86],
      reverse: 3.7,
      finalDrive: 4.4,
      shiftTime: 0.18,
      efficiency: 0.9,
      upshiftRpm: 6700,
      downshiftRpm: 4000,
    },
    drivetrain: {
      frontSplit: 1,
      centerLock: 0,
      frontDiffLock: 150,
      rearDiffLock: 0,
    },
    // Body spans z = -2.246 .. 1.591 (not centred on the COM like the default hull): spheres at the corners.
    hull: [
      [0.495, 0.042, 1.29, 0.3],
      [-0.495, 0.042, 1.29, 0.3],
      [0.495, 0.042, -1.95, 0.3],
      [-0.495, 0.042, -1.95, 0.3],
      [0.495, 0.293, -0.33, 0.3],
      [-0.495, 0.293, -0.33, 0.3],
      [0.396, 0.6, -0.89, 0.3],
      [-0.396, 0.6, -0.89, 0.3],
      [0, 0.6, -0.09, 0.3],
      [0, 0.042, -0.33, 0.3],
      [0, 0.042, 1.29, 0.3],
      [0, 0.042, -1.95, 0.3],
    ],
    // Boxy 70s hatch (Cd ~0.47 x 1.9 m²): with the engine this caps it at ~160 km/h.
    dragArea: 0.9,
    downforceArea: 0,
  },
  model: {
    paint: '#004225', // British racing green
    rim: { color: '#7c8084', spokes: 10, style: 'steel' },
    custom: { atlas: zastavaAtlas, build: buildZastavaBody },
    // Rally plate: middle of the front door, just under the beltline.
    doorBadge: { z: 0.1, y: 0.606 },
    paintFinish: 'satin',
    glass: { color: 0x2a343c, opacity: 0.45 },
    wheels: buildZastavaWheel,
    tyreDust: true,
    suspensionStyle: 'road',
    cornerSuspension: {
      style: 'road',
      front: 'strut',
      rear: 'axle',
      topY: { front: 0.38, rear: 0.34 },
      topIn: { front: 0.2, rear: 0.2 },
      driven: [],
    },
    gltf: {
      file: 'zastava_101.glb',
      credit:
        '"Zastava 101 (Stojadin)" by Tomislav Tomljenović, sketchfab.com/3d-models/zastava-101-stojadin-52c885cfc52a4ac1acb14f84a3feacfa, CC BY 4.0',
    },
  },
};
