import { deriveSetups } from '../../physics/car-setup';
import { bodyHull } from '../../physics/hull';
import type { AxleDef } from '../../physics/types';
import type { CarDef } from '../shared/types';
import { bimmerM3Atlas } from './livery';

// RWD V8 coupe: drivetrain and suspension numbers are the car's own; the wheelbase, body size and tyres follow this mesh.
/** Body dimensions (also what the hull is fitted from); wheel radius = tyre overall radius. */
const BODY = {
  length: 4.61,
  width: 1.98,
  height: 1.4,
  comHeight: 0.48,
  // Street E46 wheels: 245/40 R18 tarmac, 205/65 R16 gravel.
  wheelRadius: 0.33,
};

// Track 1.66 (Bimmer 1.64): the old wheel assembly is cut out of the mesh, so the 0.235 m tyre sits inside the flares (centre 0.83).
const FRONT: AxleDef = {
  z: 1.361,
  track: 1.66,
  spring: 78000,
  bump: 3680,
  rebound: 5152,
  travel: 0.14,
  antiRoll: 23833,
  brakeTorque: 1700,
  handbrakeTorque: 0,
  steer: 1,
  grip: 1.06, // street tyres (245 / 40 R18) need a little front grip so the tarmac specialist stays ahead of the Skoda (car-setup.test.ts)
  forceHeight: 0.3,
};

const REAR: AxleDef = {
  z: -1.361,
  track: 1.66,
  spring: 70000,
  bump: 3402,
  rebound: 4733,
  travel: 0.14,
  antiRoll: 15312,
  brakeTorque: 1050,
  handbrakeTorque: 3000,
  steer: 0,
  // Rear bias: at 1.05 the RWD V8 spun on gravel under full throttle; 1.15 still did (tests/rally/car-setup.test.ts
  // "straight-line launch"). The tyre size factors act on both axles, so they do not replace this bias.
  grip: 1.3,
  forceHeight: 0.3,
};

/**
 * Bimmer M3 (`bimmer_m3`) - an E46 coupe (tuning / lowered street version) from a CC BY 1:33 single-shell print model,
 * labelled by segment-stl.py and converted by stl-to-glb.mjs (settings: model.source.json). Wears the M3 ALMS livery
 * (livery.ts), fitted to this body (DETAILS.md). Released (release.ts).
 */
