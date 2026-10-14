import { deriveSetups } from '../../physics/car-setup';
import { bodyHull } from '../../physics/hull';
import type { BrakeSet } from '../../physics/brakes';
import type { AxleDef } from '../../physics/types';
import type { CarDef } from '../shared/types';
import { profile } from './profile';
import { peugeot206Livery } from './livery';

/** Peugeot 206: wheelbase 2.443 m between the model's hubs; the front axle sits at z = 0.95 (front-engine FWD, ~61 % of the weight on the front). */
const AXLE_F = 0.95;
const AXLE_R = AXLE_F - 2.443;

/** Body dimensions (also what the hull is fitted from); wheel radius = front tyre overall radius (215/45 R17). */
const BODY = {
  length: 3.8,
  width: 1.86,
  height: 1.45,
  comHeight: 0.5,
  wheelRadius: 0.3127,
};

// Hubs of the model: front x +-0.716, rear x +-0.706 (the wheels are the game's own, with the model's rim, centred on them).
const FRONT: AxleDef = {
  z: AXLE_F,
  track: 1.431,
  spring: 30000,
  bump: 2200,
  rebound: 3500,
  travel: 0.2,
  antiRoll: 8000,
  handbrakeTorque: 0,
  steer: 1,
  grip: 1,
  forceHeight: 0.33,
};

const REAR: AxleDef = {
  z: AXLE_R,
  track: 1.412,
  spring: 24000,
  bump: 1750,
  rebound: 2800,
  travel: 0.2,
  antiRoll: 5000,
  handbrakeTorque: 2400,
  steer: 0,
  grip: 1.05,
  forceHeight: 0.33,
};

/** 206 GTi brakes: 283 mm vented front, 247 mm solid rear discs, road pads (PHYSICS.md "Brakes"). */
const BRAKES: BrakeSet = {
  front: {
    type: 'vented',
    diameter: 0.283,
    thickness: 0.026,
    pad: 'road',
    clamp: 10500,
  },
  rear: {
    type: 'solid',
    diameter: 0.247,
    thickness: 0.009,
    pad: 'road',
    clamp: 3400,
  },
};

/**
 * Peugeot 206 (`peugeot_206`) - a tuned widebody 206 GTi: a CC BY Sketchfab model kept as it is (own cockpit, lamps and rim,
 * flat paint), mapped to game parts by material only (model.source.json). Test car (release.ts).
 */
