import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  SphereGeometry,
  type ColorRepresentation,
  Material,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AssetPart } from '../../../../assets/types';
import {
  serviceVehicleModel,
  streetCarIndex,
  streetCarModel,
  type StreetCarShape,
} from '../../../../assets/builders/street-car-models';
import { ORIGIN } from '../frame';
import {
  getLayout,
  VEHICLE_SIZE,
  type Placement,
  type VehicleKind,
} from '../layout';
import { standHeight, type Build } from './ctx';
import {
  truckData,
  truckMaps,
  truckPieces,
  type TruckModel,
} from './truck-models';
import { buildRigidBack, type Rigid } from './truck-backs';

/**
 * The parked vehicles of the lots. Cars and vans are the background models
 * (assets/builders/street-car-models.ts, a few per kind, scaled to the layout's footprint); the trucks are the baked
 * truck models (truck-models.ts) and the dump trucks. Drawn as instanced meshes, one per part (paint, cab paint, glass,
 * chrome, details), so a hundred vehicles cost a few dozen draw calls. Models face +x with the origin on the ground
 * under their middle (`centre` shifts the truck models, whose origin is over the rear axle).
 */

type Part = 'paint' | 'cab' | 'glass' | 'chrome' | 'detail';

/** One mesh of a model: a part (its material), drawn with a texture of the baked trucks or flat. */
interface Slot {
  part: Part;
  /** Key of a truck texture (`truck-models.data.ts`). */
  tex?: string;
}

const slotKey = (s: Slot): string => (s.tex ? `${s.part}|${s.tex}` : s.part);

/** Geometry collected per part (and texture), with vertex colours where there is no texture. */
class Pieces {
  private lists = new Map<string, { slot: Slot; list: BufferGeometry[] }>();

  private push(slot: Slot, g: BufferGeometry): void {
    const key = slotKey(slot);
    const entry = this.lists.get(key) ?? { slot, list: [] };
    entry.list.push(g);
    this.lists.set(key, entry);
  }

  add(
    part: Part,
    g: BufferGeometry,
    color: ColorRepresentation = '#ffffff',
  ): void {
    const flat = g.index ? g.toNonIndexed() : g.clone();
    for (const name of Object.keys(flat.attributes))
      if (name !== 'position' && name !== 'normal') flat.deleteAttribute(name);
    const c = new Color(color);
    const n = flat.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    flat.setAttribute('color', new BufferAttribute(col, 3));
    flat.clearGroups();
    this.push({ part }, flat);
  }

  /** A baked mesh (position, normal, colour or uv); `dx` shifts it along the vehicle. */
  addBaked(part: Part, g: BufferGeometry, dx = 0, tex?: string): void {
    const flat = g.index ? g.toNonIndexed() : g;
    for (const name of Object.keys(flat.attributes))
      if (!['position', 'normal', 'color', 'uv'].includes(name))
        flat.deleteAttribute(name);
    flat.translate(dx, 0, 0);
    flat.clearGroups();
    this.push({ part, tex }, flat);
  }

  /** Every piece of `other`, shifted `dx` along the vehicle. */
  append(other: Pieces, dx: number): void {
    for (const { slot, list } of other.lists.values())
      for (const g of list) this.addBaked(slot.part, g, dx, slot.tex);
  }

  /** Box from corner to corner (and its mirror image in z when `mirror`). */
  box(
    part: Part,
    a: number[],
    b: number[],
    color?: ColorRepresentation,
    mirror = false,
  ): void {
    const make = (a: number[], b: number[]) =>
      new BoxGeometry(
        Math.abs(b[0] - a[0]),
        Math.abs(b[1] - a[1]),
        Math.abs(b[2] - a[2]),
      ).translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    this.add(part, make(a, b), color);
    if (mirror)
      this.add(part, make([a[0], a[1], -a[2]], [b[0], b[1], -b[2]]), color);
  }

  /** The meshes of the model: one per part and texture. */
  slots(): Slot[] {
    return [...this.lists.values()].map((e) => e.slot);
  }

  geometry(slot: Slot): BufferGeometry | undefined {
    const list = this.lists.get(slotKey(slot))?.list;
    return list?.length ? mergeGeometries(list) : undefined;
  }
}

// ----- The materials: paint takes the instance colour -----

