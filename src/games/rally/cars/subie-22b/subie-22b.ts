import { deriveSetups } from '../../physics/car-setup';
import { bodyHull } from '../../physics/hull';
import type { AxleDef } from '../../physics/types';
import type { CarDef } from '../shared/types';
import { subie22bLivery } from './livery';

/** Body dimensions (also what the hull is fitted from); wheel radius = tyre overall radius (235/40 R17, the real size). */
const BODY = {
  length: 4.35,
  width: 1.87,
  height: 1.39,
  comHeight: 0.5,
  wheelRadius: 0.31,
};

// Wheelbase 2.54 m (the real car's 2.52 m, the model scaled to it), COM ~57 % over the front axle. Track 1.52 m = the model's wheel
// centres (the real car runs 1.48 / 1.50 m).
const FRONT: AxleDef = {
  z: 1.08,
  track: 1.52,
  spring: 38000,
  bump: 2600,
  rebound: 3700,
  travel: 0.22,
  antiRoll: 9000,
  brakeTorque: 1700,
  handbrakeTorque: 0,
  steer: 1,
  grip: 1.04,
  forceHeight: 0.3,
};

const REAR: AxleDef = {
  z: -1.46,
  track: 1.52,
  spring: 33000,
  bump: 2300,
  rebound: 3300,
  travel: 0.22,
  antiRoll: 6500,
  brakeTorque: 800,
  handbrakeTorque: 2600,
  steer: 0,
  grip: 1.04,
  forceHeight: 0.3,
};

/**
 * Subaru WRX STI 22B (`subie_22b`) - a 1998 blue coupe with the side star livery: 2.2 l turbo flat-four, five-speed box,
 * permanent AWD, 1,270 kg. Body: a CC BY-NC Sketchfab model, split by material and converted by stl-to-glb.mjs (settings:
 * model.source.json); the raw download stays out of git. Test only (release.ts).
 */
