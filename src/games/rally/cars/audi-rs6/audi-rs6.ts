import { deriveSetups } from '../../physics/car-setup';
import { bodyHull } from '../../physics/hull';
import type { BrakeSet } from '../../physics/brakes';
import type { AxleDef } from '../../physics/types';
import type { CarDef } from '../shared/types';
import { profile } from './profile';
import { audiRs6Livery } from './livery';

/** RS6 Avant: wheelbase 2.928 m between the model's hubs; the front axle sits at z = 1.26 (front-engine AWD, ~57 % of the weight on the front). */
const AXLE_F = 1.26;
const AXLE_R = AXLE_F - 2.928;

/** Body dimensions (also what the hull is fitted from); wheel radius = front tyre overall radius (285/35 R21). */
const BODY = {
  length: 4.99,
  width: 1.95,
  height: 1.49,
  comHeight: 0.56,
  wheelRadius: 0.3665,
};

// Hubs of the model: front x +-0.823, rear x +-0.813 (the wheels are the game's own, with the model's rim, centred on them).
const FRONT: AxleDef = {
  z: AXLE_F,
  track: 1.646,
  spring: 56000,
  bump: 4200,
  rebound: 6700,
  travel: 0.2,
  antiRoll: 15000,
  handbrakeTorque: 0,
  steer: 1,
  grip: 1.05,
  forceHeight: 0.4,
};

const REAR: AxleDef = {
  z: AXLE_R,
  track: 1.626,
  spring: 50000,
  bump: 3800,
  rebound: 6000,
  travel: 0.2,
  antiRoll: 9000,
  handbrakeTorque: 2800,
  steer: 0,
  grip: 1.1,
  forceHeight: 0.4,
};

/** RS6 brakes: 400 mm vented front, 370 mm vented rear steel discs, sport pads, ~34 m from 100 km/h on tarmac (PHYSICS.md "Brakes"). */
const BRAKES: BrakeSet = {
  front: {
    type: 'vented',
    diameter: 0.4,
    thickness: 0.038,
    pad: 'sport',
    clamp: 22000,
  },
  rear: {
    type: 'vented',
    diameter: 0.37,
    thickness: 0.03,
    pad: 'sport',
    clamp: 11800,
  },
};

/**
 * Audi RS6 (`audi_rs6`) - the C8 RS6 Avant: a CC BY Sketchfab model kept as it is (own cockpit, lamps and rim, flat paint),
 * mapped to game parts by material (model.source.json). Test car (release.ts).
 */
