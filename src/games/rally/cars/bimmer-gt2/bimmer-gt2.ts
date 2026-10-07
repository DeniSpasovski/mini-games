import { deriveSetups } from '../../physics/car-setup';
import { bodyHull } from '../../physics/hull';
import type { AxleDef } from '../../physics/types';
import type { CarDef } from '../shared/types';
import { bimmerGt2Livery } from './livery';

// RWD V8 GT2 racer: the wheelbase, body size and tyres follow this mesh; drivetrain numbers are a tuned E92 M3 race car's.
/** Body dimensions (also what the hull is fitted from); wheel radius = tyre overall radius. */
const BODY = {
  length: 4.67,
  width: 1.98,
  height: 1.26,
  comHeight: 0.46,
  // 300 / 35 R18 race tyres.
  wheelRadius: 0.334,
};

const FRONT: AxleDef = {
  z: 1.368,
  track: 1.6,
  spring: 92000,
  bump: 4200,
  rebound: 5900,
  travel: 0.13,
  antiRoll: 26000,
  brakeTorque: 2000,
  handbrakeTorque: 0,
  steer: 1,
  grip: 1.08,
  forceHeight: 0.3,
};

const REAR: AxleDef = {
  z: -1.368,
  track: 1.66,
  spring: 84000,
  bump: 3900,
  rebound: 5500,
  travel: 0.13,
  antiRoll: 17000,
  brakeTorque: 1250,
  handbrakeTorque: 3000,
  steer: 0,
  grip: 1.3,
  forceHeight: 0.3,
};

/**
 * Bimmer GT2 (`bimmer_gt2`) - a wide-body E92 M3 racing prototype (splitter, big wing, diffuser) from a CC BY Sketchfab
 * model, split by material and converted by stl-to-glb.mjs (settings: model.source.json). Clean base livery (livery.ts).
 * Test only (release.ts).
 */
export const bimmerGt2: CarDef = {
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
    mass: 1250,
    ...BODY,
    inertiaScale: 0.9,
    wheelWidth: 0.3,
    tyres: {
      size: { width: 0.3, aspect: 35, rim: 18 },
      byCompound: { gravel: { width: 0.265, aspect: 45, rim: 17 } },
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
        [1000, 240],
        [2000, 320],
        [3000, 390],
        [4000, 440],
        [5000, 475],
        [6000, 470],
        [7000, 445],
        [7600, 420],
        [8200, 360],
      ],
      idleRpm: 1000,
      redlineRpm: 8000,
      inertia: 0.2,
      engineBrake: 80,
      launchRpm: 4500,
    },
    gearbox: {
      ratios: [2.9, 2.05, 1.6, 1.3, 1.1, 0.95],
      reverse: 3.2,
      finalDrive: 4.2,
      shiftTime: 0.1,
      efficiency: 0.9,
      upshiftRpm: 7700,
      downshiftRpm: 4800,
    },
    gearings: {
      short: { finalDrive: 4.8 },
      medium: { finalDrive: 4.2 },
      long: { finalDrive: 3.8 },
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
    // Fallback body (used only until / unless public/models/cars/bimmer_gt2.glb exists). Rear -> front.
    stations: [
      { z: -2.35, floor: 0.3, belt: 0.88, hw: 0.84, hwBelt: 0.78 },
      { z: -2.1, floor: 0.2, belt: 0.95, hw: 0.9, hwBelt: 0.82 },
      { z: -1.368, floor: 0.12, belt: 0.95, hw: 0.95, hwBelt: 0.84 },
      { z: -0.5, floor: 0.1, belt: 0.92, hw: 0.93, hwBelt: 0.82 },
      { z: 0.5, floor: 0.1, belt: 0.9, hw: 0.93, hwBelt: 0.82 },
      { z: 1.368, floor: 0.12, belt: 0.86, hw: 0.95, hwBelt: 0.84 },
      { z: 2.0, floor: 0.12, belt: 0.78, hw: 0.9, hwBelt: 0.78 },
      { z: 2.28, floor: 0.12, belt: 0.72, hw: 0.84, hwBelt: 0.7 },
    ],
    cabin: {
      zFront: 0.9,
      zRear: -1.5,
      roofFront: 0.3,
      roofRear: -1.0,
      roofY: 1.3,
      roofHw: 0.62,
      kick: 0.2,
      bPillar: -0.5,
    },
    paint: '#e9e6dd',
    flare: 0.06,
    rim: { color: '#b8bcc2', spokes: 10, style: 'spoke', caliper: '#c8a040' },
    suspensionStyle: 'race',
    parts: {
      arches: 'round',
      rearWing: 'lip',
      splitter: true,
      sideSkirts: true,
      diffuser: true,
      headlights: 'rect',
      grille: 'slats',
      doors: 2,
    },
    livery: 'rally1',
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
