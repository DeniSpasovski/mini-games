import { deriveSetups } from '../../physics/car-setup';
import { bodyHull } from '../../physics/hull';
import type { AxleDef } from '../../physics/types';
import type { CarDef } from '../shared/types';
import { subie22bLivery } from './livery';
import { profile } from './profile';

/** Body dimensions (also what the hull is fitted from); wheel radius = tyre overall radius (235/40 R17, the real size). */
const BODY = {
  length: 4.35,
  width: 1.77,
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
  rebound: 4680,
  travel: 0.22,
  antiRoll: 4500,
  brakeTorque: 1700,
  handbrakeTorque: 0,
  steer: 1,
  grip: 1,
  forceHeight: 0.15,
};

const REAR: AxleDef = {
  z: -1.46,
  track: 1.52,
  spring: 33000,
  bump: 2300,
  rebound: 4140,
  travel: 0.22,
  antiRoll: 3200,
  brakeTorque: 800,
  handbrakeTorque: 2600,
  steer: 0,
  grip: 1.02,
  forceHeight: 0.15,
};

/**
 * Subaru WRX STI 22B (`subie_22b`) - a 1998 blue coupe with the side star livery: 2.2 l turbo flat-four, five-speed box,
 * permanent AWD, 1,270 kg. Body: a CC BY-NC Sketchfab rally GC8, split by node and converted by stl-to-glb.mjs (settings:
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
      label: '"Rally Car" by SpatialNeglect (Sketchfab)',
      url: 'https://sketchfab.com/3d-models/rally-car-e0dfd3b6d19947df85002fd8de0a3a02',
      note: 'body, glass, cockpit, lamps + wheel, converted to the in-game model; CC BY-NC 4.0 (noncommercial)',
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
    inertia: { pitch: 2120, yaw: 2240, roll: 440 },
    hardBumpStop: true,
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
        stiff: { front: 56000, rear: 48000, travel: 0.18, ride: -0.01, bar: 2 },
      },
    ),
    engine: {
      // 280 PS (206 kW) at 6000 rpm, 363 Nm at 3200: turbo lag below ~2500, flat top.
      torqueCurve: [
        [1000, 130],
        [2000, 235],
        [3000, 360],
        [3200, 363],
        [4000, 358],
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
      frontDiffLock: 50,
      rearDiffLock: 160,
    },
    dragArea: 0.78,
    downforceArea: 0.08,
    // Fitted to subie_22b.glb (tests/rally/hull-fit.test.ts prints the model's underside): mudflaps 0.11 - 0.12 m, sills 0.22 m,
    // front bumper 0.2 m (body lifted 3 cm: model.source.json `offset`).
    hull: bodyHull(BODY, -0.175, [
      { x: [0, 0.55], z: 1.8, r: 0.16, bottom: 0.2 },
      { x: [0], z: 1.2, r: 0.22, bottom: 0.13 },
      { x: [0.5], z: 0.6, r: 0.25, bottom: 0.13 },
      { x: [0.5], z: 0, r: 0.25, bottom: 0.13 },
      { x: [0.5], z: -0.8, r: 0.25, bottom: 0.13 },
      { x: [0], z: -1.4, r: 0.22, bottom: 0.13 },
      { x: [0, 0.5], z: -2.1, r: 0.2, bottom: 0.145 },
    ]),
  },
  model: {
    paint: '#1a56c0',
    rim: { color: '#d8b24a', spokes: 6, style: 'spoke', caliper: '#c8102e' },
    // The model's own gold alloy (subie_22b_wheel.glb), scaled to each compound's tyre.
    wheelModel: 'subie_22b_wheel.glb',
    suspensionStyle: 'sti',
    // The model's own cockpit (left-hand drive, seats, roll cage) shows through lightly tinted windows.
    glass: { color: 0x141c24, opacity: 0.6 },
    // Fallback body if the GLB can't load: profile.ts. Not a city street car while the 22B is a test car.
    profile,
    // Rally plate on the front door (front = +z), over the crescent graphic.
    doorBadge: { z: 0.22, y: 0.64 },
    gltf: {
      file: 'subie_22b.glb',
      credit:
        'Body: "Rally Car" by SpatialNeglect (Sketchfab, CC BY-NC 4.0), converted + repainted',
      autoFit: false,
      atlas: subie22bLivery,
      metallic: true,
    },
  },
};
