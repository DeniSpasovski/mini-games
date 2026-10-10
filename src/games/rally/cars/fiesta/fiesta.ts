import { deriveSetups } from '../../physics/car-setup';
import { bodyHull } from '../../physics/hull';
import type { AxleDef } from '../../physics/types';
import type { CarDef } from '../shared/types';
import { profile } from './profile';
import { fiestaLivery } from './livery';

/** WRC Fiesta (2017-): wheelbase 2.48 m between the model's hubs; the front axle sits at z = 1.2 (centre of mass behind it). */
const AXLE_F = 1.2;
const AXLE_R = AXLE_F - 2.48;

/** Body dimensions (also what the hull is fitted from); wheel radius = tyre overall radius. */
const BODY = {
  length: 4.08,
  width: 1.92,
  height: 1.4,
  comHeight: 0.5,
  wheelRadius: 0.325,
};

// Hubs of the model: front x +-0.834, rear x +-0.824 (the wheels are the game's own, centred on them).
const FRONT: AxleDef = {
  z: AXLE_F,
  track: 1.668,
  spring: 34000,
  bump: 2400,
  rebound: 4320,
  travel: 0.26,
  antiRoll: 9000,
  brakeTorque: 1750,
  handbrakeTorque: 0,
  steer: 1,
  grip: 1,
  forceHeight: 0.3,
};

const REAR: AxleDef = {
  z: AXLE_R,
  track: 1.648,
  spring: 29000,
  bump: 2100,
  rebound: 3780,
  travel: 0.26,
  antiRoll: 6000,
  brakeTorque: 750,
  handbrakeTorque: 2800,
  steer: 0,
  grip: 1,
  forceHeight: 0.3,
};

/**
 * Fiesta WRC (`fiesta`) - a 2017-spec World Rally Car: the imported CC BY "Ford Fiesta WRC" body with its own cockpit
 * (seats, dash, cage - visible through the glass), converted by glb-to-parts-stl.py + stl-to-glb.mjs (model.source.json)
 * and painted at runtime (livery.ts). Its own rim, centred on the hub (glb-rim-extract.py). Released (release.ts).
 */
