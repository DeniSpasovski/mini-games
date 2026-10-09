import { deriveSetups } from '../../physics/car-setup';
import { bodyHull } from '../../physics/hull';
import type { AxleDef } from '../../physics/types';
import { shiftCom } from '../shared/com-shift';
import type { CarDef } from '../shared/types';
import { profile } from './profile';
import { bimmerGt2Livery } from './livery';

// RWD V8 GT2 racer: the wheelbase, body size and tyres follow this mesh; engine and mass follow the E92 M3 GT2 (ALMS) race car:
// 357 kW (485 hp), 1,150 kg (BMW M, see README) - the torque curve peaks at 485 hp at ~7600 rpm.
/** Body dimensions (also what the hull is fitted from); wheel radius = tyre overall radius. */
const BODY = {
  length: 4.67,
  width: 1.98,
  height: 1.26,
  comHeight: 0.46,
  // Reference radius (the model's hubs); the slicks are 30/66-18 front, 31/71-18 rear (rear 2.5 cm taller).
  wheelRadius: 0.334,
};

const FRONT: AxleDef = {
  z: 1.368,
  track: 1.6,
  spring: 92000,
  bump: 4200,
  rebound: 7560,
  travel: 0.13,
  antiRoll: 13000,
  brakeTorque: 2000,
  handbrakeTorque: 0,
  steer: 1,
  grip: 1.08,
  forceHeight: 0.15,
};

const REAR: AxleDef = {
  z: -1.368,
  track: 1.66,
  spring: 84000,
  bump: 3900,
  rebound: 7020,
  travel: 0.13,
  antiRoll: 8500,
  // x 1.076 with the taller rear slick (same brake force at the road, same balance).
  brakeTorque: 1345,
  handbrakeTorque: 3000,
  steer: 0,
  grip: 1.6,
  forceHeight: 0.15,
};

/**
 * Bimmer GT2 (`bimmer_gt2`) - a wide-body E92 M3 racing prototype (splitter, big wing, diffuser) from a CC BY Sketchfab
 * model, split by material and converted by stl-to-glb.mjs (settings: model.source.json). Clean base livery (livery.ts).
 * Released (release.ts).
 */
