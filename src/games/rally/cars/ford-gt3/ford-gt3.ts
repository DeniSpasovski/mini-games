import { deriveSetups } from '../../physics/car-setup';
import { bodyHull } from '../../physics/hull';
import type { BrakeSet } from '../../physics/brakes';
import type { AxleDef } from '../../physics/types';
import type { CarDef } from '../shared/types';
import { profile } from './profile';
import { fordGt3Livery } from './livery';

/** Mustang GT3: wheelbase 2.728 m between the model's hubs; the front axle sits at z = 1.419 (front-engine, ~48 % of the weight on the front). */
const AXLE_F = 1.419;
const AXLE_R = AXLE_F - 2.728;

/** Track slick against a rally competition tyre (PHYSICS.md "Tyre types"). */
const SLICK = 1.12;

/** Body dimensions (also what the hull is fitted from); wheel radius = front tyre overall radius. */
const BODY = {
  length: 4.92,
  width: 2.02,
  height: 1.33,
  comHeight: 0.46,
  // Reference radius (the model's hubs); the slicks are 300/38 R18 front, 310/41 R18 rear (rear 1.3 cm taller).
  wheelRadius: 0.3426,
};

// Hubs of the model: front x +-0.83, rear x +-0.822 (the wheels are the game's own, with the model's rim, centred on them).
const FRONT: AxleDef = {
  z: AXLE_F,
  track: 1.66,
  spring: 92000,
  bump: 4200,
  rebound: 7560,
  travel: 0.13,
  antiRoll: 26000,
  handbrakeTorque: 0,
  steer: 1,
  grip: 1.15,
  forceHeight: 0.3,
};

const REAR: AxleDef = {
  z: AXLE_R,
  track: 1.644,
  spring: 84000,
  bump: 3900,
  rebound: 7020,
  travel: 0.13,
  antiRoll: 17000,
  handbrakeTorque: 3000,
  steer: 0,
  grip: 1.6,
  forceHeight: 0.3,
};

/** Mustang GT3 brakes: big ventilated iron discs, Alcon 6-piston front / 4-piston rear, race pads (PHYSICS.md "Brakes"). */
const BRAKES: BrakeSet = {
  front: {
    type: 'vented',
    diameter: 0.38,
    thickness: 0.032,
    pad: 'race',
    clamp: 11850,
    ducted: true,
  },
  rear: {
    type: 'vented',
    diameter: 0.343,
    thickness: 0.028,
    pad: 'race',
    clamp: 12500,
    ducted: true,
  },
};

/**
 * Ford Mustang GT3 (`ford_gt3`) - the 2024 customer GT3 racer: a CC BY Sketchfab model kept as it is (flat paint, own cockpit,
 * lamps and rim), mapped to game parts by material only (model.source.json). Test car (release.ts).
 */
