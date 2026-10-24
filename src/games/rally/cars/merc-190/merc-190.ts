import { deriveSetups } from '../../physics/car-setup';
import { bodyHull } from '../../physics/hull';
import type { BrakeSet } from '../../physics/brakes';
import type { AxleDef } from '../../physics/types';
import type { CarDef } from '../shared/types';
import { profile } from './profile';
import { merc190Livery } from './livery';

/** 190E: wheelbase 2.672 m between the model's hubs; the front axle sits at z = 1.229 (front engine, ~54 % of the weight on the front). */
const AXLE_F = 1.229;
const AXLE_R = AXLE_F - 2.672;

/** Summer road tyre against a rally competition tyre (PHYSICS.md "Tyre types"). */
const ROAD_TYRE = 0.82;

/** Body dimensions (also what the hull is fitted from); wheel radius = front tyre overall radius. */
const BODY = {
  length: 4.43,
  width: 1.9, // body 1.72 + the mirrors (the boxy profile is baked from the whole GLB)
  height: 1.37,
  comHeight: 0.5,
  // Reference radius (the model's hubs); 215/40 R18 front, 225/40 R18 rear (rear 1.3 cm taller).
  wheelRadius: 0.3146,
};

// Hubs of the model: x +-0.733 front and rear (the wheels are the game's own, with the model's rim, centred on them).
const FRONT: AxleDef = {
  z: AXLE_F,
  track: 1.467,
  spring: 48000,
  bump: 2900,
  rebound: 5200,
  travel: 0.16,
  antiRoll: 12000,
  handbrakeTorque: 0,
  steer: 1,
  grip: 1.1,
  forceHeight: 0.3,
};

const REAR: AxleDef = {
  z: AXLE_R,
  track: 1.467,
  spring: 42000,
  bump: 2600,
  rebound: 4700,
  travel: 0.16,
  antiRoll: 8000,
  handbrakeTorque: 3000,
  steer: 0,
  grip: 1.25,
  forceHeight: 0.3,
};

/** 190E 2.5-16 brakes: vented discs front, solid discs rear, sport pads (PHYSICS.md "Brakes"). */
const BRAKES: BrakeSet = {
  front: {
    type: 'vented',
    diameter: 0.3,
    thickness: 0.028,
    pad: 'sport',
    clamp: 9500,
  },
  rear: {
    type: 'solid',
    diameter: 0.27,
    thickness: 0.012,
    pad: 'sport',
    clamp: 5200,
  },
};

/**
 * Mercedes 190E (`merc_190`) - the 2.5-16 Evolution homologation saloon: a CC BY Sketchfab model kept as it is (flat paint, own
 * cockpit, lamps and rim), mapped to game parts by material only (model.source.json); its badges are removed.
 */
