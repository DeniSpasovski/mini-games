import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Shape,
  SphereGeometry,
  type ColorRepresentation,
  type Material,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
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

/**
 * The parked vehicles of the lots. Cars, vans and box trucks are the background models
 * (assets/builders/street-car-models.ts, a few per kind, scaled to the layout's footprint); the tractor units with a
 * box or tank semi-trailer are built here from simple profiles (~1500 triangles). Drawn as instanced meshes, one per
 * part (paint, cab paint, glass, chrome, details), so a hundred vehicles cost a few dozen draw calls. Models face +x
 * with the origin on the ground under their middle (`centre` shifts the truck models, whose origin is over the rear axle).
 */

type Part = 'paint' | 'cab' | 'glass' | 'chrome' | 'detail';

/** Geometry collected per part, with vertex colours (used by `detail`). */
class Pieces {
  private lists = new Map<Part, BufferGeometry[]>();

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
    const list = this.lists.get(part) ?? [];
    list.push(flat);
    this.lists.set(part, list);
  }

  /** A baked model part (street-car-models.ts) keeping its own vertex colours; the paint part is white. */
  addBaked(part: Part, g: BufferGeometry): void {
    g.deleteAttribute('uv');
    g.clearGroups();
    const list = this.lists.get(part) ?? [];
    list.push(g);
    this.lists.set(part, list);
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

  geometry(part: Part): BufferGeometry | undefined {
    const list = this.lists.get(part);
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

// ----- Trucks -----

/** Side profile of the cab (x forward, y up), with the front wheel arch cut out. */
const cabShape = (): Shape => {
  const s = new Shape();
  s.moveTo(2.22, 1.07);
  s.lineTo(2.777, 1.07);
  s.absarc(3.2, 0.5, 0.71, 2.209, 0.932, true);
  s.lineTo(3.8, 1.07);
  s.lineTo(3.8, 0.57);
  s.lineTo(4.38, 0.57);
  s.lineTo(4.38, 1.95);
  s.lineTo(4.28, 3.0);
  s.lineTo(4.13, 3.18);
  s.lineTo(2.22, 3.18);
  s.closePath();
  return s;
};

const deflectorShape = (): Shape => {
  const s = new Shape();
  s.moveTo(2.22, 3.2);
  s.lineTo(3.85, 3.2);
  s.quadraticCurveTo(3.0, 3.45, 2.4, 4.0);
  s.lineTo(2.22, 4.0);
  s.closePath();
  return s;
};

const extrudeShape = (
  shape: Shape,
  width: number,
  bevel: number,
): BufferGeometry => {
  const g = new ExtrudeGeometry(shape, {
    depth: width - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    curveSegments: 5,
  });
  return g.translate(0, 0, -(width - bevel * 2) / 2);
};

const buildTruck = (variant: 'tractor' | 'tanker'): Pieces => {
  const p = new Pieces();
  const dark = '#2d3136';
  const plastic = '#43484e';
  const steel = '#8d9399';
  const red = '#c8242b';
  const box = (
    part: Part,
    a: number[],
    b: number[],
    color?: string,
    mirror = false,
  ) => p.box(part, a, b, color, mirror);

  // ----- Cab -----
  p.add('cab', extrudeShape(cabShape(), 2.36, 0.07));
  p.add('cab', extrudeShape(deflectorShape(), 2.2, 0.05));
  p.add(
    'glass',
    new BoxGeometry(0.04, 0.95, 2.1).rotateZ(0.095).translate(4.4, 2.5, 0),
  );
  box('detail', [4.28, 3.12, -1.1], [4.64, 3.19, 1.1], dark); // sun visor
  box('detail', [4.42, 1.25, -0.78], [4.47, 1.86, 0.78], dark); // grille
  box('chrome', [4.46, 1.9, -0.25], [4.49, 1.98, 0.25]);
  box('detail', [4.42, 0.97, 0.74], [4.5, 1.18, 1.06], '#eef3f6', true);
  box('detail', [4.3, 0.45, -1.19], [4.56, 0.86, 1.19], plastic); // bumper
  box('glass', [3.3, 2.06, 1.17], [4.22, 2.95, 1.2], undefined, true);
  box('detail', [4.2, 2.02, 1.44], [4.33, 2.78, 1.62], dark, true); // mirror arms

  // ----- Chassis -----
  box('detail', [-2.5, 0.62, -1.15], [3.9, 1.12, 1.15], dark);
  box('detail', [-2.45, 1.02, 0.78], [0.15, 1.06, 1.24], '#1e1f21', true);
  box('detail', [-1.5, 1.12, -0.75], [0.3, 1.3, 0.75], dark); // fifth wheel

  if (variant === 'tanker') {
    // ----- Tank semi-trailer (ref-45): a white cylinder with dished ends on an underframe, landing legs,
    // a valve cabinet at the rear, a blue stripe down each side and a walkway rail on top (no livery). -----
    const front = 0.6;
    const rear = -12.5;
    const R = 1.18;
    const y = 2.62;
    const len = front - rear - 2 * R * 0.35;
    const mid = (front + rear) / 2;
    p.add(
      'paint',
      new CylinderGeometry(R, R, len, 14)
        .rotateZ(Math.PI / 2)
        .translate(mid, y, 0),
    );
    for (const [x, s] of [
      [mid + len / 2, 1],
      [mid - len / 2, -1],
    ])
      p.add(
        'paint',
        new SphereGeometry(R, 14, 5, 0, Math.PI * 2, 0, Math.PI / 2)
          .rotateZ((-s * Math.PI) / 2)
          .scale(0.35, 1, 1)
          .translate(x, y, 0),
      );
    box(
      'detail',
      [mid - len / 2 + 0.2, y - 0.1, R - 0.01],
      [mid + len / 2 - 0.2, y + 0.1, R + 0.02],
      '#1f5fb4',
      true,
    );
    box('detail', [rear + 0.3, 1.12, -0.6], [front - 0.2, 1.48, 0.6], dark); // underframe
    for (const x of [-1.2, -6, -10.6])
      box('detail', [x - 0.25, 1.4, -0.95], [x + 0.25, y - 0.6, 0.95], dark); // saddles
    for (const z of [0.9, -0.9])
      box('detail', [-3.1, 0.2, z - 0.1], [-2.9, 1.12, z + 0.1], steel); // landing legs
    box('detail', [-9.0, 0.6, 1.12], [-3.4, 1.0, 1.17], steel, true); // side guards
    box('detail', [rear - 0.1, 1.0, -1.0], [rear + 0.9, 1.9, 1.0], '#c9cdd0'); // valve cabinet
    box('detail', [rear - 0.2, 0.42, -1.1], [rear - 0.08, 0.6, 1.1], steel); // underrun bar
    box(
      'detail',
      [rear - 0.22, 0.66, 0.62],
      [rear - 0.2, 0.86, 0.9],
      red,
      true,
    );
    box(
      'chrome',
      [mid - 4, y + R + 0.12, -0.35],
      [mid + 4, y + R + 0.16, 0.35],
    ); // walkway rail
    for (const x of [mid - 4, mid, mid + 4])
      box(
        'chrome',
        [x - 0.03, y + R - 0.05, -0.33],
        [x + 0.03, y + R + 0.14, -0.3],
        undefined,
        true,
      );
  } else {
    // ----- Semi-trailer: plain box on an underframe, landing legs, rear doors -----
    const front = 0.9;
    const rear = -12.7;
    p.add(
      'paint',
      new BoxGeometry(front - rear, 2.7, 2.55).translate(
        (front + rear) / 2,
        2.7,
        0,
      ),
    );
    box('detail', [rear + 0.3, 1.12, -1.0], [front, 1.35, 1.0], dark);
    for (const z of [0.9, -0.9])
      box('detail', [-3.1, 0.2, z - 0.1], [-2.9, 1.12, z + 0.1], steel);
    box('detail', [-9.2, 0.6, 1.12], [-3.4, 1.0, 1.17], steel, true); // side guards
    box('detail', [-12.87, 0.42, -1.1], [-12.74, 0.6, 1.1], steel);
    box('detail', [rear - 0.03, 1.4, -1.24], [rear, 4.0, 1.24], '#ececea'); // rear doors
    box('detail', [-12.88, 1.06, 0.62], [-12.86, 1.26, 0.9], red, true);
    box('chrome', [rear, 1.35, 1.27], [front, 1.45, 1.33], undefined, true);
    box('chrome', [rear, 4.03, 1.27], [front, 4.13, 1.33], undefined, true);
  }

  // ----- Wheels: a ten-sided tyre with a steel hub -----
  const axles =
    variant === 'tanker'
      ? [3.2, -0.5, -1.8, -9.4, -10.7, -12.0]
      : [3.2, -0.5, -1.8, -10.4, -11.7];
  for (const x of axles)
    for (const z of [-1.0, 1.0]) {
      p.add(
        'detail',
        new CylinderGeometry(0.5, 0.5, 0.31, 10)
          .rotateX(Math.PI / 2)
          .translate(x, 0.5, z),
        '#1e1f21',
      );
      const hub = new CircleGeometry(0.3, 8);
      if (z < 0) hub.rotateY(Math.PI);
      p.add('detail', hub.translate(x, 0.5, z + Math.sign(z) * 0.158), steel);
    }
  return p;
};

// ----- The fleet -----

interface Model {
  pieces: Pieces;
  /** x of the model's middle (the placement's point lands on it). */
  centre: number;
}

/**
 * A background model (assets/builders/street-car-models.ts) as a fleet model, scaled to the kind's footprint
 * (within 10 %, so the rows keep their spacing): the paint triangles take the instance colour, the rest (glass,
 * wheels, lamps) keeps its baked colours.
 */
const baked = (shape: StreetCarShape, kind: VehicleKind): Model => {
  const scale = Math.min(
    1.1,
    Math.max(0.9, VEHICLE_SIZE[kind].length / shape.length),
  );
  const { paint, fixed } = shape.parts(scale);
  const pieces = new Pieces();
  pieces.addBaked('paint', paint);
  pieces.addBaked('detail', fixed);
  return { pieces, centre: 0 };
};
const street = (id: string, kind: VehicleKind): Model =>
  baked(streetCarModel(streetCarIndex(id), 0), kind);
const service = (id: string, kind: VehicleKind): Model =>
  baked(serviceVehicleModel(id, 0), kind);

/** The models of a kind: its placements take them in turn (so a row mixes them), each with its own meshes. */
const MODEL: Record<VehicleKind, () => Model[]> = {
  car: () => ['sedan', 'wagon', 'suv'].map((id) => street(id, 'car')),
  hatch: () => ['compact', 'hatch'].map((id) => street(id, 'hatch')),
  sport: () => ['coupe', 'sport'].map((id) => street(id, 'sport')),
  van: () => [street('minivan', 'van')],
  bigvan: () =>
    ['van_high', 'minibus', 'van_low'].map((id) => service(id, 'bigvan')),
  box: () =>
    ['box_truck', 'box_truck', 'flatbed'].map((id) => service(id, 'box')),
  trailer: () => [{ pieces: buildTruck('tractor'), centre: -4.13 }],
  tanker: () => [{ pieces: buildTruck('tanker'), centre: -4.13 }],
};

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
  const groups = (Object.keys(MODEL) as VehicleKind[]).flatMap((kind) => {
    const all: Placement[] = layout.vehicles[kind];
    if (!all.length) return [];
    const models = MODEL[kind]();
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
    for (const part of [
      'paint',
      'cab',
      'glass',
      'chrome',
      'detail',
    ] as Part[]) {
      const geometry = model.pieces.geometry(part);
      if (!geometry) continue;
      const mesh = new InstancedMesh(geometry, mats[part], placements.length);
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
  for (const part of Object.keys(tone) as Part[]) {
    const g = pieces.geometry(part);
    if (!g) continue;
    all.push([part, g]);
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