let materials: Record<Part, Material> | undefined;
const materialFor = (): Record<Part, Material> =>
  (materials ??= {
    paint: new MeshPhysicalMaterial({
      color: '#ffffff',
      metalness: 0.5,
      roughness: 0.34,
      clearcoat: 0.8,
      clearcoatRoughness: 0.12,
      envMapIntensity: 1.4,
    }),
    cab: new MeshPhysicalMaterial({
      color: '#ffffff',
      metalness: 0.4,
      roughness: 0.4,
      clearcoat: 0.5,
      clearcoatRoughness: 0.2,
    }),
    glass: new MeshStandardMaterial({
      color: '#22303a',
      metalness: 0.85,
      roughness: 0.06,
      envMapIntensity: 3,
    }),
    chrome: new MeshStandardMaterial({
      color: '#c8ced3',
      metalness: 0.95,
      roughness: 0.25,
    }),
    detail: new MeshStandardMaterial({
      vertexColors: true,
      metalness: 0.15,
      roughness: 0.68,
    }),
  });

const texturedMaterials = new Map<string, Material>();

/**
 * The material of a textured part (baked trucks). `cab` / `paint` take the instance colour where the texture's tint
 * mask is white (all of it without a mask): the texel's brightness stays, scaled so the panels' own brightness comes
 * out as the paint colour (from the vertex colours instead with `vertexColors`: a single mesh, not instances). `detail`
 * shows the texture as it is.
 */
const texturedMaterial = (slot: Slot, vertexColors = false): Material => {
  const key = vertexColors ? `${slotKey(slot)}|vc` : slotKey(slot);
  let made = texturedMaterials.get(key);
  if (made) return made;
  const t = truckMaps(slot.tex!);
  if (slot.part === 'detail') {
    made = new MeshStandardMaterial({
      map: t?.map,
      metalness: 0.15,
      roughness: 0.68,
    });
  } else {
    const paint = slot.part === 'paint';
    const m = new MeshPhysicalMaterial({
      map: t?.map,
      vertexColors,
      metalness: paint ? 0.5 : 0.4,
      roughness: paint ? 0.34 : 0.4,
      clearcoat: paint ? 0.8 : 0.5,
      clearcoatRoughness: paint ? 0.12 : 0.2,
      ...(paint ? { envMapIntensity: 1.4 } : {}),
    });
    const masked = !!t?.mask;
    m.onBeforeCompile = (shader, renderer) => {
      // The world shading's uniforms (fog, lights) come with the default hook (engine/world-shading.ts).
      Material.prototype.onBeforeCompile.call(m, shader, renderer);
      shader.uniforms.tintMask = { value: t?.mask ?? null };
      shader.uniforms.tintRef = { value: t?.ref ?? 1 };
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nuniform sampler2D tintMask;\nuniform float tintRef;',
        )
        // The instance colour is applied below, through the mask.
        .replace('#include <color_fragment>', '')
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          #ifdef USE_COLOR
          float tintK = ${masked ? 'texture2D( tintMask, vMapUv ).r' : '1.0'};
          float tintL = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ) / tintRef;
          diffuseColor.rgb = mix( diffuseColor.rgb, vColor.rgb * min( tintL, 1.35 ), tintK );
          #endif`,
        );
    };
    m.customProgramCacheKey = () => (masked ? 'truck-tint-mask' : 'truck-tint');
    made = m;
  }
  texturedMaterials.set(key, made);
  return made;
};

// ----- Trucks -----

/** A baked model's parts go into `p`, shifted `dx` along the vehicle; `skip` leaves parts out (by id). */
const baked = (
  p: Pieces,
  model: TruckModel,
  dx = 0,
  skip: readonly string[] = [],
): void => {
  for (const piece of truckPieces(model))
    if (!skip.includes(piece.id))
      p.addBaked(piece.role, piece.geometry, dx, piece.tex);
};

let tyreTemplates:
  Map<string, ReturnType<typeof truckPieces>[number]> | undefined;

/** A tyre of the baked trucks scaled to radius `r`, at (x, y, z), its outer face on `side` (+1 / -1 in z). */
const truckTyre = (
  p: Pieces,
  r: number,
  x: number,
  y: number,
  z: number,
  side: number,
): void => {
  tyreTemplates ??= new Map(truckPieces('tyre').map((t) => [t.id, t]));
  const t = tyreTemplates.get(side > 0 ? 'pos' : 'neg')!;
  const k = r / truckData('tyre').r!;
  p.addBaked(
    'detail',
    t.geometry.clone().scale(k, k, k).translate(x, y, z),
    0,
    t.tex,
  );
};

