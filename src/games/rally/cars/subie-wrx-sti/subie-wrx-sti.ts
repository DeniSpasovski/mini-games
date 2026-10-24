import { deriveSetups } from '../../physics/car-setup';
import { bodyHull } from '../../physics/hull';
import type { BrakeSet } from '../../physics/brakes';
import type { AxleDef } from '../../physics/types';
import type { CarDef } from '../shared/types';
import { profile } from './profile';
import { subieWrxStiLivery } from './livery';

/** WRX STI: wheelbase 2.647 m between the model's hubs; the front axle sits at z = 1.09 (front-engine AWD, ~59 % of the weight on the front). */
const AXLE_F = 1.09;
const AXLE_R = AXLE_F - 2.647;

/** Body dimensions (also what the hull is fitted from); wheel radius = tyre overall radius (245/40 R18). */
const BODY = {
  length: 4.6,
  width: 1.9,
  height: 1.47,
  comHeight: 0.52,
  wheelRadius: 0.3266,
};

// Hubs of the model: front x +-0.797, rear x +-0.790 (the wheels are the game's own, with the model's rim, centred on them).
const FRONT: AxleDef = {
  z: AXLE_F,
  track: 1.594,
  spring: 46000,
  bump: 3150,
  rebound: 5660,
  travel: 0.2,
  antiRoll: 11000,
  handbrakeTorque: 0,
  steer: 1,
  grip: 1,
  forceHeight: 0.3,
};

const REAR: AxleDef = {
  z: AXLE_R,
  track: 1.58,
  spring: 40000,
  bump: 2800,
  rebound: 5000,
  travel: 0.2,
  antiRoll: 8000,
  handbrakeTorque: 2800,
  steer: 0,
  grip: 1.03,
  forceHeight: 0.3,
};

/** WRX STI brakes: 326 mm vented front, 316 mm vented rear, sport pads (PHYSICS.md "Brakes"). */
const BRAKES: BrakeSet = {
  front: {
    type: 'vented',
    diameter: 0.326,
    thickness: 0.03,
    pad: 'sport',
    clamp: 15000,
  },
  rear: {
    type: 'vented',
    diameter: 0.316,
    thickness: 0.02,
    pad: 'sport',
    clamp: 8000,
  },
};

/**
 * Subaru WRX STI (`subie_wrx_sti`) - the 2019 STI: a CC BY Sketchfab model kept as it is (own cockpit, lamps and rim, flat
 * paint), mapped to game parts by material (model.source.json).
 */
