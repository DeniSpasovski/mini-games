import {
  BufferAttribute,
  BufferGeometry,
  Color,
  LatheGeometry,
  Vector2,
} from 'three';
import type { AssetBuilder } from '../types';
import {
  SIMREADY_SERVICE,
  type SimreadyModelData,
} from './simready-service.data';
import { getMaterial } from '../../engine/materials';
import { merge } from '../../engine/geo';
import { finish, solid } from './vehicles';

/**
 * Service-park kit from NVIDIA SimReady Assets (CC BY 4.0; scripts/props/bake-simready.py): the tool chest, tyre rack
 * and floor jack as scanned shapes coloured per part, in the `vehicle` material like the rest of the kit (plain faces
 * on the decals atlas' white corner). All face +Z with the origin on the ground under their middle.
 */

/** u / v of the plain-white corner of the decals atlas (vehicles.ts `PLAIN`). */
const PLAIN = [0.03, 0.5];
/** Every loaded baked group (`bake-simready.py <group>`), by prop name: the service group at once, the others by `loadSimready`. */
const SIMREADY_MODELS: Record<string, SimreadyModelData> = {
  ...SIMREADY_SERVICE,
};
const GROUPS = {
  park: async () => (await import('./simready-park.data')).SIMREADY_PARK,
  yard: async () => (await import('./simready-yard.data')).SIMREADY_YARD,
  village: async () =>
    (await import('./simready-village.data')).SIMREADY_VILLAGE,
  forest: async () => (await import('./simready-forest.data')).SIMREADY_FOREST,
};
export type SimreadyGroup = keyof typeof GROUPS;
const loadedGroups = new Map<SimreadyGroup, Promise<void>>();

/**
 * Fetch the baked models of these groups (their own chunks, kept out of the game script) before anything builds their
 * props: `loadMap` does it for a map's stages, the asset debugger for every prop.
 */
export async function loadSimready(...groups: SimreadyGroup[]): Promise<void> {
  await Promise.all(
    groups.map((g) => {
      let p = loadedGroups.get(g);
      if (!p) {
        p = GROUPS[g]().then((models) => {
          Object.assign(SIMREADY_MODELS, models);
        });
        loadedGroups.set(g, p);
      }
      return p;
    }),
  );
}

const modelData = (name: string): SimreadyModelData => {
  const data = SIMREADY_MODELS[name];
  if (!data) throw new Error(`SimReady model "${name}": group not loaded`);
  return data;
};
const decoded = new Map<string, BufferGeometry>();

/** Bounding size (m) of model `name`: width (x), height (y), depth (z). */
export const modelSize = (name: string): [number, number, number] =>
  modelData(name).size;

/** Level `lod` of model `name` (the last level past its end), non-indexed with linear vertex colours; a fresh copy. */
function model(name: string, lod: number): BufferGeometry {
  const key = `${name}:${lod}`;
  const hit = decoded.get(key);
  if (hit) return hit.clone();
  const lods = modelData(name).lods;
  const bin = Uint8Array.from(atob(lods[Math.min(lod, lods.length - 1)]), (c) =>
    c.charCodeAt(0),
  );
  const dv = new DataView(bin.buffer);
  const n = dv.getUint16(0, true);
  const head = dv.getUint16(2, true);
  // Position unit: 1 / 8192 m, halved per shift step (models reaching past 4 m from the origin).
  const unit = 8192 >> (head & 0xff);
  // Bit 8: a textured group (the forest debris) packs its atlas uv per vertex too.
  const textured = (head & 0x100) !== 0;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const uvs = new Float32Array(n * 2);
  const lin = (v: number) =>
    v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  let o = 4;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++)
      pos[i * 3 + c] = dv.getInt16(o + c * 2, true) / unit;
    o += 6;
    for (let c = 0; c < 3; c++) nor[i * 3 + c] = dv.getInt8(o + c) / 127;
    o += 3;
    for (let c = 0; c < 3; c++) col[i * 3 + c] = lin(dv.getUint8(o + c) / 255);
    o += 3;
    if (textured) {
      for (let c = 0; c < 2; c++)
        uvs[i * 2 + c] = dv.getUint16(o + c * 2, true) / 65535;
      o += 4;
    }
  }
  const idx = new Uint16Array((bin.length - o) / 2);
  for (let k = 0; k < idx.length; k++) idx[k] = dv.getUint16(o + k * 2, true);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('normal', new BufferAttribute(nor, 3));
  g.setAttribute('color', new BufferAttribute(col, 3));
  if (textured) g.setAttribute('uv', new BufferAttribute(uvs, 2));
  g.setIndex(new BufferAttribute(idx, 1));
  const flat = g.toNonIndexed();
  if (!textured) {
    const uv = new Float32Array(flat.getAttribute('position').count * 2);
    for (let i = 0; i < uv.length; i += 2) uv.set(PLAIN, i);
    flat.setAttribute('uv', new BufferAttribute(uv, 2));
  }
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

/** Poly Haven models (CC0) in the same bake: slatted bistro table with a folding chair each side (+Z / -Z), portable generator. */
export const tableChairs = plain('table_chairs');
export const generator = plain('generator');