/** What sits on a dump truck's frame, from the back of its cab to its rear end. */
type Back = 'tipper' | 'flatbed' | 'vanbody' | 'tank';

const buildDump = (back: Back | Rigid): Pieces => {
  const p = new Pieces();
  // The model's own dumper is the tipper's back; the other backs replace it.
  baked(p, 'dump', 0, back === 'tipper' ? [] : ['dumper']);
  if (back === 'tipper') return p;
  const d = truckData('dump');
  const x0 = (d.rear ?? -3) + 0.05;
  const x1 = (d.cabBack ?? 1.5) - 0.12;
  const y0 = d.deck ?? 1.1;
  const hw = 1.2;
  const steel = '#8d9399';
  const dark = '#2d3136';
  const box = (
    part: Part,
    a: number[],
    b: number[],
    color?: string,
    mirror = false,
  ) => p.box(part, a, b, color, mirror);
  if (back === 'tow' || back === 'reefer') {
    buildRigidBack(p, back, { x0, x1, y0, hw, roof: 2.61, cabX: 2.45 });
    return p;
  }
  if (back === 'flatbed') {
    box('detail', [x0, y0, -hw], [x1, y0 + 0.14, hw], '#6a5a46'); // deck
    box(
      'paint',
      [x0, y0 + 0.14, hw - 0.06],
      [x1, y0 + 0.64, hw],
      undefined,
      true,
    );
    box('paint', [x0, y0 + 0.14, -hw], [x0 + 0.06, y0 + 0.64, hw]);
    box('paint', [x1 - 0.08, y0 + 0.14, -hw], [x1, y0 + 1.5, hw]); // headboard
    box(
      'detail',
      [x0 + 0.3, y0 + 0.14, -hw + 0.1],
      [x0 + 2.0, y0 + 1.3, hw - 0.1],
      '#a58b5d',
    ); // crates
    box(
      'detail',
      [x0 + 2.2, y0 + 0.14, -hw + 0.1],
      [x1 - 0.5, y0 + 0.9, hw - 0.1],
      '#b9a782',
    );
    for (const x of [x0 + 0.1, x0 + (x1 - x0) / 2, x1 - 0.2])
      box(
        'chrome',
        [x, y0 + 0.64, hw - 0.01],
        [x + 0.06, y0 + 0.72, hw + 0.03],
        undefined,
        true,
      );
  } else if (back === 'vanbody') {
    p.add(
      'paint',
      new BoxGeometry(x1 - x0, 2.5, hw * 2).translate(
        (x0 + x1) / 2,
        y0 + 1.37,
        0,
      ),
    );
    box(
      'detail',
      [x0 - 0.03, y0 + 0.2, -hw + 0.05],
      [x0, y0 + 2.4, hw - 0.05],
      '#ececea',
    ); // rear doors
    box('detail', [x0 - 0.04, y0 + 0.2, -0.015], [x0, y0 + 2.4, 0.015], dark);
    box(
      'chrome',
      [x0, y0 + 0.08, hw + 0.01],
      [x1, y0 + 0.18, hw + 0.05],
      undefined,
      true,
    );
    box(
      'chrome',
      [x0, y0 + 2.62, hw + 0.01],
      [x1, y0 + 2.72, hw + 0.05],
      undefined,
      true,
    );
    box(
      'detail',
      [x0 - 0.05, y0 + 0.3, 0.62],
      [x0 - 0.03, y0 + 0.5, 0.9],
      '#c8242b',
      true,
    );
  } else {
    const R = 1.05;
    const len = x1 - x0 - 0.5;
    const mid = (x0 + x1) / 2;
    const y = y0 + R + 0.2;
    p.add(
      'paint',
      new CylinderGeometry(R, R, len, 14)
        .rotateZ(Math.PI / 2)
        .translate(mid, y, 0),
    );
    for (const s of [1, -1])
      p.add(
        'paint',
        new SphereGeometry(R, 14, 5, 0, Math.PI * 2, 0, Math.PI / 2)
          .rotateZ((-s * Math.PI) / 2)
          .scale(0.3, 1, 1)
          .translate(mid + (s * len) / 2, y, 0),
      );
    for (const x of [mid - len / 3, mid + len / 3])
      box('detail', [x - 0.2, y0, -0.9], [x + 0.2, y - 0.7, 0.9], dark); // saddles
    box('detail', [x0, y0, -0.6], [x1, y0 + 0.2, 0.6], dark);
    box(
      'chrome',
      [mid - 1.5, y + R + 0.05, -0.3],
      [mid + 1.5, y + R + 0.1, 0.3],
    );
    box(
      'detail',
      [mid - 0.3, y + R, -0.3],
      [mid + 0.3, y + R + 0.2, 0.3],
      steel,
    ); // hatch
  }
  return p;
};