export const subieWrxSti: CarDef = {
  id: 'subie_wrx_sti',
  name: 'Subaru WRX STI',
  className: 'Sport saloon · AWD Turbo',
  description:
    'A modern rally-bred saloon: 2.5 litre turbo flat-four, six-speed box and driver-adjustable four-wheel drive. Planted and quick out of the corners, a little heavy on the nose.',
  sources: [
    {
      label: '"2019 Rowen Subaru WRX STI" by Car design (Sketchfab)',
      url: 'https://sketchfab.com/3d-models/2019-rowen-subaru-wrx-sti-dfd3b419f6c84f52920476549c403f17',
      note: 'imported body, cockpit, lamps and rim (converted + repainted), CC BY 4.0',
    },
    {
      label: 'Subaru - 2021 WRX brochure (PDF)',
      url: 'https://www.subaru.com/content/dam/subaru/downloads/pdf/brochures/2021/wrx/2021_WRX_Brochure.pdf',
      note: 'specification reference',
    },
  ],
  // Night headlights: HID / LED low beam.
  headlights: {
    power: 1.3,
    color: 0xf2f5ff,
    angle: 0.38,
    penumbra: 0.4,
    spill: 0.22,
  },
  // 2.5 litre turbo flat-four: the unequal-length headers' burble, a sports exhaust.
  sound: {
    layout: 'flat4',
    displacement: 2.5,
    exhaust: 0.7,
    intake: 0.4,
    turbo: { antiLag: false },
    pops: 0.3,
    gearWhine: 0.3,
    gearbox: 'manual',
    cam: 0.2,
  },
  physics: {
    mass: 1540, // 2019 kerb weight
    ...BODY,
    inertiaScale: 0.95,
    hardBumpStop: true,
    wheelWidth: 0.245,
    // 245/40 R18 on tarmac; the mixed and gravel compounds run a taller sidewall.
    tyres: {
      size: { width: 0.245, aspect: 40, rim: 18 },
      byCompound: {
        mixed: { width: 0.235, aspect: 45, rim: 17 },
        gravel: { width: 0.225, aspect: 55, rim: 16 },
      },
    },
    wheelInertia: 1.8,
    maxSteerDeg: 30,
    front: FRONT,
    rear: REAR,
    setup: 'medium',
    setups: deriveSetups(
      { front: FRONT, rear: REAR },
      {
        soft: { front: 36000, rear: 31000, travel: 0.23, ride: 0.03 },
        medium: { front: 46000, rear: 40000, travel: 0.2, ride: 0.01 },
        stiff: { front: 66000, rear: 58000, travel: 0.16, ride: -0.01 },
      },
    ),
    engine: {
      // 2.5 l turbo flat-four: 393 Nm at 4000 rpm, 227 kW (305 hp) at 6000; turbo lag below ~2500 rpm.
      torqueCurve: [
        [1000, 150],
        [2000, 240],
        [2500, 300],
        [3000, 360],
        [4000, 393],
        [5000, 385],
        [6000, 361],
        [6500, 330],
        [6800, 300],
      ],
      idleRpm: 850,
      redlineRpm: 6800,
      inertia: 0.22,
      engineBrake: 60,
      launchRpm: 4000,
    },
    gearbox: {
      ratios: [3.636, 2.235, 1.6, 1.25, 1.07, 0.95],
      reverse: 3.545,
      finalDrive: 3.9,
      shiftTime: 0.2,
      efficiency: 0.9,
      upshiftRpm: 6500,
      downshiftRpm: 3600,
    },
    gearings: {
      short: { finalDrive: 4.3 },
      medium: { finalDrive: 3.9 },
      long: { finalDrive: 3.5 },
    },
    drivetrain: {
      // Driver-controlled centre diff, 41 : 59 front : rear at rest, helical front and Torsen rear.
      frontSplit: 0.41,
      centerLock: 140,
      frontDiffLock: 50,
      rearDiffLock: 140,
    },
    brakes: BRAKES,
    dragArea: 0.82,
    downforceArea: 0.08,
    // Fitted to subie_wrx_sti.glb (tests/rally/hull-fit.test.ts prints the model's underside): side skirts 0.09 m, nose lip and
    // rear bumper 0.14 - 0.155 m.
    hull: bodyHull(BODY, -0.26, [
      { x: [0, 0.55], z: 1.95, r: 0.17, bottom: 0.14 },
      { x: [0], z: 1.2, r: 0.22, bottom: 0.13 },
      { x: [0.5], z: 0.6, r: 0.25, bottom: 0.11 },
      { x: [0.5], z: 0, r: 0.25, bottom: 0.11 },
      { x: [0.5], z: -0.8, r: 0.25, bottom: 0.11 },
      { x: [0], z: -1.4, r: 0.22, bottom: 0.13 },
      { x: [0, 0.5], z: -2.2, r: 0.2, bottom: 0.17 },
    ]),
  },
  model: {
    // The model's own paint (flat rally blue).
    paint: '#2f67c9',
    // The model's own rim (subie_wrx_sti_wheel.glb), de-cambered and centred on the hub.
    rim: { color: '#2a2c30', spokes: 10, style: 'spoke', caliper: '#c1121f' },
    wheelModel: 'subie_wrx_sti_wheel.glb',
    suspensionStyle: 'wrx',
    cornerSuspension: {
      style: 'wrx',
      front: 'strut',
      rear: 'wishbone',
      topY: { front: 0.5, rear: 0.46 },
      topIn: { front: 0.26, rear: 0.28 },
      driven: ['front', 'rear'],
    },
    // The model carries its own cockpit: see-through glass shows it.
    glass: { color: 0x141c24, opacity: 0.6 },
    // Fallback body if the GLB can't load (and the street car of the city maps): profile.ts.
    profile,
    doorBadge: { z: 0.2, y: 0.66, tilt: 1.5 },
    gltf: {
      file: 'subie_wrx_sti.glb',
      credit:
        '"2019 Rowen Subaru WRX STI" by Car design, sketchfab.com/3d-models/2019-rowen-subaru-wrx-sti-dfd3b419f6c84f52920476549c403f17, CC BY 4.0 (converted + repainted)',
      autoFit: false,
      atlas: subieWrxStiLivery,
      metallic: true,
    },
  },
};
