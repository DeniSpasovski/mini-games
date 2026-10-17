import {
  BoxGeometry,
  CylinderGeometry,
  PlaneGeometry,
  type BufferGeometry,
} from 'three';
import { Rng } from '../../../../shared/rng';
import { merge, paint } from '../../engine/geo';
import { getMaterial } from '../../engine/materials';
import type { AssetBuilder } from '../types';
import {
  streetCarModel,
  SEDAN,
  STREET_CAR_COUNT,
  type StreetCarShape,
} from './street-car-models';

/**
 * Street vehicles for city maps: parked cars (`street_car`: simplified models of the CC BY packs in `street-car-models.ts`, in a few paints), the
 * yellow `taxi`, the `police_car` (white, navy band, light bar, "POLICE" on the doors) and the
 * `fire_truck` (red engine with a roof ladder, "FIRE DEPT" on the side) and the `ambulance` (white box van, red
 * stripe, "FIRE DEPT" + "AMBULANCE" on the box). The lettering is generic words on
 * purpose (no real agency names, badges or exact liveries). Every vehicle is one
 * draw call (shared `vehicle` material: vertex colour paint + the decals atlas), models face +X with
 * the origin on the ground under their middle. Cars are ~900 triangles (~400 at LOD 1), the truck ~450.
 */

/** u / v of the plain-white corner of the decals atlas (every painted face samples it). */
const PLAIN: [number, number] = [0.03, 0.5];
/** Atlas regions (u0, u1) of the lettering (engine/textures.ts `vehicle_decals`). */
const PD: [number, number] = [0.067, 0.367];
const FD: [number, number] = [0.367, 0.667];
const AMB: [number, number] = [0.667, 1];

function plain(g: BufferGeometry): BufferGeometry {
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, PLAIN[0], PLAIN[1]);
  return g;
}

const solid = (g: BufferGeometry, color: string): BufferGeometry =>
  plain(paint(g, color));

const box = (
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  color: string,
): BufferGeometry => solid(new BoxGeometry(w, h, d).translate(x, y, z), color);

/** Lettering plate on both sides (z = +/-`z`), showing atlas region `reg`; the text reads left to right from outside. */
function decal(
  reg: [number, number],
  w: number,
  h: number,
  x: number,
  y: number,
  z: number,
): BufferGeometry[] {
  return [1, -1].map((side) => {
    const g = new PlaneGeometry(w, h);
    const uv = g.getAttribute('uv');
    for (let i = 0; i < uv.count; i++)
      uv.setXY(i, reg[0] + uv.getX(i) * (reg[1] - reg[0]), uv.getY(i));
    if (side < 0) g.rotateY(Math.PI);
    return paint(g.translate(x, y, z * side), '#ffffff');
  });
}

const wheel = (r: number, w: number, x: number, z: number): BufferGeometry =>
  solid(
    new CylinderGeometry(r, r, w, 9).rotateX(Math.PI / 2).translate(x, r, z),
    '#1b1b1d',
  );

/** Paints of the modern models and of the old (boxy, Yugo-style) ones. */
const PAINTS = [
  '#2a2c31',
  '#e9eaec',
  '#9ea3a9',
  '#27406b',
  '#8c1f23',
  '#5c6066',
  '#2f4a3a',
  '#c8b99a',
  '#1f2a38',
  '#b5b8bd',
  '#6b2f2a',
  '#3a3d42',
];
const OLD_PAINTS = [
  '#e9eaec',
  '#b3231f',
  '#2d5f9a',
  '#e3c13f',
  '#c8b99a',
  '#3f6b45',
  '#9a9ea4',
  '#2a2c31',
  '#8a4a2a',
];

/**
 * Parked-car variants, one per model (`street-car-models.ts` order): the five old ones first, then the modern ones.
 * Variants 0..STREET_CAR_COUNT-1 are a model in a seeded paint; `STREET_CAR_MIX` is the pick list for street dressing
 * (common cars repeat, sports cars and pickups are rare). `FIXED_CARS` are cars a map places on purpose.
 */