export const peugeot206: CarDef = {
  id: 'peugeot_206',
  name: 'Peugeot 206',
  className: 'Hot hatch · FWD',
  description:
    'Tuned 206 GTi: a light, short-wheelbase FWD hatch with a 2.0 litre four. Lift to rotate it, keep the revs up and use the handbrake.',
  sources: [
    {
      label: '"Peugeot 206" by Alvier (Sketchfab)',
      url: 'https://sketchfab.com/3d-models/peugeot-206-dc25a117378545e7a804c8594aa86938',
      note: 'imported body, cockpit, lamps and rim (converted + repainted), CC BY 4.0',
    },
  ],
  // 2.0 litre 16V four on a sports exhaust, naturally aspirated, 5-speed manual.
  sound: {
    layout: 'i4',
    displacement: 2.0,
    exhaust: 0.4,
    intake: 0.5,
    pops: 0.15,
    gearWhine: 0.2,
    gearbox: 'manual',
    cam: 0.25,
  },
  physics: {
    mass: 1100,
    ...BODY,
    inertiaScale: 0.9,
    wheelWidth: 0.215,
    // 215/45 R17 on tarmac, the same width on 15" for gravel.
    tyres: {
      size: { width: 0.215, aspect: 45, rim: 17 },
      byCompound: {
        mixed: { width: 0.205, aspect: 55, rim: 16 },
        gravel: { width: 0.195, aspect: 65, rim: 15 },
      },
    },
    wheelInertia: 1.0,
    maxSteerDeg: 32,
    front: FRONT,
    rear: REAR,
    setup: 'soft',
    setups: deriveSetups(
      { front: FRONT, rear: REAR },
      {
        soft: { front: 30000, rear: 24000, travel: 0.2, ride: 0.015 },
        medium: { front: 42000, rear: 33000, travel: 0.17, ride: 0 },
        stiff: { front: 56000, rear: 44000, travel: 0.14, ride: -0.012 },
      },
    ),
    engine: {
      // 2.0 16V (GTi 180): ~202 Nm at 4750, ~132 kW (180 hp) at 6900.
      torqueCurve: [
        [1000, 120],
        [2000, 160],
        [3000, 182],
        [4000, 196],
        [4750, 202],
        [5500, 200],
        [6200, 192],
        [6900, 183],
        [7300, 160],
      ],
      idleRpm: 900,
      redlineRpm: 7200,
      inertia: 0.14,
      engineBrake: 50,
      launchRpm: 4500,
    },
    gearbox: {
      ratios: [3.58, 2.05, 1.43, 1.07, 0.92],
      reverse: 3.5,
      finalDrive: 4.3,
      shiftTime: 0.2,
      efficiency: 0.9,
      upshiftRpm: 6900,
      downshiftRpm: 4200,
    },
    // 5th is short enough that medium is rev-limited: the power peak is at 6900 rpm, so a longer drive alone would not go faster.
    gearings: {
      short: { finalDrive: 4.9 },
      medium: { finalDrive: 4.3 },
      long: { finalDrive: 4.15 },
    },
    drivetrain: {
      frontSplit: 1,
      centerLock: 0,
      frontDiffLock: 90,
      rearDiffLock: 0,
    },
    brakes: BRAKES,
    dragArea: 0.75,
    downforceArea: 0.05,
    // Fitted to peugeot_206.glb (tests/rally/hull-fit.test.ts prints the model's underside per zone): splitter 0.11 m, front
    // lip 0.15, sills 0.2, floor 0.25, rear valance 0.25 m above the ground; the body spans z = -2.09 .. 1.72.
    hull: bodyHull(BODY, -0.185, [
      { x: [0, 0.5], z: 1.58, r: 0.16, bottom: 0.11 },
      { x: [0.72], z: 1.35, r: 0.2, bottom: 0.15 },
      { x: [0.72], z: 0.4, r: 0.22, bottom: 0.2 },
      { x: [0.72], z: -0.2, r: 0.22, bottom: 0.215 },
      { x: [0.72], z: -0.8, r: 0.22, bottom: 0.24 },
      { x: [0], z: 0, r: 0.22, bottom: 0.255 },
      { x: [0, 0.45], z: -1.9, r: 0.2, bottom: 0.25 },
    ]),
  },
  model: {
    paint: '#b3201f',
    // The model's own 5-spoke rim (peugeot_206_wheel.glb), de-cambered and centred on the hub.
    rim: { color: '#b9bcc2', spokes: 5, style: 'spoke' },
    wheelModel: 'peugeot_206_wheel.glb',
    suspensionStyle: 'hatch',
    cornerSuspension: {
      style: 'road',
      front: 'strut',
      rear: 'axle',
      topY: { front: 0.4, rear: 0.34 },
      topIn: { front: 0.2, rear: 0.2 },
      driven: ['front'],
    },
    // The model carries its own cockpit: see-through glass shows it.
    glass: { color: 0x141c24, opacity: 0.6 },
    // Fallback body if the GLB can't load (and the street car of the city maps): profile.ts.
    profile,
    doorBadge: { z: 0.1, y: 0.62 },
    gltf: {
      file: 'peugeot_206.glb',
      credit:
        '"Peugeot 206" by Alvier, sketchfab.com/3d-models/peugeot-206-dc25a117378545e7a804c8594aa86938, CC BY 4.0 (converted + repainted)',
      autoFit: false,
      atlas: peugeot206Livery,
    },
  },
};
