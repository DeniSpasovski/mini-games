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
  // 35 % braking mid-corner spun the car. Total torque kept so part-pedal stops stay the same (HANDLING-REVIEW.md).
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
  physics: {
    mass: 870,
    length: 3.84,
    width: 1.59,
    height: 1.4,
    comHeight: 0.5,
    inertiaScale: 0.9,
    wheelRadius: 0.285,
    wheelWidth: 0.165,
    tyres: {
      // Stock 145/80 R13: thin, tall sidewall, one rim for every compound.
      size: { width: 0.145, aspect: 80, rim: 13 },
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
    // The body is hand-built (`custom`, below). stations / cabin / parts are a rough match of it,
    // used only by the generic bolt-on kit of an imported model. Rear -> front.
    stations: [
      { z: -2.246, floor: 0.31, belt: 0.75, hw: 0.66, hwBelt: 0.6 },
      { z: -2.18, floor: 0.27, belt: 0.77, hw: 0.74, hwBelt: 0.68 },
      { z: -2.0, floor: 0.24, belt: 0.81, hw: 0.78, hwBelt: 0.72 },
      { z: -1.8, floor: 0.23, belt: 0.87, hw: 0.79, hwBelt: 0.74 },
      { z: -1.55, floor: 0.23, belt: 0.92, hw: 0.79, hwBelt: 0.74 },
      { z: -1.0, floor: 0.23, belt: 0.84, hw: 0.78, hwBelt: 0.73 },
      { z: -0.4, floor: 0.23, belt: 0.82, hw: 0.78, hwBelt: 0.73 },
      { z: 0.2, floor: 0.23, belt: 0.83, hw: 0.78, hwBelt: 0.73 },
      { z: 0.61, floor: 0.23, belt: 0.88, hw: 0.79, hwBelt: 0.74 },
      { z: 1.2, floor: 0.26, belt: 0.89, hw: 0.8, hwBelt: 0.74 },
      { z: 1.41, floor: 0.29, belt: 0.83, hw: 0.79, hwBelt: 0.72 },
      { z: 1.55, floor: 0.32, belt: 0.74, hw: 0.76, hwBelt: 0.68 },
      { z: 1.591, floor: 0.34, belt: 0.72, hw: 0.7, hwBelt: 0.62 },
    ],
    cabin: {
      zFront: 0.61,
      zRear: -1.58,
      roofFront: 0.19,
      roofRear: -1.06,
      roofY: 1.39,
      roofHw: 0.56,
      bPillar: -0.41,
      kick: 0.25,
    },
    paint: '#004225', // British racing green
    flare: 0.02,
    rim: { color: '#7c8084', spokes: 10, style: 'steel' },
    parts: { arches: 'round', bumpers: 'black', doors: 4 },
    livery: 'classic',
    custom: { atlas: zastavaAtlas, build: buildZastavaBody },
    paintFinish: 'satin',
    glass: { color: 0x39464f, opacity: 0.3 },
    wheels: buildZastavaWheel,
    tyreDust: true,
    suspensionStyle: 'road',
    gltf: {
      file: 'zastava_101.glb',
      credit:
        '"Zastava 101 (Stojadin)" by Tomislav Tomljenović, sketchfab.com/3d-models/zastava-101-stojadin-52c885cfc52a4ac1acb14f84a3feacfa, CC BY 4.0',
    },
  },
};