export const STREET_CAR_MIX: number[] = [
  0,
  0,
  1,
  1,
  2,
  3,
  3,
  4, // old
  5,
  5,
  5,
  8,
  9,
  9,
  12,
  12,
  12,
  13,
  13,
  13,
  14,
  14, // hatch, minivan?, suv, compact, sedan, wagon
  10,
  10,
  6,
  7,
  11, // coupe, pickup, sport, offroad
];
const FIXED_CARS: [number, string][] = [
  [5, '#e9eaec'],
  [13, '#23262b'],
  [8, '#eceeef'],
];
/** First variant of `FIXED_CARS`: the white hatch at a Petralica house, then the dark sedan and the white van of the Vodno hotel. */
export const STREET_CAR_FIXED = STREET_CAR_COUNT;

const finish = (parts: BufferGeometry[]) => ({
  parts: [{ geometry: merge(parts), material: getMaterial('vehicle') }],
});

const carPaint = (m: StreetCarShape, seed: number, variant: number): string => {
  const list = m.old ? OLD_PAINTS : PAINTS;
  return list[(variant * 7 + new Rng(seed).int(0, 3)) % list.length];
};

export const streetCar: AssetBuilder = ({ seed, variant, lod }) => {
  const fixed = FIXED_CARS[variant - STREET_CAR_FIXED];
  const index = fixed ? fixed[0] : variant % STREET_CAR_COUNT;
  const m = streetCarModel(index, lod);
  return finish([m.geometry(fixed ? fixed[1] : carPaint(m, seed, variant))]);
};

/** Door height band of a model (m): where the lettering / stripes of the taxi and the police car go. */
const DOOR_Y = [0.5, 0.95];

/** Yellow cab (the sedan) with a roof sign and a black stripe along the doors. */
export const taxi: AssetBuilder = ({ lod }) => {
  const m = streetCarModel(SEDAN, lod);
  const parts = [m.geometry('#f1b516')];
  if (lod === 0) {
    parts.push(box(0.5, 0.17, 0.26, m.roofX, m.height + 0.075, 0, '#f6e7b0'));
    for (const side of [1, -1])
      parts.push(
        box(
          2.4,
          0.07,
          0.01,
          m.roofX - 0.1,
          0.7,
          side * (m.sideZ + 0.01),
          '#1a1a1a',
        ),
      );
  }
  return finish(parts);
};

/** Patrol car: white sedan, navy band, roof light bar and "POLICE" on both front doors. */
export const policeCar: AssetBuilder = ({ lod }) => {
  const m = streetCarModel(SEDAN, lod);
  const parts = [m.geometry('#f1f2f2')];
  const z = m.sideZ + 0.012;
  if (lod === 0) {
    for (const side of [1, -1])
      parts.push(
        box(3.4, 0.14, 0.012, 0, DOOR_Y[0] + 0.14, side * z, '#14306b'),
      );
    const top = m.height;
    parts.push(box(0.9, 0.09, 0.34, m.roofX, top + 0.045, 0, '#222428'));
    parts.push(box(0.4, 0.1, 0.32, m.roofX, top + 0.095, 0.14, '#d3202a'));
    parts.push(box(0.4, 0.1, 0.32, m.roofX, top + 0.095, -0.14, '#2a5fd6'));
    parts.push(...decal(PD, 1.2, 0.3, 0, DOOR_Y[0] + 0.04, z + 0.025));
  } else
    parts.push(
      box(3.4, 0.14, m.sideZ * 2 + 0.02, 0, DOOR_Y[0] + 0.14, 0, '#14306b'),
    );
  return finish(parts);
};