const buildTruck = (variant: 'box' | 'tractor' | 'tanker' | Rigid): Pieces => {
  const p = new Pieces();
  const dark = '#2d3136';
  const steel = '#8d9399';
  const amber = '#f39a1e';
  const red = '#c8242b';
  const box = (
    part: Part,
    a: number[],
    b: number[],
    color?: string,
    mirror = false,
  ) => p.box(part, a, b, color, mirror);

  if (variant === 'tractor') {
    baked(p, 'tractor');
    baked(p, 'trailer');
    return p;
  }

  if (variant === 'tanker') {
    baked(p, 'tractor');
    // The trailer's own chassis and axles (without its container), wearing a stainless tank on saddles: dished ends,
    // stiffener rings, three manholes, a rail along the top, a ladder and a valve cabinet at the rear, a blue stripe.
    baked(p, 'trailer', 0, ['container']);
    const front = 6.0;
    const rear = -8.3;
    const R = 1.12;
    const y = 1.46 + R;
    const len = front - rear - 2 * R * 0.3;
    const mid = (front + rear) / 2;
    p.add(
      'paint',
      new CylinderGeometry(R, R, len, 20)
        .rotateZ(Math.PI / 2)
        .translate(mid, y, 0),
    );
    for (const [x, s] of [
      [mid + len / 2, 1],
      [mid - len / 2, -1],
    ])
      p.add(
        'paint',
        new SphereGeometry(R, 20, 6, 0, Math.PI * 2, 0, Math.PI / 2)
          .rotateZ((-s * Math.PI) / 2)
          .scale(0.3, 1, 1)
          .translate(x, y, 0),
      );
    for (const x of [rear + 1.6, rear + 4.6, rear + 7.6, rear + 10.6])
      p.add(
        'chrome',
        new CylinderGeometry(R + 0.02, R + 0.02, 0.07, 20)
          .rotateZ(Math.PI / 2)
          .translate(x, y, 0),
      ); // stiffener rings
    box(
      'detail',
      [rear + 0.5, y - 0.1, R - 0.01],
      [front - 0.5, y + 0.1, R + 0.02],
      '#1f5fb4',
      true,
    );
    for (const x of [rear + 1.2, rear + 5.0, rear + 8.8, front - 1.0])
      box('detail', [x - 0.18, 1.28, -0.75], [x + 0.18, y - 0.7, 0.75], dark); // saddles
    for (const x of [rear + 2.4, mid, front - 2.4]) {
      p.add(
        'detail',
        new CylinderGeometry(0.3, 0.32, 0.12, 14).translate(x, y + R + 0.02, 0),
        steel,
      );
      p.add(
        'chrome',
        new CylinderGeometry(0.22, 0.22, 0.08, 14).translate(x, y + R + 0.1, 0),
      ); // manholes
    }
    for (const x of [rear + 1.2, mid - 2.4, mid + 2.4, front - 1.2])
      box(
        'chrome',
        [x - 0.025, y + R - 0.03, -0.4],
        [x + 0.025, y + R + 0.3, -0.35],
        undefined,
        true,
      ); // rail posts
    box(
      'chrome',
      [rear + 1.2, y + R + 0.26, -0.4],
      [front - 1.2, y + R + 0.3, -0.35],
      undefined,
      true,
    );
    for (const z of [-0.22, 0.22])
      box(
        'chrome',
        [rear - 0.1, 1.5, z - 0.02],
        [rear - 0.06, y + 0.4, z + 0.02],
      );
    for (let h = 1.7; h < y + 0.3; h += 0.32)
      box('chrome', [rear - 0.11, h, -0.22], [rear - 0.07, h + 0.04, 0.22]); // ladder
    box('detail', [rear + 0.1, 1.28, -0.6], [rear + 0.7, 1.95, 0.6], '#c9cdd0'); // valve cabinet
    return p;
  }

  // ----- Rigid truck: the baked cab, a frame, a body (a box, or one of `truck-backs.ts`) and two rear axles -----
  baked(p, 'cab');
  const cabBack = truckData('cab').cabBack ?? 1.6;
  const rearX = -4.45;
  const bodyEnd = cabBack - 0.08;
  box('detail', [rearX, 0.62, -1.0], [bodyEnd + 0.4, 1.12, 1.0], dark); // frame
  box('detail', [-3.72, 1.02, 0.78], [-1.22, 1.06, 1.24], '#1e1f21', true); // mudguards
  if (variant === 'box') {
    p.add(
      'paint',
      new BoxGeometry(bodyEnd - rearX, 2.4, 2.5).translate(
        (bodyEnd + rearX) / 2,
        2.32,
        0,
      ),
    );
    box('detail', [rearX - 0.02, 1.2, -1.2], [rearX, 3.4, 1.2], '#ececea'); // rear doors
    box('chrome', [rearX, 1.08, 1.25], [bodyEnd, 1.19, 1.3], undefined, true);
    box('chrome', [rearX, 3.52, 1.25], [bodyEnd, 3.6, 1.3], undefined, true);
    box(
      'detail',
      [rearX - 0.05, 0.68, 0.62],
      [rearX - 0.02, 0.86, 0.9],
      red,
      true,
    );
    box(
      'detail',
      [rearX - 0.05, 0.68, 0.9],
      [rearX - 0.02, 0.86, 1.0],
      amber,
      true,
    );
  } else {
    buildRigidBack(p, variant, {
      x0: rearX,
      x1: bodyEnd,
      y0: 1.12,
      hw: 1.25,
      roof: 3.37,
      cabX: 3.35,
    });
  }
  box('detail', [-1.25, 0.45, 1.12], [0.74, 0.88, 1.17], steel, true); // side guards (the cab's skirt follows)
  box('detail', [rearX - 0.08, 0.42, -1.1], [rearX, 0.6, 1.1], steel); // underrun bar
  for (const x of [-1.8, -3.1])
    for (const z of [-0.9, 0.9]) truckTyre(p, 0.5, x, 0.5, z, Math.sign(z));
  return p;
};