/** Caged bulkhead lamp (Poly Haven, CC0) on a retaining wall: back on the wall face (z = 0), its middle at 3.6 m, lens to +Z. */
export const wallLamp: AssetBuilder = ({ lod }) => {
  const [, h, d] = modelSize('wall_lamp');
  return finish([model('wall_lamp', lod).translate(0, 3.6 - h / 2, d / 2)]);
};

/**
 * Wooden distribution pole, 10 m, with a steel cross arm along Z and three insulators each way along the line, jumpers
 * between them (Poly Haven kit, CC0): the wires (power.ts `POLE_WIRES`) meet at the insulators' height.
 */
export const powerPole = plain('power_pole');

/** Steel jerrycans (Poly Haven, CC0): one, or two side by side (variant). */
export const jerrycan: AssetBuilder = ({ variant, lod }) => {
  const n = 1 + (variant % 2);
  const [w] = modelSize('jerrycan');
  return finish(
    Array.from({ length: n }, (_, i) =>
      model('jerrycan', lod).translate((i - (n - 1) / 2) * (w + 0.04), 0, 0),
    ),
  );
};

/** A pair of axle stands with a small red pail beside them (works bay floor). */
export const jackStands: AssetBuilder = ({ lod }) =>
  finish([
    model('jack_stand', lod).translate(-0.3, 0, 0),
    model('jack_stand', lod).rotateY(0.6).translate(0.15, 0, 0.05),
    model('pail', lod).translate(0.55, 0, 0.1),
  ]);

/** Top (m) of the stillage's inner base rails, this far either side of the middle (the bake); tyres per variant. */
const STILLAGE_RAIL_Y = 0.153;
const STILLAGE_RAIL_Z = 0.2;
const STILLAGE_TYRES = [6, 4, 2];

/** Open steel tyre stillage (SimReady) with road tyres standing in a row on its base rails (variant = how full). */
export const tyreStillage: AssetBuilder = ({ variant, lod }) => {
  const parts = [model('tyre_rack_b', lod)];
  const n = STILLAGE_TYRES[variant % STILLAGE_TYRES.length];
  // Each tyre sits in the cradle between the two inner rails.
  const y =
    STILLAGE_RAIL_Y +
    Math.sqrt(TYRE_R * TYRE_R - STILLAGE_RAIL_Z * STILLAGE_RAIL_Z);
  for (let i = 0; i < n; i++) {
    const x = (i - 2.5) * (TYRE_W + 0.12);
    for (const g of tyreOnRim(lod)) parts.push(g.translate(x, y, 0));
  }
  return finish(parts);
};

/** Village street furniture (Poly Haven, CC0): roadside utility cabinet (variant 0 narrow, 1 wide). */
export const utilityBox: AssetBuilder = ({ variant, lod }) =>
  finish([model(variant % 2 ? 'utility_box_wide' : 'utility_box', lod)]);
/** Galvanised dustbin, its lid leaning against it. */
export const streetBin = plain('bin');
/** Slatted bench with a back rest, seat towards +Z. */
export const bench = plain('bench');
/** Wooden picnic table with its two benches, the long side along X. */
export const picnicTable = plain('picnic_table');

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

/**
 * Forest-floor debris (Poly Haven scans, CC0) in their own textures (the `debris` material's atlas), sunk this far (m):
 * the scans' litter skirt / underside reaches below their own ground, and a few cm more keep the edge under the
 * terrain on a slope.
 */
const FOREST_SINK: Record<string, number> = {
  stump_a: 0.2,
  stump_b: 0.24,
  log: 0.05,
  trunk: 0.36,
  branches: 0.03,
  roots_a: 0.03,
  roots_b: 0.03,
};
const sunk = (name: string, lod: number) =>
  model(name, lod).translate(0, -FOREST_SINK[name], 0);
/** Debris parts in the `debris` material (the group's colour + normal atlas, matt). */
const debris = (parts: BufferGeometry[]) => ({
  parts: [{ geometry: merge(parts), material: getMaterial('debris') }],
});

/** Sawn / rotten tree stump in its litter skirt (variant 0 or 1). */
export const forestStump: AssetBuilder = ({ variant, lod }) =>
  debris([sunk(variant % 2 ? 'stump_b' : 'stump_a', lod)]);
/** Thin dead log, 3 m along X. */
export const forestLog: AssetBuilder = ({ lod }) => debris([sunk('log', lod)]);
/** Heavy fallen trunk with split bark and a broken branch stub, 4 m along X. */
export const forestTrunk: AssetBuilder = ({ lod }) =>
  debris([sunk('trunk', lod)]);
/** Three dry branches on the ground (variant 0), or a small pile: the three again on top, turned (variant 1). */
export const forestBranches: AssetBuilder = ({ variant, lod }) =>
  debris(
    variant % 2
      ? [
          sunk('branches', lod),
          sunk('branches', lod).rotateY(1.9).translate(0.1, 0.06, -0.05),
        ]
      : [sunk('branches', lod)],
  );
/** Patch of exposed pine roots in dark forest soil, about 1.7 x 0.9 m (variant 0 or 1). */
export const forestRoots: AssetBuilder = ({ variant, lod }) =>
  debris([sunk(variant % 2 ? 'roots_b' : 'roots_a', lod)]);
