import { deriveSetups } from '../../physics/car-setup';
import { bodyHull } from '../../physics/hull';
import type { AxleDef } from '../../physics/types';
import type { CarDef } from '../shared/types';
import { profile } from './profile';
import { citroenC4Livery } from './livery';

/** Citroen C4 WRC (2007): wheelbase 2.615 m between the model's hubs; the front axle sits at z = 1.2 (centre of mass behind it). */
const AXLE_F = 1.2;
const AXLE_R = AXLE_F - 2.615;

/** Body dimensions (also what the hull is fitted from); wheel radius = tyre overall radius. */
const BODY = {
  length: 4.25,
  width: 1.92,
  height: 1.48,
  comHeight: 0.5,
  wheelRadius: 0.336,
};

// Hubs of the model: x +-0.808 on both axles (the wheels are the game's own, centred on them).
const FRONT: AxleDef = {
  z: AXLE_F,
  track: 1.616,
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
  track: 1.616,
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
 * Citroen C4 WRC (`citroen_c4`) - a 2007 World Rally Car: the imported CC BY "Citroen C4 WRC Red Bull 2007" body with its own
 * cockpit (seats, dash, cage - visible through the glass) and own rim, converted by glb-to-parts-stl.py + stl-to-glb.mjs
 * (model.source.json) and painted at runtime (livery.ts). Test car (release.ts).
 */
export const citroenC4: CarDef = {
  id: 'citroen_c4',
  name: 'Citroen C4 WRC',
  className: 'WRC · AWD turbo',
  description:
    '2007 World Rally Car: 2.0 turbo, 6-speed sequential, active centre diff. A long-wheelbase hatch that is calm on gravel and fast through the sweepers.',
  sources: [
    {
      label: '"Citroen C4 WRC Red Bull 2007" by Max (Sketchfab)',
      url: 'https://sketchfab.com/3d-models/citroen-c4-wrc-red-bull-2007-97d128fb4b2a4558a02d65af542486dc',
      note: 'imported body, cockpit and rim (converted + repainted, sponsor and manufacturer marks removed), CC BY 4.0',
    },
  ],
  // 2.0 turbo four, open rally exhaust, anti-lag, sequential box.
  sound: {
    layout: 'i4',
    displacement: 2,
    exhaust: 0.9,
    intake: 0.4,
    turbo: { antiLag: true },
    pops: 0.6,
    gearWhine: 0.9,
    gearbox: 'sequential',
    cam: 0.3,
  },
  physics: {
    mass: 1230, // WRC minimum weight (2007 rules)
    ...BODY,
    inertiaScale: 1,
    wheelWidth: 0.235,
    tyres: {
      size: { width: 0.235, aspect: 45, rim: 18 },
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
      // 2.0 turbo, 34 mm restrictor: 550 Nm at 4000, 235 kW (315 hp) at 5500.
      torqueCurve: [
        [1000, 220],
        [2000, 360],
        [3000, 490],
        [4000, 550],
        [4500, 510],
        [5000, 460],
        [5500, 410],
        [6000, 320],
        [6500, 200],
      ],
      idleRpm: 950,
      redlineRpm: 6200,
      inertia: 0.2,
      engineBrake: 70,
      launchRpm: 4200,
    },
    gearbox: {
      // 6-speed sequential.
      ratios: [3.2, 2.35, 1.82, 1.47, 1.22, 1.05],
      reverse: 3.3,
      finalDrive: 4.6,
      shiftTime: 0.1,
      efficiency: 0.88,
      upshiftRpm: 5900,
      downshiftRpm: 3600,
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
    // Fitted to the imported body (tests/rally/hull-fit.test.ts, which measures the GLB): front bumper 0.227, sills and floor
    // 0.194 between the axles, rear bumper 0.259; the body spans z -2.13 .. 2.13.
    hull: bodyHull(BODY, 0, [
      { x: [0, 0.6], z: 1.9, r: 0.16, bottom: 0.235 },
      { x: [0.85], z: 1.65, r: 0.2, bottom: 0.235 },
      { x: [0.5, 0.85], z: 0.7, r: 0.25, bottom: 0.2 },
      { x: [0.5], z: -0.1, r: 0.25, bottom: 0.2 },
      { x: [0.5], z: -0.8, r: 0.25, bottom: 0.2 },
      { x: [0], z: 0.2, r: 0.22, bottom: 0.2 },
      { x: [0, 0.5], z: -1.85, r: 0.2, bottom: 0.265 },
    ]),
  },
  model: {
    paint: '#c4162c',
    rim: { color: '#c9ccd1', spokes: 15, style: 'spoke', caliper: '#d63a2f' },
    // The model's own rim, de-cambered and centred on the hub (scripts/car-model/glb-rim-extract.py --side +x), rescaled per tyre
    // size (stl-wheel.ts).
    wheelModel: 'citroen_c4_wheel.glb',
    suspensionStyle: 'wrcgold',
    // The model carries its own cockpit: see-through glass shows it.
    glass: { color: 0x2a3a46, opacity: 0.35 },
    // Fallback body if the GLB can't load (and the street car of the city maps): profile.ts.
    profile,
    doorBadge: { z: 0.2, y: 0.6 },
    // No procedural suspension: the model carries its own arms and dampers (trim).
    gltf: {
      file: 'citroen_c4.glb',
      credit:
        '"Citroen C4 WRC Red Bull 2007" by Max, sketchfab.com/3d-models/citroen-c4-wrc-red-bull-2007-97d128fb4b2a4558a02d65af542486dc, CC BY 4.0 (converted + repainted)',
      autoFit: false,
      matte: false,
      atlas: citroenC4Livery,
    },
  },
};