// ----- The fleet -----

interface Model {
  pieces: Pieces;
  /** x of the model's middle (the placement's point lands on it). */
  centre: number;
}

/**
 * A model of the fleet: every parked kind, plus the dump truck and its other backs and the tow / freezer trucks on
 * the dump cab (`tow`) or the big cab (`cab-tow`), shown in place of some box trucks.
 */
type FleetKind = VehicleKind | Back | Rigid | `cab-${Rigid}`;

/**
 * A background model (assets/builders/street-car-models.ts) as a fleet model, scaled to the kind's footprint
 * (within 10 %, so the rows keep their spacing): the paint triangles take the instance colour, the rest (glass,
 * wheels, lamps) keeps its baked colours.
 */
const streetModel = (shape: StreetCarShape, kind: VehicleKind): Model => {
  const scale = Math.min(
    1.1,
    Math.max(0.9, VEHICLE_SIZE[kind].length / shape.length),
  );
  const { paint, fixed } = shape.parts(scale);
  const pieces = new Pieces();
  for (const [part, g] of [
    ['paint', paint],
    ['detail', fixed],
  ] as const) {
    g.deleteAttribute('uv');
    pieces.addBaked(part, g);
  }
  return { pieces, centre: 0 };
};
const street = (id: string, kind: VehicleKind): Model =>
  streetModel(streetCarModel(streetCarIndex(id), 0), kind);
const service = (id: string, kind: VehicleKind): Model =>
  streetModel(serviceVehicleModel(id, 0), kind);

/** The models of a kind: its placements take them in turn (so a row mixes them), each with its own meshes. */
const MODEL: Record<FleetKind, () => Model[]> = {
  car: () => ['sedan', 'wagon', 'suv'].map((id) => street(id, 'car')),
  hatch: () => ['compact', 'hatch'].map((id) => street(id, 'hatch')),
  sport: () => ['coupe', 'sport'].map((id) => street(id, 'sport')),
  van: () => [street('minivan', 'van')],
  bigvan: () =>
    ['van_high', 'minibus', 'van_low'].map((id) => service(id, 'bigvan')),
  box: () => [{ pieces: buildTruck('box'), centre: 0.03 }],
  trailer: () => [{ pieces: buildTruck('tractor'), centre: 0 }],
  tanker: () => [{ pieces: buildTruck('tanker'), centre: 0 }],
  tipper: () => [{ pieces: buildDump('tipper'), centre: 0 }],
  flatbed: () => [{ pieces: buildDump('flatbed'), centre: 0 }],
  vanbody: () => [{ pieces: buildDump('vanbody'), centre: 0 }],
  tank: () => [{ pieces: buildDump('tank'), centre: 0 }],
  tow: () => [{ pieces: buildDump('tow'), centre: 0 }],
  reefer: () => [{ pieces: buildDump('reefer'), centre: 0 }],
  'cab-tow': () => [{ pieces: buildTruck('tow'), centre: 0.03 }],
  'cab-reefer': () => [{ pieces: buildTruck('reefer'), centre: 0.03 }],
};