export const bimmerM3: CarDef = {
  id: 'bimmer_m3',
  name: 'Bimmer M3',
  className: 'GT · RWD V8',
  description:
    'Lowered E46 coupe in the M3 ALMS livery: V8 up front, all the power to the rear wheels.',
  sources: [
    {
      label: 'BMW E46 Coupe - Tuning - Model by Doomas3D (MakerWorld)',
      url: 'https://makerworld.com/en/models/2056872-bmw-e46-coupe-tuning-model',
      note: 'STL body + its own rim, converted to the in-game model; CC BY 4.0',
    },
    {
      label: 'Top Gear - E46 M3 GTR would be the ultimate track day toy',
      url: 'https://www.topgear.com/car-news/motorsport/e46-m3-gtr-would-be-ultimate-track-day-toy',
      note: 'model + livery reference (the road-going / race E46 M3 GTR)',
    },
    {
      label: 'BMW M - BMW M3 GTR and Need for Speed Most Wanted',
      url: 'https://www.bmw-m.com/en/topics/magazine-article-pool/bmw-m3-gtr-need-for-speed-most-wanted.html',
      note: 'model + livery reference (the blue / silver Most Wanted GTR scheme)',
    },
    {
      label:
        'BimmerLife - The M3 GTR took the American Le Mans Series by storm 25 years ago',
      url: 'https://bimmerlife.com/2026/08/11/the-m3-gtr-took-the-american-le-mans-series-by-storm-25-years-ago/',
      note: 'livery reference',
    },
  ],
  physics: {
    mass: 1180,
    ...BODY,
    inertiaScale: 0.9,
    wheelWidth: 0.235,
    tyres: {
      size: { width: 0.245, aspect: 40, rim: 18 },
      byCompound: { gravel: { width: 0.205, aspect: 65, rim: 16 } },
    },
    wheelInertia: 1.6,
    maxSteerDeg: 30,
    front: FRONT,
    rear: REAR,
    setup: 'stiff',
    setups: deriveSetups(
      { front: FRONT, rear: REAR },
      {
        soft: { front: 47000, rear: 42000, travel: 0.17, ride: 0.035 },
        medium: { front: 62000, rear: 55000, travel: 0.16, ride: 0.015 },
        stiff: { front: 78000, rear: 70000, travel: 0.14, ride: 0 },
      },
    ),
    engine: {
      torqueCurve: [
        [1000, 220],
        [2000, 300],
        [3000, 370],
        [4000, 420],
        [5000, 450],
        [6000, 445],
        [7000, 420],
        [7600, 395],
        [8200, 340],
      ],
      idleRpm: 1000,
      redlineRpm: 8000,
      inertia: 0.2,
      engineBrake: 75,
      launchRpm: 4500,
    },
    gearbox: {
      ratios: [2.9, 2.05, 1.6, 1.3, 1.1, 0.95],
      reverse: 3.2,
      finalDrive: 4.2, // 6th gear tops out at the redline: 249 km/h (setup screen)
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
      rearDiffLock: 260,
    },
    dragArea: 0.8,
    downforceArea: 0.22,
    // Fitted to bimmer_m3.glb (tests/rally/hull-fit.test.ts prints the model's underside per zone): splitter / front
    // bumper 0.16 m, floor + sills 0.142 m, rear bumper 0.22 - 0.28 m above the ground at standard ride height (the body is
    // raised 7 cm over the lowered street pose: model.source.json `offset` - at 7 cm floor the autopilot beached on the test map,
    // and the wheels should sit low in the arches).
    hull: bodyHull(BODY, -0.105, [
      { x: [0, 0.5], z: 2.05, r: 0.16, bottom: 0.105 },
      { x: [0.72], z: 1.8, r: 0.22, bottom: 0.105 },
      { x: [0], z: 1.4, r: 0.22, bottom: 0.095 },
      { x: [0.72], z: 0.7, r: 0.22, bottom: 0.095 },
      { x: [0.72], z: 0, r: 0.22, bottom: 0.095 },
      { x: [0.72], z: -0.7, r: 0.22, bottom: 0.095 },
      { x: [0], z: -1.3, r: 0.22, bottom: 0.095 },
      { x: [0.72], z: -1.8, r: 0.22, bottom: 0.17 },
      { x: [0, 0.45], z: -2.2, r: 0.2, bottom: 0.185 },
    ]),
  },
  model: {
    // Fallback body (used only until / unless public/models/cars/bimmer_m3.glb exists). Rear -> front (axles at
    // z = +-1.361).
    stations: [
      { z: -2.35, floor: 0.3, belt: 0.88, hw: 0.84, hwBelt: 0.78 },
      { z: -2.1, floor: 0.2, belt: 0.95, hw: 0.9, hwBelt: 0.82 },
      { z: -1.361, floor: 0.12, belt: 0.95, hw: 0.92, hwBelt: 0.82 },
      { z: -0.5, floor: 0.1, belt: 0.92, hw: 0.9, hwBelt: 0.8 },
      { z: 0.5, floor: 0.1, belt: 0.9, hw: 0.9, hwBelt: 0.8 },
      { z: 1.361, floor: 0.12, belt: 0.86, hw: 0.92, hwBelt: 0.82 },
      { z: 2.0, floor: 0.12, belt: 0.78, hw: 0.9, hwBelt: 0.78 },
      { z: 2.18, floor: 0.12, belt: 0.72, hw: 0.84, hwBelt: 0.7 },
    ],
    cabin: {
      zFront: 0.9,
      zRear: -1.5,
      roofFront: 0.3,
      roofRear: -1.0,
      roofY: 1.38,
      roofHw: 0.62,
      kick: 0.2,
      bPillar: -0.5,
    },
    paint: '#e9e6dd',
    flare: 0.05,
    rim: { color: '#b8bcc2', spokes: 16, style: 'spoke', caliper: '#c8a040' },
    // The model's own 8-spoke rim with a lathed lip + barrel (stl-wheel-extract.py, `wheelRim` in model.source.json),
    // rescaled per tyre size (stl-wheel.ts); `rim` above is the procedural fallback.
    wheelModel: 'bimmer_m3_wheel.glb',
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
    // Rally plate on the door (door shut lines z -0.33 .. 0.83, front = +z), above the side moulding.
    doorBadge: { z: 0.2, y: 0.635 },
    // No `suspension`: the mesh models its own arms / hubs inside closed wheel wells.
    gltf: {
      file: 'bimmer_m3.glb',
      credit:
        'Body + rims: "BMW E46 Coupe - Tuning - Model" by Doomas3D (MakerWorld, CC BY 4.0), converted + repainted',
      autoFit: false,
      // M3 ALMS livery (fitted to this mesh) + the matte black arch patch.
      atlas: bimmerM3Atlas,
    },
  },
};