export const merc190: CarDef = {
  id: 'merc_190',
  name: 'Mercedes 190E',
  className: 'Group A · RWD saloon',
  description:
    'Compact 1980s saloon in its 2.5-16 Evolution form: a 2.5 litre sixteen-valve four up front, a five-speed box and rear-wheel drive, with the wide arches and low stance of the touring-car racer.',
  sources: [
    {
      label:
        '"Mercedes 190E EVO 1982 3D Model Free" by Betier Models (Sketchfab)',
      url: 'https://sketchfab.com/3d-models/mercedes-190e-evo-1982-3d-model-free-15e5576f4b724f2db357165caed3492b',
      note: 'imported body, cockpit, lamps and rim (converted + repainted, badges removed), CC BY 4.0',
    },
    {
      label: 'MotorTrend - 1990 Mercedes-Benz 190E 2.5-16 Evolution II history',
      url: 'https://www.motortrend.com/features/1990-mercedes-benz-190e-2-5-16-evolution-ii-history',
      note: 'specification reference',
    },
  ],
  // Night headlights: 80s halogen.
  headlights: {
    power: 0.7,
    color: 0xffe0ac,
    angle: 0.46,
    penumbra: 0.75,
    spill: 0.26,
  },
  // 2.5 l sixteen-valve four, sports exhaust, five-speed dog-leg box.
  sound: {
    layout: 'i4',
    displacement: 2.5,
    exhaust: 0.7,
    intake: 0.45,
    pops: 0.3,
    gearWhine: 0.8,
    gearbox: 'manual',
    cam: 0.45,
  },
  physics: {
    mass: 1340, // 2.5-16 Evolution kerb weight (estimated)
    ...BODY,
    inertiaScale: 0.9,
    wheelWidth: 0.215,
    // Road tyres 215/40 R18 front, 225/40 R18 rear (the model's 18 inch rim); rally compounds as the Lancer, gravel runs one size.
    tyres: {
      size: { width: 0.215, aspect: 40, rim: 18, grade: ROAD_TYRE },
      byCompound: {
        mixed: { width: 0.215, aspect: 45, rim: 17 },
        gravel: { width: 0.205, aspect: 60, rim: 15 },
      },
      rear: {
        size: { width: 0.225, aspect: 40, rim: 18, grade: ROAD_TYRE },
        byCompound: {
          mixed: { width: 0.215, aspect: 45, rim: 17 },
          gravel: { width: 0.205, aspect: 60, rim: 15 },
        },
      },
    },
    wheelInertia: 1.3,
    maxSteerDeg: 30,
    front: FRONT,
    rear: REAR,
    setup: 'medium',
    setups: deriveSetups(
      { front: FRONT, rear: REAR },
      {
        soft: { front: 34000, rear: 30000, travel: 0.2, ride: 0.03 },
        medium: { front: 48000, rear: 42000, travel: 0.16, ride: 0.012 },
        stiff: { front: 66000, rear: 58000, travel: 0.13, ride: 0 },
      },
    ),
    engine: {
      // 2.5 l NA four (Evolution II class): ~245 Nm at 5000, ~173 kW (235 hp) at 7200.
      torqueCurve: [
        [1000, 150],
        [2000, 195],
        [3000, 225],
        [4000, 228],
        [5000, 245],
        [6000, 242],
        [7000, 232],
        [7500, 205],
      ],
      idleRpm: 950,
      redlineRpm: 7500,
      inertia: 0.16,
      engineBrake: 55,
      launchRpm: 4500,
    },
    gearbox: {
      ratios: [4.0, 2.35, 1.6, 1.22, 0.95],
      reverse: 3.4,
      finalDrive: 3.9,
      shiftTime: 0.2,
      efficiency: 0.9,
      upshiftRpm: 7100,
      downshiftRpm: 4200,
    },
    gearings: {
      short: { finalDrive: 4.4 },
      medium: { finalDrive: 3.9 },
      long: { finalDrive: 3.8 },
    },
    drivetrain: {
      frontSplit: 0,
      centerLock: 0,
      frontDiffLock: 0,
      rearDiffLock: 120,
    },
    brakes: BRAKES,
    dragArea: 0.62,
    downforceArea: 0.1,
    // Fitted to merc_190.glb (tests/rally/hull-fit.test.ts prints the model's underside per zone).
    hull: bodyHull(BODY, -0.24, [
      { x: [0, 0.5], z: 1.8, r: 0.16, bottom: 0.14 },
      { x: [0.6], z: 1.2, r: 0.2, bottom: 0.115 },
      { x: [0.6], z: 0, r: 0.22, bottom: 0.115 },
      { x: [0], z: 0.3, r: 0.22, bottom: 0.115 },
      { x: [0.6], z: -1.2, r: 0.22, bottom: 0.115 },
      { x: [0, 0.5], z: -2.1, r: 0.2, bottom: 0.185 },
    ]),
  },
  model: {
    paint: '#2a2d33',
    // The model's own rim (merc_190_wheel.glb), de-cambered and centred on the hub, hub-cap badge flattened.
    rim: { color: '#3a3d42', spokes: 6, style: 'spoke', caliper: '#8a8f96' },
    wheelModel: 'merc_190_wheel.glb',
    suspensionStyle: 'saloon',
    cornerSuspension: {
      style: 'saloon',
      front: 'strut',
      rear: 'wishbone',
      topY: { front: 0.4, rear: 0.36 },
      topIn: { front: 0.2, rear: 0.22 },
      driven: ['rear'],
    },
    // The model carries its own cockpit: see-through glass shows it.
    glass: { color: 0x141c24, opacity: 0.6 },
    // Fallback body if the GLB can't load (and the street car of the city maps): profile.ts.
    profile,
    doorBadge: { z: 0.1, y: 0.55 },
    gltf: {
      file: 'merc_190.glb',
      credit:
        '"Mercedes 190E EVO 1982 3D Model Free" by Betier Models, sketchfab.com/3d-models/mercedes-190e-evo-1982-3d-model-free-15e5576f4b724f2db357165caed3492b, CC BY 4.0 (converted + repainted, badges removed)',
      autoFit: false,
      atlas: merc190Livery,
      headBowls: true,
      // The low and high beam bulbs in the reflector (measured on the model).
      headBulbs: [
        [0.41, 0.56, 1.69],
        [0.585, 0.565, 1.67],
      ],
    },
  },
};