/** The box-truck places go to the other rigid trucks in turn (`undefined` = a plain box truck). */
const RIGID_CYCLE: (Exclude<FleetKind, VehicleKind> | undefined)[] = [
  undefined,
  'tipper',
  'reefer',
  'tow',
  undefined,
  'vanbody',
  'flatbed',
  'cab-reefer',
  'cab-tow',
  'tank',
  undefined,
  'tipper',
];
/** Paint of a truck's back (the cab keeps the truck palette). */
const BACK_PAINT: Record<Back | Rigid, string[]> = {
  tipper: ['#e0a020', '#c96f1d', '#e8c020', '#7b8288'],
  flatbed: ['#2f5d8a', '#a8322c', '#7b8288', '#e0a020'],
  vanbody: ['#f4f4f2', '#dfe3e6', '#2f5d8a', '#3b7a57'],
  tank: ['#eef0f0', '#dfe3e6', '#e0a020'],
  tow: ['#e8c020', '#f4f4f2', '#c0392b', '#2f5d8a'],
  reefer: ['#f4f4f2', '#eef0f0', '#e4e8ea'],
};
const backOf = (kind: Exclude<FleetKind, VehicleKind>): Back | Rigid =>
  (kind.startsWith('cab-') ? kind.slice(4) : kind) as Back | Rigid;
/** Tow trucks and freezers wear one colour all over. */
const cabPaint = (kind: Exclude<FleetKind, VehicleKind>, body: string) => {
  const back = backOf(kind);
  return back === 'tow' || back === 'reefer' ? body : undefined;
};

/** Placements per model: a box truck's place goes to another truck by `RIGID_CYCLE`. */
function fleetOf(
  layout: ReturnType<typeof getLayout>,
): [FleetKind, VehicleKind, Placement[]][] {
  const out: [FleetKind, VehicleKind, Placement[]][] = [];
  for (const kind of Object.keys(layout.vehicles) as VehicleKind[]) {
    if (kind !== 'box') {
      out.push([kind, kind, layout.vehicles[kind]]);
      continue;
    }
    const split = new Map<FleetKind, Placement[]>();
    layout.vehicles.box.forEach((pl, i) => {
      const back = RIGID_CYCLE[i % RIGID_CYCLE.length];
      const fleet: FleetKind = back ?? 'box';
      const colors = back ? BACK_PAINT[backOf(back)] : [];
      const color = colors[i % colors.length];
      const cabColor = back && cabPaint(back, color);
      const paint = back ? { ...pl, color, ...(cabColor && { cabColor }) } : pl;
      split.set(fleet, [...(split.get(fleet) ?? []), paint]);
    });
    for (const [fleet, list] of split) out.push([fleet, 'box', list]);
  }
  return out;
}

/** Vehicles nearer than this (m) to the camera draw in full; farther ones as a two-box stand-in. */
const FLEET_NEAR = 200;
/** Re-sort near / far after the camera moved this far (m). */
const FLEET_STEP = 10;

/**
 * Every parked vehicle of the layout as instanced meshes: per model one mesh per part (paint,
 * cab paint, glass, chrome, details), instance colours carrying each vehicle's paint.
 *
 * Far LOD: the meshes span the whole row (never culled), so vehicles beyond FLEET_NEAR move to one
 * stand-in mesh per model (`proxyOf`: two boxes, ~20 triangles, no shadow - they are past the shadow
 * box). The split is redone from the camera of the frame (`onBeforeRender`) after FLEET_STEP of travel.
 */
