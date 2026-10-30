import {
  BufferAttribute,
  BufferGeometry,
  Color,
  LatheGeometry,
  Vector2,
} from 'three';
import type { AssetBuilder } from '../types';
import { SIMREADY_PARK } from './simready-park.data';
import {
  SIMREADY_SERVICE,
  type SimreadyModelData,
} from './simready-service.data';
import { SIMREADY_YARD } from './simready-yard.data';
import { finish, solid } from './vehicles';

/**
 * Service-park kit from NVIDIA SimReady Assets (CC BY 4.0; scripts/props/bake-simready.py): the tool chest, tyre rack
 * and floor jack as scanned shapes coloured per part, in the `vehicle` material like the rest of the kit (plain faces
 * on the decals atlas' white corner). All face +Z with the origin on the ground under their middle.
 */

/** u / v of the plain-white corner of the decals atlas (vehicles.ts `PLAIN`). */
const PLAIN = [0.03, 0.5];
/** Every baked group (`bake-simready.py <group>`), by prop name. */
const SIMREADY_MODELS: Record<string, SimreadyModelData> = {
  ...SIMREADY_SERVICE,
  ...SIMREADY_PARK,
  ...SIMREADY_YARD,
};
const decoded = new Map<string, BufferGeometry>();

/** Bounding size (m) of model `name`: width (x), height (y), depth (z). */
export const modelSize = (name: string): [number, number, number] =>
  SIMREADY_MODELS[name].size;

/** Level `lod` of model `name` (the last level past its end), non-indexed with linear vertex colours; a fresh copy. */
function model(name: string, lod: number): BufferGeometry {
  const key = `${name}:${lod}`;
  const hit = decoded.get(key);
  if (hit) return hit.clone();
  const lods = SIMREADY_MODELS[name].lods;
  const bin = Uint8Array.from(atob(lods[Math.min(lod, lods.length - 1)]), (c) =>
    c.charCodeAt(0),
  );
  const dv = new DataView(bin.buffer);
  const n = dv.getUint16(0, true);
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const lin = (v: number) =>
    v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  let o = 4;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++)
      pos[i * 3 + c] = dv.getInt16(o + c * 2, true) / 8192;
    o += 6;
    for (let c = 0; c < 3; c++) nor[i * 3 + c] = dv.getInt8(o + c) / 127;
    o += 3;
    for (let c = 0; c < 3; c++) col[i * 3 + c] = lin(dv.getUint8(o + c) / 255);
    o += 3;
  }
  const idx = new Uint16Array((bin.length - o) / 2);
  for (let k = 0; k < idx.length; k++) idx[k] = dv.getUint16(o + k * 2, true);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('normal', new BufferAttribute(nor, 3));
  g.setAttribute('color', new BufferAttribute(col, 3));
  g.setIndex(new BufferAttribute(idx, 1));
  const flat = g.toNonIndexed();
  const uv = new Float32Array(flat.getAttribute('position').count * 2);
  for (let i = 0; i < uv.length; i += 2) uv.set(PLAIN, i);
  flat.setAttribute('uv', new BufferAttribute(uv, 2));
  decoded.set(key, flat);
  return flat.clone();
}

/** Repaint the vertices of one baked colour (sRGB bytes) in `to`. */
function recolour(
  g: BufferGeometry,
  from: [number, number, number],
  to: string,
): void {
  const want = new Color().setRGB(from[0] / 255, from[1] / 255, from[2] / 255);
  want.convertSRGBToLinear();
  const c = new Color(to);
  const col = g.getAttribute('color');
  for (let i = 0; i < col.count; i++)
    if (
      Math.abs(col.getX(i) - want.r) < 0.004 &&
      Math.abs(col.getY(i) - want.g) < 0.004 &&
      Math.abs(col.getZ(i) - want.b) < 0.004
    )
      col.setXYZ(i, c.r, c.g, c.b);
}

/** The chest's painted body and its drawer strips in the bake (`SIMREADY_MODELS.tool_chest` colours). */
const CHEST_BODY: [number, number, number] = [67, 67, 67];
const CHEST_STRIP: [number, number, number] = [0, 138, 255];

/** Rolling tool chest, top box on a cabinet (variant = body colour; the drawer strips are bright steel). */
export const toolChest: AssetBuilder = ({ variant, lod }) => {
  const g = model('tool_chest', lod);
  recolour(
    g,
    CHEST_BODY,
    ['#c8321e', '#2a5fc0', '#3b3f46', '#e0a020'][variant % 4],
  );
  recolour(g, CHEST_STRIP, '#c8cbd0');
  return finish([g]);
};