export const fordGt3: CarDef = {
  id: 'ford_gt3',
  name: 'Ford Mustang GT3',
  className: 'GT3 · RWD V8',
  description:
    'Customer GT3 racer of the seventh-generation Mustang: a 5.4 litre V8 up front, a rear-mounted sequential gearbox and slicks on all four corners.',
  sources: [
    {
      label: '"2024 Ford Mustang GT3" by kevin (Sketchfab)',
      url: 'https://sketchfab.com/3d-models/2024-ford-mustang-gt3-d2b7823f48f147e99e857ee825d089cc',
      note: 'imported body, cockpit, lamps and rim (converted + repainted), CC BY 4.0',
    },
    {
      label: 'Ford Performance - Mustang GT3',
      url: 'https://www.ford.com/performance/mustang-gt3/',
      note: 'specification reference (5.4 l Coyote-based V8, rear transaxle)',
    },
  ],
  // Night headlights: racing LED.
  headlights: {
    power: 1.5,
    color: 0xf0f4ff,
    angle: 0.34,
    penumbra: 0.3,
    spill: 0.16,
  },
  // 5.4 l naturally aspirated V8, open race exhaust, sequential race box.
  sound: {
    layout: 'v8',
    displacement: 5.4,
    exhaust: 1,
    intake: 0.6,
    pops: 0.7,
    gearWhine: 0.8,
    gearbox: 'sequential',
    cam: 0.6,
  },
  physics: {
    mass: 1300, // GT3 class minimum weight (BoP-dependent)
    ...BODY,
    inertiaScale: 0.9,
    hardBumpStop: true,
    wheelWidth: 0.28,
    // Slicks 300/38 R18 front / 310/41 R18 rear; rally compounds keep the taller rear, gravel runs one width (a wide tyre ploughs).
    tyres: {
      size: { width: 0.3, aspect: 38, rim: 18, grade: SLICK },
      byCompound: {
        mixed: { width: 0.245, aspect: 42, rim: 18 },
        gravel: { width: 0.235, aspect: 50, rim: 17 },
      },
      rear: {
        size: { width: 0.31, aspect: 41, rim: 18, grade: SLICK },
        byCompound: {
          mixed: { width: 0.265, aspect: 48, rim: 18 },
          gravel: { width: 0.235, aspect: 60, rim: 17 },
        },
      },
    },
    wheelInertia: 1.8,
    maxSteerDeg: 30,
    front: FRONT,
    rear: REAR,
    setup: 'stiff',
    setups: deriveSetups(
      { front: FRONT, rear: REAR },
      {
        soft: { front: 56000, rear: 51000, travel: 0.16, ride: 0.045 },
        medium: { front: 74000, rear: 67000, travel: 0.145, ride: 0.032 },
        stiff: { front: 92000, rear: 84000, travel: 0.13, ride: 0.02 },
      },
    ),
    engine: {
      // 5.4 l NA V8 (restrictor / BoP): ~640 Nm at 5500, ~390 kW (530 hp) at 6800.
      torqueCurve: [
        [1000, 300],
        [2000, 420],
        [3000, 520],
        [4000, 590],
        [5000, 635],
        [5500, 640],
        [6000, 625],
        [6800, 548],
        [7400, 470],
      ],
      idleRpm: 1000,
      redlineRpm: 7400,
      inertia: 0.22,
      engineBrake: 85,
      launchRpm: 4500,
    },
    gearbox: {
      ratios: [2.9, 2.05, 1.6, 1.3, 1.1, 0.95],
      reverse: 3.2,
      finalDrive: 4.4,
      shiftTime: 0.1,
      efficiency: 0.9,
      upshiftRpm: 7100,
      downshiftRpm: 4600,
    },
    gearings: {
      short: { finalDrive: 5.0 },
      medium: { finalDrive: 4.4 },
      long: { finalDrive: 3.95 },
    },
    drivetrain: {
      frontSplit: 0,
      centerLock: 0,
      frontDiffLock: 0,
      rearDiffLock: 280,
    },
    brakes: BRAKES,
    dragArea: 0.85,
    downforceArea: 0.4,
    // Fitted to ford_gt3.glb (tests/rally/hull-fit.test.ts prints the model's underside per zone): splitter 9 cm, sills and floor
    // 6.7 - 7.6 cm, diffuser strakes 6.5 cm above the ground; the stiff set-up rides 2 cm higher for the test map's dips.
    hull: bodyHull(BODY, 0.005, [
      { x: [0, 0.5], z: 2.2, r: 0.16, bottom: 0.09 },
      { x: [0.72], z: 1.8, r: 0.22, bottom: 0.09 },
      { x: [0.72], z: 0.9, r: 0.22, bottom: 0.075 },
      { x: [0.72], z: 0, r: 0.22, bottom: 0.072 },
      { x: [0.72], z: -0.9, r: 0.22, bottom: 0.072 },
      { x: [0], z: -0.4, r: 0.22, bottom: 0.08 },
      { x: [0.72], z: -1.8, r: 0.22, bottom: 0.07 },
      { x: [0, 0.45], z: -2.25, r: 0.2, bottom: 0.08 },
    ]),
  },
  model: {
    paint: '#1a2b55',
    // The model's own rim (ford_gt3_wheel.glb), de-cambered and centred on the hub.
    rim: { color: '#3a3d42', spokes: 10, style: 'spoke', caliper: '#c8a040' },
    wheelModel: 'ford_gt3_wheel.glb',
    suspensionStyle: 'gt3',
    cornerSuspension: {
      style: 'gt3',
      front: 'wishbone',
      rear: 'wishbone',
      topY: { front: 0.4, rear: 0.4 },
      topIn: { front: 0.22, rear: 0.22 },
      driven: ['rear'],
    },
    // The model carries its own cockpit: see-through glass shows it.
    glass: { color: 0x141c24, opacity: 0.6 },
    // Fallback body if the GLB can't load (and the street car of the city maps): profile.ts.
    profile,
    doorBadge: { z: 0.25, y: 0.6 },
    gltf: {
      file: 'ford_gt3.glb',
      credit:
        '"2024 Ford Mustang GT3" by kevin, sketchfab.com/3d-models/2024-ford-mustang-gt3-d2b7823f48f147e99e857ee825d089cc, CC BY 4.0 (converted + repainted)',
      autoFit: false,
      atlas: fordGt3Livery,
      // Red wing end plates (cut out of the black trim; blade and struts stay black).
      recolor: [
        {
          part: 'trim',
          box: [0.78, 1, 0.95, 1.5, -2.6, -1.9],
          absX: true,
          color: '#c4202c',
        },
      ],
    },
  },
};
