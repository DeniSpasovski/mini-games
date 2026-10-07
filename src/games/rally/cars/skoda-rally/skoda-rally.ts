import { deriveSetups } from '../../physics/car-setup';
import { bodyHull } from '../../physics/hull';
import type { AxleDef } from '../../physics/types';
import type { CarDef } from '../shared/types';
import { skodaRallyLivery } from './livery';

/** Fabia R5 (2015-19): wheelbase 2.47 m (the model's 2.475), hubs at the tyre radius. */
const AXLE_F = 1.15;
const AXLE_R = AXLE_F - 2.475;

/** Body dimensions (also what the hull is fitted from); wheel radius = tyre overall radius. */
const BODY = {
  length: 4.0,
  width: 1.82,
  height: 1.46,
  comHeight: 0.52,
  wheelRadius: 0.321,
};

const FRONT: AxleDef = {
  z: AXLE_F,
  track: 1.58,
  spring: 34000,
  bump: 2400,
  rebound: 3400,
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
  track: 1.58,
  spring: 29000,
  bump: 2100,
  rebound: 3000,
  travel: 0.26,
  antiRoll: 6000,
  brakeTorque: 750,
  handbrakeTorque: 2800,
  steer: 0,
  grip: 1,
  forceHeight: 0.3,
};

/**
 * Skoda Rally - a Rally2-class hatch: the imported CC BY Fabia R5 body (`gltf`, DETAILS.md) with a
 * hand-built fallback body from public dimensions and press photos (blueprint.ts / body.ts /
 * paint.ts) for when the GLB is missing. Physics = an R5 package on the model's own 2.47 m
 * wheelbase.
 */