const gt2: CarDef = {
  id: 'bimmer_gt2',
  name: 'Bimmer GT2',
  className: 'GT2 · RWD V8',
  description:
    'Wide-body GT2 racer: race V8 up front, a big wing and all the power to the rear wheels.',
  sources: [
    {
      label: 'E92 Barnfind - Model by Tushar Singh (Sketchfab)',
      url: 'https://sketchfab.com/3d-models/e92-barnfind-550c4113c2a34b0693e9ee6e7773d840',
      note: 'body + lamps, converted to the in-game model; CC BY 4.0',
    },
    {
      label: 'BMW M - BMW M3 E92, E90 and E93',
      url: 'https://www.bmw-m.com/en/topics/magazine-article-pool/bmw-m3-e92-e90-and-e93.html',
      note: 'specs reference (M3 GT2: 485 hp, 1,150 kg; road V8 8,300 rpm redline)',
    },
    {
      label: 'Racecar Engineering - BMW M3 GT2',
      url: 'https://www.racecar-engineering.com/cars/bmw-m3-gt2/',
      note: 'GT2 race car reference (article, looked at only)',
    },
  ],
  // Race V8 (~4 l), open race exhaust, sequential race box.
  sound: {
    layout: 'v8',
    displacement: 4,
    exhaust: 1,
    intake: 0.6,
    pops: 0.8,
    gearWhine: 0.7,
    gearbox: 'sequential',
    cam: 0.7,
  },
  physics: {
    mass: 1150,
    ...BODY,
    inertia: { pitch: 1860, yaw: 2060, roll: 430 },
    hardBumpStop: true,
    wheelWidth: 0.28,
    // Staggered like the race car: slicks 30/66-18 front / 31/71-18 rear (width cm / overall diameter cm - rim) =
    // 300/34 R18 / 310/41 R18. Rally compounds keep the taller rear; gravel runs one width (a wide tyre ploughs).
    tyres: {
      size: { width: 0.3, aspect: 34, rim: 18 },
      byCompound: {
        mixed: { width: 0.245, aspect: 42, rim: 18 },
        gravel: { width: 0.235, aspect: 50, rim: 17 },
      },
      rear: {
        size: { width: 0.31, aspect: 41, rim: 18 },
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
        soft: { front: 56000, rear: 51000, travel: 0.16, ride: 0.035 },
        medium: { front: 74000, rear: 67000, travel: 0.145, ride: 0.015 },
        stiff: { front: 92000, rear: 84000, travel: 0.13, ride: 0 },
      },
    ),
    engine: {
      torqueCurve: [
        // 525 Nm at 5000, 357 kW (485 hp) at 7600 (was 382 kW / 512 hp).
        [1000, 270],
        [2000, 360],
        [3000, 440],
        [4000, 495],
        [5000, 525],
        [6000, 515],
        [7000, 480],
        [7600, 449],
        [8300, 395],
      ],

      idleRpm: 1000,
      redlineRpm: 8300,
      inertia: 0.2,
      engineBrake: 80,
      launchRpm: 4500,
    },
    gearbox: {
      ratios: [2.9, 2.05, 1.6, 1.3, 1.1, 0.95],
      reverse: 3.2,
      // x 1.076 with the taller rear slicks: the gear speeds stay (no published GT2 ratios to match).
      finalDrive: 4.52,
      shiftTime: 0.1,
      efficiency: 0.9,
      upshiftRpm: 8000,
      downshiftRpm: 4800,
    },
    gearings: {
      short: { finalDrive: 5.16 },
      medium: { finalDrive: 4.52 },
      long: { finalDrive: 4.09 },
    },
    drivetrain: {
      frontSplit: 0,
      centerLock: 0,
      frontDiffLock: 0,
      rearDiffLock: 280,
    },
    dragArea: 0.85,
    downforceArea: 0.4,
    // Fitted to bimmer_gt2.glb (tests/rally/hull-fit.test.ts prints the model's underside per zone): splitter / floor 9 cm, rear 13 cm
    // above the ground (body lifted 6 cm: model.source.json `offset`, ~9 cm of hull clearance for the test map's dips).
    hull: bodyHull(BODY, -0.075, [
      { x: [0, 0.5], z: 2.1, r: 0.16, bottom: 0.09 },
      { x: [0.72], z: 1.8, r: 0.22, bottom: 0.09 },
      { x: [0], z: 1.4, r: 0.22, bottom: 0.094 },
      { x: [0.72], z: 0.7, r: 0.22, bottom: 0.094 },
      { x: [0.72], z: 0, r: 0.22, bottom: 0.094 },
      { x: [0.72], z: -0.7, r: 0.22, bottom: 0.094 },
      { x: [0], z: -1.3, r: 0.22, bottom: 0.094 },
      { x: [0.72], z: -1.8, r: 0.22, bottom: 0.13 },
      { x: [0, 0.45], z: -2.22, r: 0.2, bottom: 0.13 },
    ]),
  },
  model: {
    paint: '#e9e6dd',
    rim: { color: '#b8bcc2', spokes: 10, style: 'spoke', caliper: '#c8a040' },
    // Tarmac: the body model's own BBS alloy (bimmer_gt2_wheel.glb); mixed / gravel: the Bimmer M3 rim, painted black.
    wheelModel: 'bimmer_m3_wheel.glb',
    wheelByCompound: {
      tarmac: { model: 'bimmer_gt2_wheel.glb' },
      mixed: { rimColor: '#16171a' },
      gravel: { rimColor: '#16171a' },
    },
    suspensionStyle: 'gt',
    cornerSuspension: {
      style: 'gt',
      front: 'wishbone',
      rear: 'wishbone',
      topY: { front: 0.36, rear: 0.45 },
      topIn: { front: 0.22, rear: 0.22 },
      driven: ['rear'],
    },
    // Fallback body if the GLB can't load (and the street car of the city maps): profile.ts.
    profile,
    // Rally plate on the door (door shut lines z ~ -0.4 .. 0.9, front = +z), above the side moulding.
    doorBadge: { z: 0.25, y: 0.6 },
    // No `suspension`: the wheel wells are closed by the liner (model.source.json `wheels`).
    gltf: {
      file: 'bimmer_gt2.glb',
      credit:
        'Body: "E92 Barnfind" by Tushar Singh (Sketchfab, CC BY 4.0), converted + repainted',
      autoFit: false,
      atlas: bimmerGt2Livery,
    },
  },
};

/**
 * Weight 45 / 55 front / rear (Motor1; engine far back, steel ballast up front): the axles sit 0.137 m further forward
 * than the model's centre, so the centre of mass is further back (cars/shared/com-shift.ts).
 */
const COM_SHIFT = 0.137;
export const bimmerGt2 = shiftCom(gt2, COM_SHIFT);
