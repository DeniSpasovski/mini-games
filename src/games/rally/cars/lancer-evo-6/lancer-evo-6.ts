import { deriveSetups } from '../../physics/car-setup';
import { bodyHull } from '../../physics/hull';
import type { AxleDef } from '../../physics/types';
import type { CarDef } from '../shared/types';
import { lancerEvo6Livery } from './livery';
import { profile } from './profile';

/** Lancer Evolution VI: wheelbase 2.49 m between the model's hubs; the front axle sits at z = 1.2 (centre of mass behind it). */
const AXLE_F = 1.2;
const AXLE_R = AXLE_F - 2.493;

/** Body dimensions (also what the hull is fitted from); wheel radius = tyre overall radius. */
const BODY = {
  length: 4.32,
  width: 1.84, // body 1.76 + the mirrors (the boxy profile is baked from the whole GLB)
  height: 1.44,
  comHeight: 0.5,
  wheelRadius: 0.316,
};

// Hubs of the model: x +-0.78 front and rear (the wheels are the game's own, centred on them).
const FRONT: AxleDef = {
  z: AXLE_F,
  track: 1.559,
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
  track: 1.559,
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
 * Lancer EVO VI (`lancer_evo_6`) - the 1999 World Rally Car's road-car base: the imported CC BY "Mitsubishi Lancer Evolution 6"
 * body with its own cockpit (visible through the glass) and its own rim, converted by glb-to-parts-stl.py + stl-to-glb.mjs
 * (model.source.json) and painted at runtime (livery.ts). Released (release.ts).
 */
export const lancerEvo6: CarDef = {
  id: 'lancer_evo_6',
  name: 'Lancer EVO VI',
  className: 'WRC · AWD turbo',
  description:
    'The car that carried Tommi Makinen to his fourth title: 2.0 turbo four, 300 hp, 5-speed, active rear diff. Narrow, short and quick to change direction, with a big wing on the boot.',
  sources: [
    {
      label: '"Mitsubishi Lancer Evolution 6" by vecarz (Sketchfab)',
      url: 'https://sketchfab.com/3d-models/mitsubishi-lancer-evolution-6-wwwvecarzcom-c3d5dcd8ff724bc88c46760d92fc5188',
      note: 'imported body, cockpit and rim (converted + repainted), CC BY 4.0',
    },
    {
      label: 'RallyCars.com - Mitsubishi Lancer Evolution VI',
      url: 'https://rallycars.com/cars/mitsubishi-lancer-evolution-vi/history/',
      note: 'specification reference (300 bhp rally version)',
    },
    {
      label: 'Mitsubishi Motors - WRC 1999',
      url: 'https://www.mitsubishi-motors.com/en/brand/motorsports/wrc/1999/',
      note: 'specification and season reference',
    },
  ],
  // 2.0 turbo four (4G63), open rally exhaust, anti-lag.
  sound: {
    layout: 'i4',
    displacement: 2.0,
    exhaust: 0.9,
    intake: 0.45,
    turbo: { antiLag: true },
    pops: 0.6,
    gearWhine: 0.9,
    gearbox: 'sequential',
    cam: 0.3,
  },
  physics: {
    mass: 1230, // WRC minimum weight (1999 rules)
    ...BODY,
    inertiaScale: 0.9,
    wheelWidth: 0.235,
    tyres: {
      size: { width: 0.235, aspect: 40, rim: 18 },
      byCompound: { gravel: { width: 0.205, aspect: 60, rim: 15 } },
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
      // 4G63 2.0 turbo, rally spec: "more than 52 kgm" (510 Nm) and 300 bhp (224 kW, the FIA's theoretical limit) -
      // peak torque at 4000, peak power near 6500 behind the restrictor.
      torqueCurve: [
        [1000, 150],
        [2000, 290],
        [3000, 420],
        [3500, 480],
        [4000, 500],
        [4500, 470],
        [5000, 425],
        [6000, 355],
        [6500, 325],
        [7000, 250],
      ],
      idleRpm: 950,
      redlineRpm: 6800,
      inertia: 0.2,
      engineBrake: 70,
      launchRpm: 4400,
    },
    gearbox: {
      ratios: [3.2, 2.2, 1.65, 1.3, 1.05],
      reverse: 3.3,
      finalDrive: 4.6,
      shiftTime: 0.12,
      efficiency: 0.88,
      upshiftRpm: 6500,
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
      rearDiffLock: 240,
    },
    dragArea: 0.8,
    downforceArea: 0.18,
    // Fitted to the imported body (tests/rally/hull-fit.test.ts measures the GLB): body underside 0.17 m (nose), 0.18 - 0.2 between the axles, 0.26 m at the tail.
    hull: bodyHull(BODY, -0.072, [
      { x: [0, 0.6], z: 1.95, r: 0.16, bottom: 0.175 },
      { x: [0.8], z: 1.65, r: 0.2, bottom: 0.175 },
      { x: [0.5, 0.8], z: 0.7, r: 0.25, bottom: 0.195 },
      { x: [0.5], z: -0.1, r: 0.25, bottom: 0.205 },
      { x: [0.5], z: -0.8, r: 0.25, bottom: 0.205 },
      { x: [0], z: 0.2, r: 0.22, bottom: 0.205 },
      { x: [0, 0.5], z: -2.0, r: 0.2, bottom: 0.27 },
    ]),
  },
  model: {
    paint: '#d11a20',
    rim: { color: '#c9ccd1', spokes: 10, style: 'spoke', caliper: '#d63a2f' },
    // The model's own rim, de-cambered and centred on the hub (scripts/car-model/glb-rim-extract.py), rescaled per tyre
    // size (stl-wheel.ts).
    wheelModel: 'lancer_evo_6_wheel.glb',
    suspensionStyle: 'evo',
    cornerSuspension: {
      style: 'evo',
      front: 'strut',
      rear: 'wishbone',
      topY: { front: 0.4, rear: 0.36 },
      topIn: { front: 0.2, rear: 0.22 },
      driven: ['front', 'rear'],
    },
    // The model carries its own cockpit: see-through glass shows it.
    glass: { color: 0x141c24, opacity: 0.6 },
    // Fallback body if the GLB can't load (and the street car of the city maps): profile.ts.
    profile,
    // Front door, just under the beltline.
    doorBadge: { z: 0.25, y: 0.59, tilt: 3 },
    // No procedural suspension: the chassis keeps its own parts (trim).
    gltf: {
      file: 'lancer_evo_6.glb',
      credit:
        '"Mitsubishi Lancer Evolution 6" by vecarz, sketchfab.com/3d-models/mitsubishi-lancer-evolution-6-wwwvecarzcom-c3d5dcd8ff724bc88c46760d92fc5188, CC BY 4.0 (converted + repainted)',
      autoFit: false,
      matte: false,
      atlas: lancerEvo6Livery,
    },
  },
};