/** Low-profile floor jack, handle up. */
export const floorJack: AssetBuilder = ({ lod }) =>
  finish([model('floor_jack', lod)]);

/** Rack cradles (m): the front and back rails of each shelf are this far either side of the middle, at these heights. */
const RAIL_Z = 0.24;
const SHELVES = [0.2, 0.8];
export const TYRE_R = 0.3;
export const TYRE_W = 0.205;
/** Tyres per shelf (lower, upper) by variant: full, half, a few. */
const FILL: [number, number][] = [
  [4, 4],
  [4, 2],
  [3, 0],
];

/** A rally tyre (axis along X): sidewalls rounding into the tread, the bead at the rim. */
function tyre(seg: number): BufferGeometry {
  const h = TYRE_W / 2;
  const profile = [
    [0.2, -h + 0.01],
    [0.27, -h],
    [TYRE_R - 0.005, -h + 0.015],
    [TYRE_R, -h + 0.04],
    [TYRE_R, h - 0.04],
    [TYRE_R - 0.005, h - 0.015],
    [0.27, h],
    [0.2, h - 0.01],
  ].map(([r, y]) => new Vector2(r, y));
  return new LatheGeometry(profile, seg).rotateZ(Math.PI / 2);
}

/** An alloy rim (axis along X): a barrel with both faces dished in to a small hub. */
function rim(seg: number): BufferGeometry {
  const h = (TYRE_W - 0.05) / 2;
  const face = [
    [0, 0.04],
    [0.05, 0.04],
    [0.065, 0.06],
    [0.17, 0.065],
    [0.2, h],
  ];
  const profile = [
    ...face.map(([r, y]) => new Vector2(r, -y)),
    ...face.reverse().map(([r, y]) => new Vector2(r, y)),
  ];
  return new LatheGeometry(profile, seg).rotateZ(Math.PI / 2);
}

/** A rally tyre on its alloy rim (axis along X, origin in the middle): the tyres of the rack, the stack and the trailer. */
export function tyreOnRim(lod: number): BufferGeometry[] {
  return [
    solid(tyre(lod ? 14 : 24), '#1c1c1e'),
    // The alloy rim, set in from the sidewalls, its faces dished towards the hub.
    solid(rim(lod ? 8 : 16), '#c4c8ce'),
  ];
}

/** Wire tyre rack with rally tyres standing in its two cradles (variant = how full, `FILL`). */
export const tyreRack: AssetBuilder = ({ variant, lod }) => {
  const parts = [model('tyre_rack', lod)];
  // A tyre in a cradle sits with its middle this far above the rails.
  const lift = Math.sqrt(TYRE_R * TYRE_R - RAIL_Z * RAIL_Z);
  FILL[variant % FILL.length].forEach((n, s) => {
    for (let i = 0; i < n; i++) {
      const x = (i - 1.5) * (TYRE_W + 0.06);
      const y = SHELVES[s] + lift;
      for (const g of tyreOnRim(lod)) parts.push(g.translate(x, y, 0));
    }
  });
  return finish(parts);
};

/** A baked model as it is (the single-variant props of the park, yard and roadside kits). */
const plain =
  (name: string): AssetBuilder =>
  ({ lod }) =>
    finish([model(name, lod)]);

export const tripodLight = plain('tripod_light');
export const wheelbarrow = plain('wheelbarrow');
export const handTruck = plain('hand_truck');
export const stepLadder = plain('step_ladder');
export const wheelieBin = plain('wheelie_bin');
export const ibcTank = plain('ibc_tank');
export const crate = plain('crate');
export const forklift = plain('forklift');
export const palletJack = plain('pallet_jack');

/** Fire extinguisher standing in its orange cone stand. */
export const extinguisherStand = plain('extinguisher_stand');

const PALLETS = ['pallet_euro', 'pallet_block', 'pallet_plain'];
/** Wooden pallets, one stack: variant % 3 = style, variant / 3 = pallets in the stack minus one (1-4). */
export const palletStack: AssetBuilder = ({ variant, lod }) => {
  const name = PALLETS[variant % 3];
  const rise = modelSize(name)[1];
  const n = 1 + (Math.floor(variant / 3) % 4);
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < n; i++)
    parts.push(model(name, lod).translate(0, i * rise, 0));
  return finish(parts);
};

const DRUMS = ['drum_steel', 'drum_blue', 'barrel_blue'];
/** Drums and barrels: steel drum, small blue drum, tall blue barrel (variant). */
export const drum: AssetBuilder = ({ variant, lod }) =>
  finish([model(DRUMS[variant % 3], lod)]);