export function buildFleet(b: Build): Group {
  const group = new Group();
  group.name = 'start-row vehicles';
  const mats = materialFor();
  const layout = getLayout();
  const kinds: {
    matrices: Matrix4[];
    paint: Color[];
    cab: Color[];
    parts: [Part, InstancedMesh][];
    proxy: InstancedMesh;
  }[] = [];
  const groups = fleetOf(layout).flatMap(([fleet, kind, all]) => {
    if (!all.length) return [];
    const models = MODEL[fleet]();
    return models.map((model, m) => ({
      kind,
      model,
      placements: all.filter((_, i) => i % models.length === m),
    }));
  });
  for (const { kind, model, placements } of groups) {
    if (!placements.length) continue;
    const { length, width } = VEHICLE_SIZE[kind];
    const matrices = placements.map(({ x, z, heading }) => {
      // Stand on the yard surface (or the ground) under the four corners, not level at the middle: a long truck
      // on a sloping yard otherwise hangs in the air at one end. Each end / side takes its higher corner, the
      // body pitches and rolls to match.
      const f = [Math.cos(heading), -Math.sin(heading)];
      const r = [-f[1], f[0]];
      const h = (i: number, j: number) =>
        standHeight(
          b,
          x + (f[0] * i * length) / 2 + (r[0] * j * width) / 2,
          z + (f[1] * i * length) / 2 + (r[1] * j * width) / 2,
        );
      const [fl, fr, rl, rr] = [h(1, -1), h(1, 1), h(-1, -1), h(-1, 1)];
      const front = Math.max(fl, fr);
      const rear = Math.max(rl, rr);
      const left = Math.max(fl, rl);
      const right = Math.max(fr, rr);
      const y = (front + rear) / 2 + 0.04;
      const m = new Matrix4()
        .makeRotationY(heading)
        .multiply(new Matrix4().makeRotationZ(Math.atan2(front - rear, length)))
        .multiply(new Matrix4().makeRotationX(-Math.atan2(right - left, width)))
        .setPosition(x + ORIGIN.x, y, z + ORIGIN.z);
      return m.multiply(new Matrix4().makeTranslation(-model.centre, 0, 0));
    });
    const paint = placements.map((pl) => new Color(pl.color));
    const cab = placements.map((pl) => new Color(pl.cabColor ?? pl.color));
    const parts: [Part, InstancedMesh][] = [];
    for (const slot of model.pieces.slots()) {
      const { part } = slot;
      const geometry = model.pieces.geometry(slot);
      if (!geometry) continue;
      const mesh = new InstancedMesh(
        geometry,
        slot.tex ? texturedMaterial(slot) : mats[part],
        placements.length,
      );
      matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
      if (part === 'paint' || part === 'cab')
        (part === 'cab' ? cab : paint).forEach((c, i) => mesh.setColorAt(i, c));
      // Paint + cab carry the shape; glass, chrome and details (wheels, mirrors, lamps) sit inside that shadow.
      mesh.castShadow = part === 'paint' || part === 'cab';
      mesh.receiveShadow = true;
      parts.push([part, mesh]);
      group.add(mesh);
    }
    const proxy = new InstancedMesh(
      proxyOf(model.pieces),
      mats.detail,
      placements.length,
    );
    matrices.forEach((m, i) => proxy.setMatrixAt(i, m));
    paint.forEach((c, i) => proxy.setColorAt(i, c));
    proxy.receiveShadow = true;
    group.add(proxy);
    kinds.push({ matrices, paint, cab, parts, proxy });
  }

  const meshesOf = (k: (typeof kinds)[number]) => [
    k.proxy,
    ...k.parts.map(([, m]) => m),
  ];
  // Bounding spheres (distance culling, world/distance-cull.ts) are taken now, with every instance in every mesh.
  for (const k of kinds)
    for (const m of meshesOf(k)) {
      m.computeBoundingSphere();
      // The instance counts change with the camera: a cached sphere would be stale.
      m.frustumCulled = false;
    }
  let lastX = Infinity;
  let lastZ = Infinity;
  const near: number[] = [];
  const far: number[] = [];
  const split = (cx: number, cz: number) => {
    if (Math.hypot(cx - lastX, cz - lastZ) < FLEET_STEP) return;
    lastX = cx;
    lastZ = cz;
    for (const k of kinds) {
      near.length = 0;
      far.length = 0;
      k.matrices.forEach((m, i) => {
        const e = m.elements;
        (Math.hypot(e[12] - cx, e[14] - cz) < FLEET_NEAR ? near : far).push(i);
      });
      for (const [part, mesh] of k.parts) {
        const colors =
          part === 'paint' ? k.paint : part === 'cab' ? k.cab : null;
        near.forEach((i, n) => {
          mesh.setMatrixAt(n, k.matrices[i]);
          if (colors) mesh.setColorAt(n, colors[i]);
        });
        fill(mesh, near.length);
      }
      far.forEach((i, n) => {
        k.proxy.setMatrixAt(n, k.matrices[i]);
        k.proxy.setColorAt(n, k.paint[i]);
      });
      fill(k.proxy, far.length);
    }
  };
  for (const k of kinds)
    for (const m of meshesOf(k))
      m.onBeforeRender = (_r, _s, camera) =>
        split(camera.position.x, camera.position.z);
  return group;
}

