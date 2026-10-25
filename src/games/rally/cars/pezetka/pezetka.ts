import { deriveSetups } from '../../physics/car-setup';
import { bodyHull } from '../../physics/hull';
import type { BrakeSet } from '../../physics/brakes';
import type { AxleDef } from '../../physics/types';
import type { CarDef } from '../shared/types';
import { profile } from './profile';
import { pezetkaLivery } from './livery';

/** Fiat 126p: wheelbase 1.843 m between the model's hubs; the engine hangs behind the rear axle (~60 % of the weight on it), so the front axle sits at z = 1.106. */
const AXLE_F = 1.106;
const AXLE_R = AXLE_F - 1.843;

/** 1970s road tyre against a rally competition tyre (PHYSICS.md "Tyre types"). */
const OLD_ROAD_TYRE = 0.72;

/** Body dimensions (also what the hull is fitted from); wheel radius = tyre overall radius of the model's wheel (135/70 R12). */
const BODY = {
  length: 3.05,
  width: 1.38,
  height: 1.31,
  comHeight: 0.46,
  wheelRadius: 0.2504,
};

// Hubs of the model: front x +-0.542, rear x +-0.579 (the wheels are the game's own, with the model's rim, centred on them).
const FRONT: AxleDef = {
  z: AXLE_F,
  track: 1.084,
  spring: 13000,
  bump: 1000,
  rebound: 1600,
  travel: 0.22,
  antiRoll: 2500,
  handbrakeTorque: 0,
  steer: 1,
  grip: 1,
  forceHeight: 0.3,
};

const REAR: AxleDef = {
  z: AXLE_R,
  track: 1.158,
  spring: 20000,
  bump: 1500,
  rebound: 2400,
  travel: 0.22,
  antiRoll: 3000,
  handbrakeTorque: 900,
  steer: 0,
  grip: 1,
  forceHeight: 0.3,
};

/** 126p brakes: 180 mm drums on all four wheels (PHYSICS.md "Brakes"). */
const BRAKES: BrakeSet = {
  front: {
    type: 'drum',
    diameter: 0.18,
    thickness: 0.03,
    pad: 'road',
    clamp: 2800,
  },
  rear: {
    type: 'drum',
    diameter: 0.18,
    thickness: 0.03,
    pad: 'road',
    clamp: 2600,
  },
};

/**
 * Fiat 126p "Maluch" (`pezetka`, the Polish "pe-zet-ka") - the 652 cc rear-engined city car: a CC BY Sketchfab model kept as it
 * is (own cockpit shell, lamps, bumpers and rim, flat paint), mapped to game parts by material (model.source.json).
 */