export const audiRs6: CarDef = {
  id: 'audi_rs6',
  name: 'Audi RS6',
  className: 'Performance estate · AWD V8',
  description:
    'A 600 hp estate: twin-turbo 4.0 litre V8, eight-speed automatic and permanent four-wheel drive. Very quick in a straight line, heavy to turn: brake early and let the quattro pull you out.',
  sources: [
    {
      label: '"Audi RS 6 Avant (C8)" by Mona x Supercars (Sketchfab)',
      url: 'https://sketchfab.com/3d-models/audi-rs-6-avant-c8-99aa71f747b0453eb58334414d34397c',
      note: 'imported body, cockpit, lamps and rim (converted + repainted), CC BY 4.0',
    },
  ],
  // Night headlights: matrix LED.
  headlights: {
    power: 1.7,
    color: 0xeef4ff,
    angle: 0.36,
    penumbra: 0.3,
    spill: 0.22,
  },
  // 4.0 litre twin-turbo V8 on a sports exhaust, eight-speed torque-converter automatic.
  sound: {
    layout: 'v8',
    displacement: 4,
    exhaust: 0.55,
    intake: 0.35,
    turbo: { antiLag: false },
    pops: 0.35,
    gearWhine: 0.1,
    gearbox: 'sequential',
    cam: 0.1,
  },
  physics: {
    mass: 2075, // kerb weight, DIN
    ...BODY,
    inertiaScale: 1,
    wheelWidth: 0.285,
    // 285/35 R21 on tarmac; the mixed and gravel compounds run a taller sidewall.
    tyres: {
      size: { width: 0.285, aspect: 35, rim: 21 },
      byCompound: {
        mixed: { width: 0.275, aspect: 45, rim: 20 },
        gravel: { width: 0.245, aspect: 55, rim: 19 },
      },
    },
    wheelInertia: 2.4,
    maxSteerDeg: 30,
    front: FRONT,
    rear: REAR,
    setup: 'soft',
    setups: deriveSetups(
      { front: FRONT, rear: REAR },
      {
        soft: { front: 56000, rear: 50000, travel: 0.2, ride: 0.02 },
        medium: { front: 74000, rear: 66000, travel: 0.17, ride: 0.005 },
        stiff: { front: 96000, rear: 86000, travel: 0.14, ride: -0.01 },
      },
    ),
    engine: {
      // 4.0 TFSI twin-turbo V8: 800 Nm from 2050 to 4500 rpm, 441 kW (600 hp) at 6000 - 6250.
      torqueCurve: [
        [1000, 420],
        [1500, 640],
        [2000, 780],
        [2500, 800],
        [4500, 800],
        [5000, 770],
        [5500, 735],
        [6000, 700],
        [6250, 675],
        [6800, 590],
        [7000, 520],
      ],
      idleRpm: 750,
      redlineRpm: 6800,
      inertia: 0.3,
      engineBrake: 70,
      launchRpm: 3600,
    },
    gearbox: {
      ratios: [4.714, 3.143, 2.106, 1.667, 1.285, 1.2, 1.1, 1.02],
      reverse: 3.317,
      finalDrive: 3.2,
      shiftTime: 0.15,
      efficiency: 0.88,
      upshiftRpm: 6400,
      downshiftRpm: 3400,
    },
    gearings: {
      short: { finalDrive: 3.6 },
      medium: { finalDrive: 3.2 },
      long: { finalDrive: 2.9 },
    },
    drivetrain: {
      // Torsen centre differential, 40 : 60 front : rear at rest.
      frontSplit: 0.4,
      centerLock: 160,
      frontDiffLock: 40,
      rearDiffLock: 120,
    },
    brakes: BRAKES,
    dragArea: 0.72,
    downforceArea: 0.05,
    hull: bodyHull(BODY, -0.28, [
      { x: [0, 0.5], z: 2.05, r: 0.16, bottom: 0.14 },
      { x: [0.72], z: 1.8, r: 0.22, bottom: 0.16 },
      { x: [0.72], z: 0.9, r: 0.22, bottom: 0.16 },
      { x: [0.72], z: 0, r: 0.22, bottom: 0.17 },
      { x: [0.72], z: -0.9, r: 0.22, bottom: 0.17 },
      { x: [0], z: -0.4, r: 0.22, bottom: 0.17 },
      { x: [0.72], z: -1.8, r: 0.22, bottom: 0.17 },
      { x: [0, 0.45], z: -2.35, r: 0.2, bottom: 0.2 },
    ]),
  },
  model: {
    // The model's own paint (flat Nardo-style grey).
    paint: '#5c5f63',
    // The model's own rim (audi_rs6_wheel.glb), de-cambered and centred on the hub.
    rim: { color: '#9a9ea4', spokes: 5, style: 'spoke', caliper: '#b3201f' },
    wheelModel: 'audi_rs6_wheel.glb',
    suspensionStyle: 'estate',
    cornerSuspension: {
      style: 'road',
      front: 'wishbone',
      rear: 'wishbone',
      topY: { front: 0.52, rear: 0.5 },
      topIn: { front: 0.28, rear: 0.28 },
      driven: ['front', 'rear'],
    },
    // The model carries its own cockpit: see-through glass shows it.
    glass: { color: 0x141c24, opacity: 0.6 },
    // Fallback body if the GLB can't load (and the street car of the city maps): profile.ts.
    profile,
    doorBadge: { z: 0.2, y: 0.7 },
    gltf: {
      file: 'audi_rs6.glb',
      credit:
        '"Audi RS 6 Avant (C8)" by Mona x Supercars, sketchfab.com/3d-models/audi-rs-6-avant-c8-99aa71f747b0453eb58334414d34397c, CC BY 4.0 (converted + repainted)',
      autoFit: false,
      atlas: audiRs6Livery,
    },
  },
};