export const subie22b: CarDef = {
  id: 'subie_22b',
  name: 'Subaru WRX STI 22B',
  className: 'Group A · AWD',
  description:
    'Blue 90s turbo coupe with the works star livery: flat-four boxer rumble, grippy AWD, a little heavy on the nose.',
  sources: [
    {
      label:
        '"1999 Subaru MPREZA WRX STi GC8 Minotaurus" by SIU Car Garage (Sketchfab)',
      url: 'https://sketchfab.com/3d-models/1999-subaru-mpreza-wrx-sti-gc8-minotaurus-6117b4accfb748e2af4641c1d45bf0cc',
      note: 'body + glass + wheel, converted to the in-game model; CC BY-NC 4.0 (noncommercial)',
    },
    {
      label: 'STI - Impreza 22B',
      url: 'https://www.sti.jp/en/roadcars/1998/impreza-22b.html',
      note: 'specs reference (2.2 l, 280 PS, 5-speed AWD), looked at only',
    },
  ],
  // 2.2 l boxer four with a turbo and a free-flowing exhaust: lumpy, unequal-length headers.
  sound: {
    layout: 'flat4',
    displacement: 2.2,
    exhaust: 0.8,
    intake: 0.4,
    turbo: { antiLag: false },
    pops: 0.35,
    gearWhine: 0.4,
    gearbox: 'manual',
    cam: 0.25,
  },
  physics: {
    mass: 1270,
    ...BODY,
    inertiaScale: 0.9,
    wheelWidth: 0.235,
    tyres: {
      size: { width: 0.235, aspect: 40, rim: 17 },
      byCompound: { gravel: { width: 0.215, aspect: 55, rim: 16 } },
    },
    wheelInertia: 1.5,
    maxSteerDeg: 32,
    front: FRONT,
    rear: REAR,
    setup: 'medium',
    setups: deriveSetups(
      { front: FRONT, rear: REAR },
      {
        soft: { front: 30000, rear: 26000, travel: 0.24, ride: 0.03 },
        medium: { front: 38000, rear: 33000, travel: 0.22, ride: 0.01 },
        stiff: { front: 56000, rear: 48000, travel: 0.18, ride: -0.01 },
      },
    ),
    engine: {
      // 280 PS (206 kW) at 6000 rpm, 363 Nm at 3200: turbo lag below ~2500, flat top.
      torqueCurve: [
        [1000, 130],
        [2000, 235],
        [3000, 355],
        [3500, 363],
        [4500, 350],
        [5500, 335],
        [6000, 328],
        [6800, 285],
        [7400, 240],
      ],
      idleRpm: 900,
      redlineRpm: 7400,
      inertia: 0.2,
      engineBrake: 60,
      launchRpm: 4000,
    },
    gearbox: {
      ratios: [3.454, 2.062, 1.448, 1.088, 0.825],
      reverse: 3.416,
      finalDrive: 4.44,
      shiftTime: 0.2,
      efficiency: 0.9,
      upshiftRpm: 7000,
      downshiftRpm: 4200,
    },
    gearings: {
      short: { finalDrive: 4.9 },
      medium: { finalDrive: 4.44 },
      long: { finalDrive: 3.9 },
    },
    drivetrain: {
      // Viscous centre diff with a rear bias (35 / 65), limited-slip rear.
      frontSplit: 0.38,
      centerLock: 130,
      frontDiffLock: 25,
      rearDiffLock: 90,
    },
    dragArea: 0.78,
    downforceArea: 0.08,
    // Fitted to subie_22b.glb (tests/rally/hull-fit.test.ts prints the model's underside): skirts / floor 0.13 m, splitter and diffuser 0.145 m
    // (body lifted 5 cm: model.source.json `offset`).
    hull: bodyHull(BODY, -0.175, [
      { x: [0, 0.55], z: 1.8, r: 0.16, bottom: 0.145 },
      { x: [0], z: 1.2, r: 0.22, bottom: 0.13 },
      { x: [0.5], z: 0.6, r: 0.25, bottom: 0.13 },
      { x: [0.5], z: 0, r: 0.25, bottom: 0.13 },
      { x: [0.5], z: -0.8, r: 0.25, bottom: 0.13 },
      { x: [0], z: -1.4, r: 0.22, bottom: 0.13 },
      { x: [0, 0.5], z: -2.1, r: 0.2, bottom: 0.145 },
    ]),
  },
  model: {
    // Fallback body (used only until / unless public/models/cars/subie_22b.glb loads). Rear -> front, z in physics coordinates.
    stations: [
      { z: -2.31, floor: 0.38, belt: 0.99, hw: 0.62, hwBelt: 0.58 },
      { z: -2.16, floor: 0.3, belt: 1.03, hw: 0.8, hwBelt: 0.76 },
      { z: -2.0, floor: 0.28, belt: 1.03, hw: 0.88, hwBelt: 0.85 },
      { z: -1.85, floor: 0.28, belt: 1.03, hw: 0.9, hwBelt: 0.89 },
      { z: -1.7, floor: 0.22, belt: 0.97, hw: 0.9, hwBelt: 0.89 },
      { z: -1.46, floor: 0.2, belt: 0.88, hw: 0.88, hwBelt: 0.85 },
      { z: -0.9, floor: 0.2, belt: 0.88, hw: 0.86, hwBelt: 0.83 },
      { z: -0.3, floor: 0.2, belt: 0.88, hw: 0.87, hwBelt: 0.84 },
      { z: 0.3, floor: 0.2, belt: 0.9, hw: 0.88, hwBelt: 0.86 },
      { z: 0.75, floor: 0.2, belt: 0.88, hw: 0.88, hwBelt: 0.85 },
      { z: 1.08, floor: 0.2, belt: 0.86, hw: 0.88, hwBelt: 0.85 },
      { z: 1.5, floor: 0.2, belt: 0.82, hw: 0.86, hwBelt: 0.82 },
      { z: 1.8, floor: 0.22, belt: 0.74, hw: 0.75, hwBelt: 0.68 },
      { z: 1.96, floor: 0.28, belt: 0.58, hw: 0.6, hwBelt: 0.54 },
    ],
    cabin: {
      zFront: 0.75,
      zRear: -1.71,
      roofFront: -0.09,
      roofRear: -1.13,
      roofY: 1.39,
      roofHw: 0.6,
      bPillar: -0.61,
      kick: 0.3,
    },
    paint: '#1c44b8',
    flare: 0.04,
    rim: { color: '#d8b24a', spokes: 6, style: 'spoke', caliper: '#c8102e' },
    // The model's own gold alloy (subie_22b_wheel.glb), scaled to each compound's tyre.
    wheelModel: 'subie_22b_wheel.glb',
    suspensionStyle: 'sti',
    parts: {
      arches: 'round',
      rearWing: 'lip',
      splitter: false,
      sideSkirts: true,
      hoodVents: true,
      headlights: 'round',
      grille: 'small',
      doors: 2,
    },
    // The source model has no cockpit: seats, dash, wheel and cage are the shared procedural ones, seen through tinted windows.
    glass: { color: 0x2a3a46, opacity: 0.4 },
    livery: 'rally1',
    doorBadge: { z: 0.22, y: 0.64 },
    gltf: {
      file: 'subie_22b.glb',
      credit:
        'Body: "1999 Subaru MPREZA WRX STi GC8 Minotaurus" by SIU Car Garage (Sketchfab, CC BY-NC 4.0), converted + repainted',
      autoFit: false,
      atlas: subie22bLivery,
      metallic: true,
      addOns: { cockpit: 'road' },
    },
  },
};