export const pezetka: CarDef = {
  id: 'pezetka',
  name: 'Fiat 126p',
  className: 'Historic · RWD',
  description:
    'The Polish "Maluch": 600 kg, a 652 cc two-cylinder behind the rear axle and no driver aids. Slow, so carry every bit of speed and mind the tail.',
  sources: [
    {
      label: 'Fiat 126 (Wikipedia)',
      url: 'https://en.wikipedia.org/wiki/Fiat_126',
      note: 'specification reference',
    },
    {
      label:
        '"Polski Fiat (Fiat 126p)" by Martin Trafas (account TinoD2, Sketchfab)',
      url: 'https://sketchfab.com/3d-models/polski-fiat-fiat-126p-edc1b9d866484e048b4c54d917cca900',
      note: 'imported body, lamps, bumpers and rim (converted + repainted), CC BY 4.0',
    },
    {
      label: '"fiat 126p" by subishi (Sketchfab)',
      url: 'https://sketchfab.com/3d-models/fiat-126p-f44214026ca1454ea4d75755d74334bf',
      note: 'imported interior: dash, steering wheel, seats, rear bench and floor (fitted to the body), CC BY 4.0',
    },
  ],
  // Night headlights: dim, warm halogen.
  headlights: {
    power: 0.5,
    color: 0xffd49a,
    angle: 0.5,
    penumbra: 0.9,
    spill: 0.32,
  },
  // Air-cooled 652 cc parallel twin on a small silencer: a buzzy, sewing-machine note.
  sound: {
    layout: 'i2',
    displacement: 0.65,
    exhaust: 0.1,
    intake: 0.5,
    pops: 0.05,
    gearWhine: 0.15,
    gearbox: 'manual',
    cam: 0.05,
    roughness: 0.12,
    sputter: 0.6,
  },
  physics: {
    noTractionControl: true,
    noAbs: true,
    mass: 600, // 580 - 619 kg kerb weight
    ...BODY,
    inertiaScale: 0.9,
    wheelWidth: 0.135,
    // 12" steel wheels on every compound: stock 135/70 R12 (mixed), a wider 145/70 R12 on tarmac, a taller 135/75 R12 on gravel.
    tyres: {
      size: { width: 0.135, aspect: 70, rim: 12, grade: OLD_ROAD_TYRE },
      byCompound: {
        tarmac: { width: 0.145, aspect: 70, rim: 12, grade: OLD_ROAD_TYRE },
        gravel: { width: 0.135, aspect: 75, rim: 12, grade: OLD_ROAD_TYRE },
      },
    },
    wheelInertia: 0.5,
    maxSteerDeg: 32,
    front: FRONT,
    rear: REAR,
    setup: 'soft',
    setups: deriveSetups(
      { front: FRONT, rear: REAR },
      {
        // Road car: a narrow band, always on the soft side (soft = today's numbers).
        soft: { front: 13000, rear: 20000, travel: 0.22, ride: 0.015 },
        medium: { front: 16500, rear: 25000, travel: 0.2, ride: 0 },
        stiff: { front: 20000, rear: 30000, travel: 0.18, ride: -0.01 },
      },
    ),
    engine: {
      // 652 cc: 43 Nm at 2500 rpm, 17 kW (23 hp) at 4500, a short rev limit at 5500.
      torqueCurve: [
        [1000, 30],
        [1500, 36],
        [2000, 41],
        [2500, 43],
        [3000, 42],
        [3500, 40.5],
        [4000, 38.5],
        [4500, 36.5],
        [5000, 32],
        [5500, 27],
      ],
      idleRpm: 900,
      redlineRpm: 5500,
      inertia: 0.06,
      engineBrake: 12,
      launchRpm: 3000,
    },
    gearbox: {
      // Four speeds, first not synchronised.
      ratios: [3.75, 2.3, 1.41, 0.96],
      reverse: 3.8,
      finalDrive: 4.875,
      shiftTime: 0.22,
      efficiency: 0.88,
      upshiftRpm: 5000,
      downshiftRpm: 2400,
    },
    gearings: {
      short: { finalDrive: 5.3 },
      medium: { finalDrive: 4.875 },
      long: { finalDrive: 4.4 },
    },
    drivetrain: {
      frontSplit: 0,
      centerLock: 0,
      frontDiffLock: 0,
      rearDiffLock: 0,
    },
    brakes: BRAKES,
    dragArea: 0.74,
    downforceArea: 0,
    // Fitted to pezetka.glb (tests/rally/hull-fit.test.ts prints the model's underside per zone).
    hull: bodyHull(BODY, 0.117, [
      { x: [0, 0.4], z: 1.5, r: 0.15, bottom: 0.2 },
      { x: [0.5], z: 0.6, r: 0.18, bottom: 0.175 },
      { x: [0.5], z: -0.4, r: 0.18, bottom: 0.175 },
      { x: [0, 0.4], z: -1.25, r: 0.15, bottom: 0.17 },
    ]),
  },
  model: {
    // The model's own paint is a pale grey; ours is a period 126p blue-grey.
    paint: '#7a8594',
    // The model's own steel rim (pezetka_wheel.glb), de-cambered and centred on the hub.
    rim: { color: '#9aa0a6', spokes: 4, style: 'steel', caliper: false },
    wheelModel: 'pezetka_wheel.glb',
    tyreDust: true,
    suspensionStyle: 'micro',
    cornerSuspension: {
      style: 'micro',
      front: 'wishbone',
      rear: 'wishbone',
      topY: { front: 0.34, rear: 0.22 },
      topIn: { front: 0.18, rear: 0.08 },
      driven: ['rear'],
      inboard: false,
    },
    // The cockpit (from a second model, see model.source.json) shows through the glass.
    glass: { color: 0x141c24, opacity: 0.6 },
    // Fallback body if the GLB can't load (and the street car of the city maps): profile.ts.
    profile,
    // Door plate by the rule (scripts/car-model/door-plate.py).
    doorBadge: { z: 0.36, y: 0.58 },
    gltf: {
      file: 'pezetka.glb',
      credit:
        '"Polski Fiat (Fiat 126p)" by Martin Trafas (account TinoD2), sketchfab.com/3d-models/polski-fiat-fiat-126p-edc1b9d866484e048b4c54d917cca900, CC BY 4.0 (converted + repainted); interior from "fiat 126p" by subishi, sketchfab.com/3d-models/fiat-126p-f44214026ca1454ea4d75755d74334bf, CC BY 4.0',
      autoFit: false,
      atlas: pezetkaLivery,
    },
  },
};