export const skodaRally: CarDef = {
  id: 'skoda_rally',
  name: 'Skoda Rally',
  className: 'R5 · AWD turbo',
  description:
    'Fabia R5 (2015-19): 1.6 turbo with the 32 mm restrictor, 5-speed sequential, mechanical diffs, wide arches, roof scoop and wing. The Rally2 class before it was called Rally2.',
  sources: [
    {
      label: '"Skoda Fabia R5 Rally Car" by SenturyUK (Sketchfab)',
      url: 'https://sketchfab.com/3d-models/skoda-fabia-r5-rally-car-fe062f0fd05e43a6a32a88a1aa39ef14',
      note: 'imported body (converted + repainted), CC BY 4.0',
    },
    {
      label: 'Skoda Motorsport - Fabia R5',
      url: 'https://www.skoda-motorsport.com/en/skoda-fabia-r5/',
      note: 'press photos + dimensions used as shape reference (no model, no logos)',
    },
  ],
  // 1.6 turbo four, open rally exhaust, anti-lag, straight-cut sequential box.
  sound: {
    layout: 'i4',
    displacement: 1.6,
    exhaust: 0.85,
    intake: 0.4,
    turbo: { antiLag: true },
    pops: 0.5,
    gearWhine: 0.9,
    gearbox: 'sequential',
    cam: 0.3,
  },
  physics: {
    mass: 1230, // R5 minimum weight
    ...BODY,
    inertiaScale: 0.9,
    wheelWidth: 0.23,
    tyres: {
      size: { width: 0.205, aspect: 65, rim: 15 },
      byCompound: { tarmac: { width: 0.235, aspect: 40, rim: 18 } },
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
      // R5 level (1.6 turbo, 32 mm restrictor: ~400 Nm, ~280 hp at 5500). At the old 350 Nm the 450 Nm Bimmer M3 launched
      // harder on gravel (0-100 4.8 vs 5.2 s) and won the test map. 1.2x (420 Nm) is faster still, but
      // the limit driver then lands a 150 km/h crest on Jackie (~1.88 km) badly and spins.
      torqueCurve: [
        [1000, 184],
        [2000, 276],
        [3000, 368],
        [4000, 402],
        [5000, 391],
        [5500, 368],
        [6000, 328],
        [6700, 259],
      ],
      idleRpm: 950,
      redlineRpm: 6600,
      inertia: 0.22,
      engineBrake: 70,
      launchRpm: 4200,
    },
    gearbox: {
      ratios: [3.2, 2.2, 1.65, 1.3, 1.05],
      reverse: 3.3,
      finalDrive: 4.6,
      shiftTime: 0.12,
      efficiency: 0.88,
      upshiftRpm: 6300,
      downshiftRpm: 3900,
    },
    gearings: {
      short: { finalDrive: 5.2 },
      medium: { finalDrive: 4.6 },
      long: { finalDrive: 3.7 },
    },
    drivetrain: {
      // Mechanical diffs. A stiffer fixed-split centre (lock 220, split 0.45) was tried and made the
      // autopilot fail the Jackie stage (integration-tests/rally/stage.test.ts) - kept the proven numbers.
      frontSplit: 0.42,
      centerLock: 120,
      frontDiffLock: 80,
      rearDiffLock: 200,
    },
    dragArea: 0.75,
    downforceArea: 0.1,
    // Fitted to the imported body (tests/rally/hull-fit.test.ts, which measures the GLB): splitter 0.12, flat floor 0.13 -
    // 0.15 between the axles, rear valance 0.20; the body spans z -1.99 .. 2.00 (COM-centred).
    hull: bodyHull(BODY, 0, [
      { x: [0, 0.6], z: 1.85, r: 0.16, bottom: 0.125 },
      { x: [0], z: 1.2, r: 0.22, bottom: 0.14 },
      { x: [0.5], z: 0.6, r: 0.25, bottom: 0.14 },
      { x: [0.5], z: 0, r: 0.25, bottom: 0.14 },
      { x: [0.5], z: -0.8, r: 0.25, bottom: 0.15 },
      { x: [0], z: -1.3, r: 0.22, bottom: 0.15 },
      { x: [0, 0.5], z: -1.8, r: 0.2, bottom: 0.2 },
    ]),
  },
  model: {
    paint: '#e9e6dd',
    rim: { color: '#e9e6dd', spokes: 16, style: 'spoke', caliper: '#a07a3c' },
    // The model's own rim (front-left, exported by the recipe in DETAILS.md), rescaled per tyre size (stl-wheel.ts).
    wheelModel: 'skoda_rally_wheel.glb',
    suspensionStyle: 'rally',
    glass: { color: 0x2a3a46, opacity: 0.4 },
    // Fallback body if the GLB can't load: the side outline extruded to the body width (side-profile.mjs
    // public/models/cars/skoda_rally.glb --axles 1.15,-1.325 --wheel 0.321).
    profile: {
      width: 1.825,
      outline: [
        -1.964, 0.255, -1.794, 0.195, -1.694, 0.195, -1.674, 0.415, -1.564,
        0.595, -1.294, 0.685, -1.124, 0.625, -1.024, 0.525, -0.954, 0.155,
        0.696, 0.165, 0.706, 0.125, 0.786, 0.125, 0.796, 0.395, 0.856, 0.535,
        1.026, 0.665, 1.186, 0.685, 1.336, 0.635, 1.456, 0.515, 1.506, 0.385,
        1.516, 0.115, 1.986, 0.125, 1.966, 0.585, 1.866, 0.725, 1.556, 0.855,
        0.936, 0.985, 0.336, 1.315, 0.326, 1.375, 0.126, 1.425, -1.474, 1.365,
        -1.484, 1.295, -1.604, 1.195, -1.614, 1.395, -1.764, 1.395, -1.774,
        1.065, -1.924, 0.965, -1.934, 0.585, -1.984, 0.565,
      ],
    },
    doorBadge: { z: 0.27, y: 0.59 },
    // No procedural suspension: the imported model carries its own springs, dampers and arms (trim).
    // Imported body:
    // "Skoda Fabia R5 Rally Car" by SenturyUK, CC BY 4.0, converted by glb-to-parts-stl.py + stl-to-glb.mjs
    // (model.source.json) and painted at runtime (livery.ts).
    gltf: {
      file: 'skoda_rally.glb',
      credit:
        'Body: "Skoda Fabia R5 Rally Car" by SenturyUK, sketchfab.com/3d-models/skoda-fabia-r5-rally-car-fe062f0fd05e43a6a32a88a1aa39ef14, CC BY 4.0 (converted + repainted)',
      autoFit: false,
      matte: true,
      atlas: skodaRallyLivery,
    },
  },
};