/** Fire engine: red cab and body, white stripe, roof ladder, "FIRE DEPT" on the sides. */
export const fireTruck: AssetBuilder = ({ lod }) => {
  const red = '#b3121a';
  const parts: BufferGeometry[] = [
    // Body (rear compartments) and cab.
    box(6.2, 1.9, 2.5, -1.2, 1.5, 0, red),
    box(2.4, 2.25, 2.5, 3.1, 1.68, 0, red),
    box(8.6, 0.5, 2.3, 0, 0.55, 0, '#1d1d20'),
  ];
  if (lod === 0) {
    // Cab glass, side windows.
    parts.push(box(0.04, 0.85, 2.1, 4.31, 2.2, 0, '#1b232b'));
    for (const z of [1.26, -1.26])
      parts.push(box(1.4, 0.7, 0.03, 3.4, 2.2, z, '#1b232b'));
    // White stripe + roller doors.
    for (const z of [1.26, -1.26]) {
      parts.push(box(8.5, 0.16, 0.025, 0, 1.55, z, '#f2f0e8'));
      for (const x of [-3.2, -1.9, -0.6, 0.7])
        parts.push(box(1.1, 1.0, 0.025, x, 1.0 + 0.45, z, '#8d9096'));
    }
    // Roof ladder, light bar, bumper.
    for (const z of [0.35, -0.35])
      parts.push(box(6.0, 0.08, 0.08, -1.2, 2.55, z, '#b8bcc2'));
    parts.push(box(6.0, 0.05, 0.7, -1.2, 2.5, 0, '#8d9096'));
    parts.push(box(0.5, 0.13, 1.7, 3.4, 2.88, 0, '#d3202a'));
    parts.push(box(0.2, 0.3, 2.5, 4.35, 0.62, 0, '#d9dbe0'));
    for (const z of [0.8, -0.8])
      parts.push(box(0.05, 0.16, 0.34, 4.34, 1.1, z, '#f4f0d8'));
    // Wheels: front axle + a tandem rear.
    for (const x of [3.2, -0.7, -2.6])
      for (const z of [1.02, -1.02]) parts.push(wheel(0.55, 0.4, x, z));
    parts.push(...decal(FD, 2.7, 0.675, -1.6, 2.1, 1.264));
  }
  return finish(parts);
};

/** Ambulance: white van cab with a box body, red stripe, light bar, "FIRE DEPT" + "AMBULANCE" on the box sides. */
export const ambulance: AssetBuilder = ({ lod }) => {
  const white = '#f3f3f0';
  const parts: BufferGeometry[] = [
    // Box body (rear 4.1 m), cab (front 2.2 m), chassis.
    box(4.1, 2.3, 2.3, -1.05, 1.6, 0, white),
    box(2.2, 1.55, 2.1, 2.1, 1.22, 0, white),
    box(6.3, 0.45, 2.0, 0, 0.5, 0, '#1d1d20'),
  ];
  if (lod === 0) {
    // Cab glass + bonnet step, side windows.
    parts.push(box(0.04, 0.7, 1.9, 1.02, 1.75, 0, '#1b232b'));
    parts.push(box(1.0, 0.25, 2.0, 2.7, 1.05, 0, white));
    for (const z of [1.06, -1.06])
      parts.push(box(1.0, 0.55, 0.03, 1.5, 1.6, z, '#1b232b'));
    // Red stripe along both sides and across the rear, blue band under it.
    for (const z of [1.16, -1.16]) {
      parts.push(box(4.1, 0.22, 0.025, -1.05, 1.15, z, '#c8161d'));
      parts.push(box(4.1, 0.08, 0.025, -1.05, 0.98, z, '#1f3f8f'));
    }
    parts.push(box(0.025, 0.22, 2.3, -3.1, 1.15, 0, '#c8161d'));
    // Rear doors (seam), light bar, headlights / tail lights, mirrors.
    parts.push(box(0.03, 1.7, 0.04, -3.11, 1.7, 0, '#9a9ca0'));
    parts.push(box(0.5, 0.14, 1.9, -0.2, 2.82, 0, '#c8161d'));
    parts.push(box(0.16, 0.1, 0.5, -0.2, 2.9, 0.7, '#d9dde3'));
    parts.push(box(0.16, 0.1, 0.5, -0.2, 2.9, -0.7, '#d9dde3'));
    for (const z of [0.75, -0.75]) {
      parts.push(box(0.05, 0.22, 0.4, 3.21, 0.95, z, '#f4f0d8'));
      parts.push(box(0.05, 0.3, 0.3, -3.11, 0.9, z, '#a31a1a'));
    }
    for (const z of [1.2, -1.2])
      parts.push(box(0.12, 0.2, 0.08, 1.4, 1.45, z, '#2a2b2e'));
    // Wheels: front axle + a twin-tyre rear.
    for (const x of [2.1, -1.9])
      for (const z of [0.98, -0.98]) parts.push(wheel(0.42, 0.3, x, z));
    parts.push(...decal(FD, 1.3, 0.33, -2.3, 2.2, 1.154));
    parts.push(...decal(AMB, 2.6, 0.33, 0.0, 1.75, 1.154));
  }
  return finish(parts);
};
