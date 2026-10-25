import { deriveSetups } from '../../physics/car-setup';
import { bodyHull } from '../../physics/hull';
import type { BrakeSet } from '../../physics/brakes';
import type { AxleDef } from '../../physics/types';
import type { CarDef } from '../shared/types';
import { profile } from './profile';
import { porscheLivery } from './livery';

/** 911 Turbo (930): wheelbase 2.272 m; the engine hangs behind the rear axle (~61 % of the weight on it), so the front axle sits at z = 1.386. */
const AXLE_F = 1.386;
const AXLE_R = AXLE_F - 2.272;

/** Period road tyre against a rally competition tyre (PHYSICS.md "Tyre types"). */
const ROAD_TYRE = 0.8;
/** Mass of the car these suspension numbers were tuned on (kg); the 930 weighs about 1,195 kg. */
const TUNED_MASS = 1180;
const MASS = 1195;
const scale = (n: number): number => Math.round((n * MASS) / TUNED_MASS);

/** Body dimensions (also what the hull is fitted from); wheel radius = tyre overall radius (185/70 R15 front, 215/60 R15 rear). */
const BODY = {
  length: 4.28,
  width: 1.77,
  height: 1.32,
  comHeight: 0.46,
  wheelRadius: 0.32,
};

// Hubs of the model: front x +-0.715, rear x +-0.727 (the wheels are the game's own, with the model's rim, centred on them).
const FRONT: AxleDef = {
  z: AXLE_F,
  track: 1.43,
  spring: scale(78000),
  bump: scale(3680),
  rebound: scale(6620),
  travel: 0.14,
  antiRoll: scale(23833),
  handbrakeTorque: 0,
  steer: 1,
  grip: 1.15, // only 39 % of the weight is on the narrow front tyres: at 1.1 it pushed wide
  forceHeight: 0.3,
};

const REAR: AxleDef = {
  z: AXLE_R,
  track: 1.455,
  spring: scale(70000),
  bump: scale(3402),
  rebound: scale(6120),
  travel: 0.14,
  antiRoll: scale(15312),
  handbrakeTorque: 3000,
  steer: 0,
  grip: 1.25,
  forceHeight: 0.3,
};

/** 930 brakes: cross-drilled vented iron discs, fixed four-piston calipers, road pads (PHYSICS.md "Brakes"). */
const BRAKES: BrakeSet = {
  front: {
    type: 'vented',
    diameter: 0.282,
    thickness: 0.028,
    pad: 'road',
    clamp: 15000,
  },
  rear: {
    type: 'vented',
    diameter: 0.29,
    thickness: 0.024,
    pad: 'road',
    clamp: 9000,
  },
};

/**
 * Porsche 911 (930) (`porsche_911_930`) - the 1975 911 Turbo: a CC BY Sketchfab model kept as it is (flat paint, own lamps
 * and rim, no interior: tinted glass), mapped to game parts by material only (model.source.json). Test car (release.ts).
 */