function fill(mesh: InstancedMesh, count: number): void {
  // Never hidden: a mesh with no instances still runs the split for the others (onBeforeRender).
  mesh.count = count;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

/**
 * Far stand-in of a model: a lower box (the body) and an upper box (cabin / cargo box), each the bounding box of
 * the model's vertices below / above 55 % of its height. White on the body (= the instance paint); on top the
 * average tone of what is up there (dark where it is mostly glass, paint on a truck's box).
 */
function proxyOf(pieces: Pieces): BufferGeometry {
  const tone: Record<Part, number> = {
    paint: 1,
    cab: 1,
    glass: 0.12,
    chrome: 0.8,
    detail: 0.3,
  };
  let maxY = 0;
  const all: [Part, BufferGeometry][] = [];
  for (const slot of pieces.slots()) {
    const g = pieces.geometry(slot);
    if (!g) continue;
    all.push([slot.part, g]);
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) maxY = Math.max(maxY, p.getY(i));
  }
  const cut = maxY * 0.55;
  const lo = [Infinity, Infinity, -Infinity, -Infinity];
  const hi = [Infinity, Infinity, -Infinity, -Infinity];
  let topTone = 0;
  let topN = 0;
  for (const [part, g] of all) {
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const top = p.getY(i) > cut;
      const bb = top ? hi : lo;
      bb[0] = Math.min(bb[0], p.getX(i));
      bb[1] = Math.min(bb[1], p.getZ(i));
      bb[2] = Math.max(bb[2], p.getX(i));
      bb[3] = Math.max(bb[3], p.getZ(i));
      if (top) {
        topTone += tone[part];
        topN++;
      }
    }
    g.dispose();
  }
  const box = (bb: number[], y0: number, y1: number, t: number) => {
    const g = new BoxGeometry(bb[2] - bb[0], y1 - y0, bb[3] - bb[1]);
    g.translate((bb[0] + bb[2]) / 2, (y0 + y1) / 2, (bb[1] + bb[3]) / 2);
    const flat = g.toNonIndexed();
    g.dispose();
    flat.deleteAttribute('uv');
    const n = flat.getAttribute('position').count;
    flat.setAttribute(
      'color',
      new BufferAttribute(new Float32Array(n * 3).fill(t), 3),
    );
    return flat;
  };
  const boxes = [box(lo, 0.25, cut, 1)];
  if (topN) boxes.push(box(hi, cut, maxY, topTone / topN));
  return mergeGeometries(boxes)!;
}

/**
 * The team tractor-trailer of the service park (`service_semi`, assets/builders/service.ts): the baked `trailer` model with
 * tractor and trailer tinted `color` through the vertex colours (the model is centred on the origin). LOD 1 is the two-box stand-in.
 */
export function teamSemi(color: string, lod: number): AssetPart[] {
  const pieces = buildTruck('tractor');
  const tint = new Color(color);
  /** `g` with the colour on every vertex (times `tone` per vertex when given). */
  const colored = (g: BufferGeometry, tone?: (i: number) => number) => {
    const n = g.getAttribute('position').count;
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const k = tone?.(i) ?? 1;
      c.set([tint.r * k, tint.g * k, tint.b * k], i * 3);
    }
    g.setAttribute('color', new BufferAttribute(c, 3));
    return g;
  };
  const mats = materialFor();
  if (lod > 0) {
    const g = proxyOf(pieces);
    const tone = g.getAttribute('color');
    return [
      { geometry: colored(g, (i) => tone.getX(i)), material: mats.detail },
    ];
  }
  return pieces.slots().flatMap((slot) => {
    const geometry = pieces.geometry(slot);
    if (!geometry) return [];
    const tinted = slot.part === 'paint' || slot.part === 'cab';
    return [
      {
        geometry: tinted ? colored(geometry) : geometry,
        material: slot.tex ? texturedMaterial(slot, tinted) : mats[slot.part],
      },
    ];
  });
}
