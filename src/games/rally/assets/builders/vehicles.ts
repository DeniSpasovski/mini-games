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
  serviceVehicleModel,
  streetCarIndex,
  streetCarMaterial,
  streetCarModel,
  SEDAN,
  STREET_CAR_COUNT,
} from './street-car-models';

/**
 * Street vehicles for city maps: parked cars (`street_car`: the CC BY pack models in `street-car-models.ts` with their
 * own textures, in a few paints), the yellow `taxi`, the `police_car` (white, navy band, light bar, "POLICE" on the
 * doors), the `fire_truck` (the pack's box truck in red with a white stripe, roof ladder and "FIRE DEPT" on the sides) and
 * the `ambulance` (its high-roof van in white, red stripe, "FIRE DEPT" + "AMBULANCE" on the sides). The lettering is
 * generic words on purpose (no real agency names, badges or exact liveries). Every vehicle is one draw call in the shared
 * `streetCarMaterial` (atlas + paint tint), its add-ons (taxi sign, light bar, ladder, stripes, lettering) a second one in
 * the `vehicle` material (vertex colour paint + the decals atlas). Models face +X with the origin on the ground under
 * their middle. A car is ~6-8k triangles up close, ~2k at LOD 1, ~1k at LOD 2.
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

export const solid = (g: BufferGeometry, color: string): BufferGeometry =>
  plain(paint(g, color));

export const box = (
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

export const wheel = (
  r: number,
  w: number,
  x: number,
  z: number,
): BufferGeometry =>
  solid(
    new CylinderGeometry(r, r, w, 9).rotateX(Math.PI / 2).translate(x, r, z),
    '#1b1b1d',
  );

/** Paints of the parked cars. */
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
/**
 * Parked-car variants, one per model (`street-car-models.ts` order). Variants 0..STREET_CAR_COUNT-1 are a model in a seeded
 * paint; `STREET_CAR_MIX` is the pick list for street dressing (common cars repeat, sports cars and pickups are rare).
 * `FIXED_CARS` are cars a map places on purpose.
 */
const MIX: [id: string, weight: number][] = [
  ['hatch', 3],
  ['minivan', 1],
  ['suv', 2],
  ['compact', 3],
  ['sedan', 3],
  ['wagon', 2],
  ['coupe', 2],
  ['pickup', 1],
  ['sport', 1],
  ['offroad', 1],
];
export const STREET_CAR_MIX: number[] = MIX.flatMap(([id, weight]) =>
  Array<number>(weight).fill(streetCarIndex(id)),
);
const FIXED_CARS: [number, string][] = [[streetCarIndex('hatch'), '#e9eaec']];
/** First variant of `FIXED_CARS` (the white hatch at a Petralica house). */
export const STREET_CAR_FIXED = STREET_CAR_COUNT;

export const finish = (parts: BufferGeometry[]) => ({
  parts: [{ geometry: merge(parts), material: getMaterial('vehicle') }],
});

/** A pack car with its add-ons (`extra`, may be empty) as a second part in the `vehicle` material. */
export const withExtras = (car: BufferGeometry, extra: BufferGeometry[]) => ({
  parts: [
    { geometry: car, material: streetCarMaterial() },
    ...(extra.length
      ? [{ geometry: merge(extra), material: getMaterial('vehicle') }]
      : []),
  ],
});

/** Add-ons (roof sign, light bar, lettering) are drawn up to this LOD. */
export const EXTRAS_LOD = 1;

const carPaint = (seed: number, variant: number): string =>
  PAINTS[(variant * 7 + new Rng(seed).int(0, 3)) % PAINTS.length];

export const streetCar: AssetBuilder = ({ seed, variant, lod }) => {
  const fixed = FIXED_CARS[variant - STREET_CAR_FIXED];
  const index = fixed ? fixed[0] : variant % STREET_CAR_COUNT;
  const m = streetCarModel(index, lod);
  return withExtras(m.geometry(fixed ? fixed[1] : carPaint(seed, variant)), []);
};

/** Door height band of a model (m): where the lettering / stripes of the taxi and the police car go. */
const DOOR_Y = [0.5, 0.95];

/** Yellow cab (the sedan) with a roof sign and a black stripe along the doors. */
export const taxi: AssetBuilder = ({ lod }) => {
  const m = streetCarModel(SEDAN, lod);
  const parts: BufferGeometry[] = [];
  if (lod <= EXTRAS_LOD) {
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
  return withExtras(m.geometry('#f1b516'), parts);
};

/** Patrol car: white sedan, navy band, roof light bar and "POLICE" on both front doors. */
export const policeCar: AssetBuilder = ({ lod }) => {
  const m = streetCarModel(SEDAN, lod);
  const parts: BufferGeometry[] = [];
  const z = m.sideZ + 0.012;
  if (lod <= EXTRAS_LOD) {
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
  return withExtras(m.geometry('#f1f2f2'), parts);
};

/** Fire engine: the box truck model (assets/builders/street-car-models.ts) in red with a white stripe, roof ladder, light bar and "FIRE DEPT" on the box sides. */
export const fireTruck: AssetBuilder = ({ lod }) => {
  const parts: BufferGeometry[] = [];
  if (lod <= EXTRAS_LOD) {
    const z = 1.125;
    for (const side of [1, -1])
      parts.push(box(4.4, 0.2, 0.02, -1.65, 1.45, side * z, '#f2f0e8'));
    // Roof ladder: two rails over a rung plate, a light bar on the cab roof.
    for (const rail of [0.4, -0.4])
      parts.push(box(4.4, 0.07, 0.07, -1.65, 3.12, rail, '#b8bcc2'));
    parts.push(box(4.4, 0.04, 0.8, -1.65, 3.09, 0, '#8d9096'));
    parts.push(box(0.4, 0.12, 1.4, 3.05, 2.44, 0, '#d3202a'));
    parts.push(...decal(FD, 1.8, 0.4, -1.65, 2.2, z + 0.012));
  }
  return withExtras(
    serviceVehicleModel('box_truck', lod).geometry('#b3121a'),
    parts,
  );
};

/** Ambulance: the high-roof van model in white with a red stripe, light bar, "FIRE DEPT" + "AMBULANCE" on the sides. */
export const ambulance: AssetBuilder = ({ lod }) => {
  const m = serviceVehicleModel('van_high', lod);
  const parts: BufferGeometry[] = [];
  if (lod <= EXTRAS_LOD) {
    const z = m.sideZ + 0.012;
    for (const side of [1, -1]) {
      parts.push(box(3.7, 0.22, 0.02, -0.9, 1.15, side * z, '#c8161d'));
      parts.push(box(3.7, 0.08, 0.02, -0.9, 0.97, side * z, '#1f3f8f'));
    }
    parts.push(box(0.5, 0.14, 1.4, 0, m.height + 0.07, 0, '#c8161d'));
    parts.push(...decal(AMB, 2.4, 0.33, -1.2, 1.72, z + 0.012));
    parts.push(...decal(FD, 1.2, 0.33, -1.2, 2.15, z + 0.012));
  }
  return withExtras(m.geometry('#f3f3f0'), parts);
};