export const fiesta: CarDef = {
  id: 'fiesta',
  name: 'Fiesta WRC',
  className: 'WRC · AWD turbo',
  description:
    'World Rally Car of the 2017 rules: 1.6 turbo, 6-speed sequential, active diffs, wide arches, big wing. Short and wide, it turns in like nothing else.',
  sources: [
    {
      label: '"Ford Fiesta WRC" by kevin (Sketchfab)',
      url: 'https://sketchfab.com/3d-models/ford-fiesta-wrc-8b3f0c6876c74c0480ca04e698582db3',
      note: 'imported body, cockpit and rim (converted + repainted), CC BY 4.0',
    },
    {
      label: 'WRC.com - M-Sport Ford Fiesta WRC',
      url: 'https://www.wrc.com/en/misc/m-sport-ford-fiesta-wrc',
      note: 'specification reference',
    },
    {
      label: 'Racecar Engineering - Ford Fiesta WRC',
      url: 'https://www.racecar-engineering.com/cars/ford-fiesta-wrc/',
      note: 'specification reference',
    },
  ],
  // 1.6 turbo four, open rally exhaust, anti-lag, sequential box.
  sound: {
    layout: 'i4',
    displacement: 1.6,
    exhaust: 0.9,
    intake: 0.4,
    turbo: { antiLag: true },
    pops: 0.6,
    gearWhine: 0.9,
    gearbox: 'sequential',
    cam: 0.3,
  },
  physics: {
    mass: 1190, // WRC minimum weight (2017 rules)
    ...BODY,
    inertiaScale: 0.9,
    wheelWidth: 0.235,
    tyres: {
      size: { width: 0.235, aspect: 40, rim: 18 },
      byCompound: { gravel: { width: 0.215, aspect: 65, rim: 15 } },
    },
    wheelInertia: 1.4,
    maxSteerDeg: 30,
    front: FRONT,
    rear: REAR,
    setup: 'soft',
    setups: deriveSetups(
      { front: FRONT, rear: REAR },
      {
        soft: { front: 34000, rear: 29000, travel: 0.26, ride: 0.03 },
        medium: { front: 59000, rear: 48000, travel: 0.2, ride: 0 },
        stiff: { front: 98000, rear: 79000, travel: 0.15, ride: -0.02 },
      },
    ),
    engine: {
      // WRC level (1.6 turbo, 36 mm restrictor): 450 Nm at 5000, 283 kW (380 hp) at 6000 - a notch above the R5.
      torqueCurve: [
        [1000, 200],
        [2000, 320],
        [3000, 420],
        [4000, 450],
        [5000, 455],
        [6000, 450],
        [6500, 415],
        [7000, 345],
      ],
      idleRpm: 950,
      redlineRpm: 6900,
      inertia: 0.2,
      engineBrake: 70,
      launchRpm: 4400,
    },
    gearbox: {
      // 6-speed sequential (the R5 has 5): same 1st and top gear, closer steps.
      ratios: [3.2, 2.35, 1.82, 1.47, 1.22, 1.05],
      reverse: 3.3,
      finalDrive: 4.6,
      shiftTime: 0.1,
      efficiency: 0.88,
      upshiftRpm: 6600,
      downshiftRpm: 4000,
    },
    gearings: {
      short: { finalDrive: 5.2 },
      medium: { finalDrive: 4.6 },
      long: { finalDrive: 3.7 },
    },
    drivetrain: {
      frontSplit: 0.42,
      centerLock: 120,
      frontDiffLock: 80,
      rearDiffLock: 200,
    },
    dragArea: 0.8,
    downforceArea: 0.2,
    // Fitted to the imported body (tests/rally/hull-fit.test.ts, which measures the GLB): splitter / front side lips 0.076 -
    // 0.08, sills and arms 0.09 - 0.1 between the axles, rear valance 0.126; the body spans z -2.02 .. 2.06.
    hull: bodyHull(BODY, 0.017, [
      { x: [0, 0.6], z: 1.9, r: 0.16, bottom: 0.085 },
      { x: [0.85], z: 1.65, r: 0.2, bottom: 0.085 },
      { x: [0.5, 0.85], z: 0.7, r: 0.25, bottom: 0.095 },
      { x: [0.5], z: -0.1, r: 0.25, bottom: 0.1 },
      { x: [0.5], z: -0.8, r: 0.25, bottom: 0.095 },
      { x: [0], z: 0.2, r: 0.22, bottom: 0.14 },
      { x: [0, 0.5], z: -1.85, r: 0.2, bottom: 0.14 },
    ]),
  },
  model: {
    paint: '#1d5fb4',
    rim: { color: '#c9ccd1', spokes: 10, style: 'spoke', caliper: '#d63a2f' },
    // The model's own rim, de-cambered and centred on the hub (scripts/car-model/glb-rim-extract.py), rescaled per tyre
    // size (stl-wheel.ts).
    wheelModel: 'fiesta_wheel.glb',
    suspensionStyle: 'wrc',
    // The model carries its own cockpit: see-through glass shows it.
    glass: { color: 0x141c24, opacity: 0.6 },
    // Fallback body if the GLB can't load (and the street car of the city maps): profile.ts.
    profile,
    doorBadge: { z: 0.2, y: 0.6 },
    // No procedural suspension: the model carries its own arms and dampers (trim).
    gltf: {
      file: 'fiesta.glb',
      credit:
        '"Ford Fiesta WRC" by kevin, sketchfab.com/3d-models/ford-fiesta-wrc-8b3f0c6876c74c0480ca04e698582db3, CC BY 4.0 (converted + repainted)',
      autoFit: false,
      matte: false,
      atlas: fiestaLivery,
    },
  },
};