export const porsche911930: CarDef = {
  id: 'porsche_911_930',
  name: 'Porsche 911 (930)',
  className: 'GT · RWD Turbo',
  description:
    'The 1975 911 Turbo: a 3.0 litre turbocharged flat-six hanging behind the rear axle, four gears and period road tyres. Light at the front, so it points in fast and punishes a lift.',
  sources: [
    {
      label: '"Porsche 911 (930) Turbo 1975" by Lexyc16 (Sketchfab)',
      url: 'https://sketchfab.com/3d-models/porsche-911-930-turbo-1975-de1ffd344c41481892511f7fd332c136',
      note: 'imported body, lamps and rim (converted + repainted), CC BY 4.0',
    },
    {
      label: 'Porsche Classic - 911 Turbo (G model)',
      url: 'https://www.porsche.com/usa/accessoriesandservice/classic/models/911-g/911-turbo/',
      note: 'specification reference (3.0 l, 260 PS)',
    },
  ],
  // Night headlights: 70s-80s halogen.
  headlights: {
    power: 0.65,
    color: 0xffdba4,
    angle: 0.48,
    penumbra: 0.8,
    spill: 0.26,
  },
  // 3.0 l turbo flat-six (an inline six fires the same even pattern), road silencer, manual box.
  sound: {
    layout: 'i6',
    displacement: 3,
    exhaust: 0.35,
    intake: 0.3,
    turbo: { antiLag: false },
    pops: 0.15,
    gearWhine: 0.5,
    gearbox: 'manual',
    cam: 0.1,
  },
  physics: {
    mass: MASS, // 1975 911 Turbo kerb weight
    ...BODY,
    inertiaScale: 1,
    hardBumpStop: true,
    wheelWidth: 0.2,
    // 185/70 VR15 front, 215/60 VR15 rear (the 1975 Turbo's fitment); rally compounds keep the taller rear, gravel runs one narrow size.
    tyres: {
      size: { width: 0.185, aspect: 70, rim: 15, grade: ROAD_TYRE },
      byCompound: { gravel: { width: 0.185, aspect: 70, rim: 15 } },
      rear: {
        size: { width: 0.215, aspect: 60, rim: 15, grade: ROAD_TYRE },
        byCompound: {
          mixed: { width: 0.205, aspect: 65, rim: 15 },
          gravel: { width: 0.195, aspect: 65, rim: 15 },
        },
      },
    },
    wheelInertia: 1.2,
    maxSteerDeg: 32,
    front: FRONT,
    rear: REAR,
    setup: 'stiff',
    setups: deriveSetups(
      { front: FRONT, rear: REAR },
      {
        soft: {
          front: scale(47000),
          rear: scale(42000),
          travel: 0.17,
          ride: 0.035,
        },
        medium: {
          front: scale(62000),
          rear: scale(55000),
          travel: 0.16,
          ride: 0.015,
        },
        stiff: {
          front: scale(78000),
          rear: scale(70000),
          travel: 0.14,
          ride: 0,
        },
      },
    ),
    engine: {
      // 3.0 l turbo flat-six: 343 Nm at 4000 rpm, 191 kW (260 hp) at 5500; weak below 2500 rpm (turbo lag as a thin low end).
      torqueCurve: [
        [1000, 140],
        [2000, 190],
        [2500, 250],
        [3000, 310],
        [4000, 343],
        [5000, 336],
        [5500, 332],
        [6000, 305],
        [6500, 260],
      ],
      idleRpm: 950,
      redlineRpm: 6500,
      inertia: 0.2,
      engineBrake: 60,
      launchRpm: 4000,
    },
    gearbox: {
      ratios: [3.18, 1.83, 1.26, 0.93],
      reverse: 3.25,
      finalDrive: 3.44, // 4th gear tops out near the redline: ~245 km/h
      shiftTime: 0.2,
      efficiency: 0.9,
      upshiftRpm: 6200,
      downshiftRpm: 3200,
    },
    gearings: {
      short: { finalDrive: 3.9 },
      medium: { finalDrive: 3.44 },
      long: { finalDrive: 3.1 },
    },
    drivetrain: {
      frontSplit: 0,
      centerLock: 0,
      frontDiffLock: 0,
      rearDiffLock: 0,
    },
    brakes: BRAKES,
    dragArea: 0.62,
    downforceArea: 0.1,
    // Fitted to porsche_911_930.glb (tests/rally/hull-fit.test.ts prints the model's underside per zone).
    hull: bodyHull(BODY, 0.16, [
      { x: [0, 0.5], z: 2.14, r: 0.16, bottom: 0.16 },
      { x: [0.72], z: 1.4, r: 0.22, bottom: 0.16 },
      { x: [0.72], z: 0.4, r: 0.22, bottom: 0.16 },
      { x: [0.72], z: -0.4, r: 0.22, bottom: 0.17 },
      { x: [0.72], z: -1.2, r: 0.22, bottom: 0.17 },
      { x: [0, 0.45], z: -1.78, r: 0.2, bottom: 0.17 },
    ]),
  },
  model: {
    paint: '#ffc800',
    // The model's own five-spoke rim (porsche_911_930_wheel.glb), de-cambered and centred on the hub.
    rim: { color: '#c9ccd0', spokes: 5, style: 'spoke', caliper: false },
    wheelModel: 'porsche_911_930_wheel.glb',
    suspensionStyle: 'classic',
    cornerSuspension: {
      style: 'classic',
      front: 'strut',
      rear: 'wishbone',
      topY: { front: 0.42, rear: 0.38 },
      topIn: { front: 0.2, rear: 0.22 },
      driven: ['rear'],
    },
    // Fallback body if the GLB can't load (and the street car of the city maps): profile.ts.
    profile,
    // Door plate by the rule (scripts/car-model/door-plate.py).
    doorBadge: { z: 0.37, y: 0.6 },
    gltf: {
      file: 'porsche_911_930.glb',
      credit:
        '"Porsche 911 (930) Turbo 1975" by Lexyc16, sketchfab.com/3d-models/porsche-911-930-turbo-1975-de1ffd344c41481892511f7fd332c136, CC BY 4.0 (converted + repainted)',
      autoFit: false,
      atlas: porscheLivery,
    },
  },
};
