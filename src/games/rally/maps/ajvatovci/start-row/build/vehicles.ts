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
  ShapeGeometry,
  SphereGeometry,
  Vector2,
  type ColorRepresentation,
  type Material,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ORIGIN } from '../frame';
import {
  getLayout,
  VEHICLE_SIZE,
  type Placement,
  type VehicleKind,
} from '../layout';
import type { Build } from './ctx';

/**
 * The parked vehicles of the lots: three cars (a modern hatchback, a small boxy Yugo-style hatch,
 * a 90s sports saloon), two vans (a Caddy-type and a high-roof Transit-type) and three trucks (a
 * cab-over box truck, a tractor unit with a box semi-trailer and the same with a tank semi-trailer). Each is built once from the side
 * profiles measured on the Yuma Interactive site's `exterior/car.ts`, `van.ts` and `truck.ts`
 * (read-only reference) and drawn as instanced meshes, one per part (paint, cab paint, glass,
 * chrome, details), so a hundred vehicles cost a few dozen draw calls. Only what reads from the
 * road is modelled (body, glass, lamps, bumpers, grille, wheels): a car is ~500 triangles, a
 * tractor-trailer ~1500. Models face +x with the origin on the ground under their middle
 * (`centre` shifts the truck models, whose origin is over the rear axle).
 */

type Pt = [number, number];
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

const BEVEL = 0.03;

const extrude = (
  outline: Pt[],
  width: number,
  bevel = BEVEL,
): BufferGeometry => {
  const depth = width - bevel * 2;
  return new ExtrudeGeometry(
    new Shape(outline.map(([x, y]) => new Vector2(x, y))),
    {
      depth,
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 1,
      curveSegments: 6,
    },
  ).translate(0, 0, -depth / 2);
};

/** A pane lying on the cabin edge a-b (counter-clockwise outline, so outward is (dy, -dx)). */
const pane = ([a, b]: [Pt, Pt], width: number): BufferGeometry => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy);
  const off = BEVEL + 0.01;
  return new BoxGeometry(length - 0.08, 0.02, width)
    .rotateZ(Math.atan2(dy, dx))
    .translate(
      (a[0] + b[0]) / 2 + (dy / length) * off,
      (a[1] + b[1]) / 2 - (dx / length) * off,
      0,
    );
};

/**
 * A side window: the rectangle x0..x1 by y0..y1 on a vehicle's side face, cut down wherever the
 * body's roofline (its side `profile`) dips below the top, so the glass never sticks out past it.
 */
const sideWindow = (
  profile: Pt[],
  [x0, x1, y0, y1]: number[],
  z: number,
  inset = 0.04,
): BufferGeometry => {
  const roof = (x: number) => {
    let top = -Infinity;
    profile.forEach(([ax, ay], i) => {
      const [bx, by] = profile[(i + 1) % profile.length];
      if (ax !== bx && x >= Math.min(ax, bx) && x <= Math.max(ax, bx))
        top = Math.max(top, ay + ((by - ay) * (x - ax)) / (bx - ax));
    });
    return top;
  };
  const xs = [
    x0,
    ...profile.map(([x]) => x).filter((x) => x > x0 && x < x1),
    x1,
  ].sort((a, b) => a - b);
  const top = xs.map((x) => Math.max(y0 + 0.02, Math.min(y1, roof(x) - inset)));
  const shape = new Shape([
    new Vector2(x0, y0),
    new Vector2(x1, y0),
    ...xs.map((x, i) => new Vector2(x, top[i])).reverse(),
  ]);
  const geometry = new ShapeGeometry(shape);
  if (z < 0) {
    const index = geometry.getIndex()!;
    for (let i = 0; i < index.count; i += 3) {
      const b = index.getX(i + 1);
      index.setX(i + 1, index.getX(i + 2));
      index.setX(i + 2, b);
    }
    const normal = geometry.getAttribute('normal');
    for (let i = 0; i < normal.count; i++) normal.setZ(i, -1);
  }
  return geometry.translate(0, 0, z);
};

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

/**
 * A wheel: a ten-sided tyre and a hub disc on its outer face, axle along z, centred at (x, y, z);
 * `side` (+1 / -1) is the face the hub is on.
 */
const wheel = (
  p: Pieces,
  r: number,
  width: number,
  x: number,
  y: number,
  z: number,
  side: number,
): void => {
  p.add(
    'detail',
    new CylinderGeometry(r, r, width, 10)
      .rotateX(Math.PI / 2)
      .translate(x, y, z),
    '#1a1b1d',
  );
  const hub = new CircleGeometry(r * 0.6, 8).translate(0, 0, 0);
  if (side < 0) hub.rotateY(Math.PI);
  p.add('chrome', hub.translate(x, y, z + side * (width / 2 + 0.006)));
};

// ----- Cars -----

type CarSpec = {
  body: number;
  cabin: number;
  lower: Pt[];
  roof: Pt[];
  front: [Pt, Pt];
  rear: [Pt, Pt];
  windows: number[][];
  wheel: { r: number; width: number; front: number; rear: number };
  mirror: number;
};

const CARS: Record<'car' | 'hatch' | 'sport', CarSpec> = {
  car: {
    body: 1.8,
    cabin: 1.6,
    lower: [
      [-2.15, 0.4],
      [2.15, 0.4],
      [2.15, 0.62],
      [1.95, 0.8],
      [1.05, 0.88],
      [0.8, 0.95],
      [-1.9, 0.95],
      [-2.15, 0.92],
    ],
    roof: [
      [0.85, 0.9],
      [0.2, 1.4],
      [-1.1, 1.43],
      [-1.74, 0.98],
      [-1.74, 0.9],
    ],
    front: [
      [0.85, 0.9],
      [0.2, 1.4],
    ],
    rear: [
      [-1.1, 1.43],
      [-1.74, 0.98],
    ],
    windows: [
      [-1.5, -0.05, 1.0, 1.45],
      [0.03, 0.55, 1.0, 1.45],
    ],
    wheel: { r: 0.32, width: 0.22, front: 1.38, rear: -1.3 },
    mirror: 0.6,
  },
  hatch: {
    body: 1.56,
    cabin: 1.4,
    lower: [
      [-1.72, 0.36],
      [1.72, 0.36],
      [1.72, 0.6],
      [1.6, 0.74],
      [0.9, 0.85],
      [0.66, 0.9],
      [-1.72, 0.9],
    ],
    roof: [
      [0.7, 0.86],
      [0.2, 1.36],
      [-1.5, 1.38],
      [-1.72, 0.86],
    ],
    front: [
      [0.7, 0.86],
      [0.2, 1.36],
    ],
    rear: [
      [-1.5, 1.38],
      [-1.72, 0.9],
    ],
    windows: [
      [-1.45, -0.42, 0.98, 1.4],
      [-0.3, 0.5, 0.98, 1.4],
    ],
    wheel: { r: 0.28, width: 0.17, front: 1.08, rear: -1.04 },
    mirror: 0.58,
  },
  sport: {
    body: 1.64,
    cabin: 1.42,
    lower: [
      [-2.17, 0.35],
      [2.17, 0.35],
      [2.17, 0.72],
      [2.05, 0.78],
      [1.2, 0.86],
      [0.85, 0.93],
      [-1.5, 0.98],
      [-2.17, 1.03],
    ],
    roof: [
      [0.85, 0.9],
      [0.05, 1.36],
      [-0.85, 1.37],
      [-1.5, 1.03],
      [-1.5, 0.9],
    ],
    front: [
      [0.85, 0.9],
      [0.05, 1.36],
    ],
    rear: [
      [-0.85, 1.37],
      [-1.5, 1.03],
    ],
    windows: [
      [-1.25, -0.5, 1.04, 1.4],
      [-0.4, 0.6, 1.0, 1.4],
    ],
    wheel: { r: 0.31, width: 0.24, front: 1.3, rear: -1.27 },
    mirror: 0.6,
  },
};

const LAMP = '#eef3f6';
const RED = '#b3242b';
const BLACK = '#0e0f11';
const PLASTIC = '#33373c';

const buildCar = (variant: 'car' | 'hatch' | 'sport'): Pieces => {
  const s = CARS[variant];
  const p = new Pieces();
  const { body, cabin } = s;
  const fx = Math.max(...s.lower.map(([x]) => x)) + BEVEL;
  const rx = Math.min(...s.lower.map(([x]) => x)) - BEVEL;
  const half = body / 2;
  p.add('paint', extrude(s.lower, body));
  p.add('paint', extrude(s.roof, cabin));
  p.add('glass', pane(s.front, cabin - 0.16));
  p.add('glass', pane(s.rear, cabin - 0.16));
  for (const z of [-1, 1]) {
    for (const w of s.windows)
      p.add('glass', sideWindow(s.roof, w, z * (cabin / 2 + 0.008), 0.07));
    // Mirror.
    p.box(
      'detail',
      [s.mirror - 0.06, 0.98, z * (half + 0.06) - 0.02],
      [s.mirror + 0.08, 1.1, z * (half + 0.11) + 0.02],
      PLASTIC,
    );
    // Dark arches over the body side.
    for (const x of [s.wheel.front, s.wheel.rear]) {
      const big = s.wheel.r + 0.07;
      const low = Math.max(0.36 - s.wheel.r, -big + 0.01);
      const start = Math.asin(low / big);
      const arch = new Shape().absarc(0, 0, big, start, Math.PI - start, false);
      const g = new ShapeGeometry(arch, 6).translate(x, s.wheel.r, 0);
      if (z < 0) g.rotateY(Math.PI);
      p.add('detail', g.translate(0, 0, z * (half + 0.006)), BLACK);
    }
  }
  for (const x of [s.wheel.front, s.wheel.rear])
    for (const z of [-1, 1])
      wheel(
        p,
        s.wheel.r,
        s.wheel.width,
        x,
        s.wheel.r,
        z * (half + 0.03 - s.wheel.width / 2),
        z,
      );

  if (variant === 'car') {
    for (const z of [-1, 1]) {
      p.box(
        'detail',
        [fx - 0.05, 0.66, 0.5 * z],
        [fx + 0.008, 0.79, 0.86 * z],
        LAMP,
      );
      p.box(
        'detail',
        [rx - 0.008, 0.72, 0.55 * z],
        [rx + 0.05, 0.87, 0.87 * z],
        RED,
      );
    }
    p.box('detail', [fx - 0.05, 0.5, -0.42], [fx + 0.008, 0.66, 0.42], BLACK); // grille
    p.box(
      'detail',
      [fx - 0.15, 0.3, -half + 0.02],
      [fx + 0.06, 0.5, half - 0.02],
      PLASTIC,
    );
    p.box(
      'detail',
      [rx - 0.06, 0.3, -half + 0.02],
      [rx + 0.15, 0.52, half - 0.02],
      PLASTIC,
    );
  } else if (variant === 'hatch') {
    for (const z of [-1, 1]) {
      p.box(
        'detail',
        [fx - 0.04, 0.6, 0.42 * z],
        [fx + 0.012, 0.7, 0.68 * z],
        LAMP,
      );
      p.box(
        'detail',
        [rx - 0.01, 0.66, 0.5 * z],
        [rx + 0.05, 0.82, 0.74 * z],
        RED,
      );
    }
    p.box('detail', [fx - 0.05, 0.56, -0.34], [fx + 0.008, 0.72, 0.34], BLACK);
    p.box(
      'detail',
      [fx - 0.12, 0.28, -half - 0.02],
      [fx + 0.08, 0.52, half + 0.02],
      BLACK,
    );
    p.box(
      'detail',
      [rx - 0.08, 0.28, -half - 0.02],
      [rx + 0.12, 0.52, half + 0.02],
      BLACK,
    );
  } else {
    for (const z of [-1, 1]) {
      p.box(
        'detail',
        [fx - 0.05, 0.56, 0.45 * z - 0.09],
        [fx + 0.01, 0.68, 0.45 * z + 0.09],
        LAMP,
      );
      p.box(
        'detail',
        [fx - 0.05, 0.56, 0.66 * z - 0.09],
        [fx + 0.01, 0.68, 0.66 * z + 0.09],
        LAMP,
      );
      p.box(
        'detail',
        [rx - 0.008, 0.77, 0.4 * z],
        [rx + 0.05, 0.92, 0.8 * z],
        RED,
      );
    }
    p.box('detail', [fx - 0.05, 0.56, -0.24], [fx + 0.008, 0.72, 0.24], BLACK);
    p.box(
      'detail',
      [fx - 0.05, 0.38, -half + 0.1],
      [fx + 0.008, 0.46, half - 0.1],
      BLACK,
    );
    p.box('paint', [rx + 0.03, 1.03, -0.6], [rx + 0.26, 1.13, 0.6]); // boot spoiler
    p.box(
      'detail',
      [rx - 0.05, 0.3, -half + 0.03],
      [rx + 0.1, 0.5, half - 0.03],
      PLASTIC,
    );
  }
  return p;
};

// ----- Vans -----

type VanSpec = {
  width: number;
  profile: Pt[];
  screen: [Pt, Pt];
  windows: [number, number, number, number][];
  wheel: number;
  axles: [number, number];
};

const VANS: Record<'small' | 'large', VanSpec> = {
  small: {
    width: 1.84,
    profile: [
      [-2.3, 0.38],
      [2.3, 0.38],
      [2.3, 0.72],
      [1.75, 0.93],
      [1.25, 1.02],
      [0.55, 1.76],
      [-2.2, 1.83],
      [-2.3, 1.76],
    ],
    screen: [
      [1.25, 1.02],
      [0.55, 1.76],
    ],
    windows: [[-0.35, 0.72, 1.1, 1.66]],
    wheel: 0.32,
    axles: [1.48, -1.42],
  },
  large: {
    width: 2.04,
    profile: [
      [-3, 0.42],
      [3, 0.42],
      [3, 0.86],
      [2.5, 1.18],
      [2.02, 1.3],
      [1.4, 2.25],
      [1.12, 2.72],
      [-2.95, 2.76],
      [-3, 2.7],
    ],
    screen: [
      [2.02, 1.3],
      [1.4, 2.25],
    ],
    windows: [
      [0.3, 1.5, 1.35, 2.1],
      [-2.7, 0.1, 1.45, 2.15],
    ],
    wheel: 0.38,
    axles: [1.98, -1.9],
  },
};

const buildVan = (variant: 'small' | 'large'): Pieces => {
  const s = VANS[variant];
  const p = new Pieces();
  const half = s.width / 2;
  const bevel = 0.05;
  p.add('paint', extrude(s.profile, s.width, bevel));
  const front = s.profile[1][0] + bevel;
  const back = s.profile[0][0] - bevel;
  const [[x0, y0], [x1, y1]] = s.screen;
  const run = Math.hypot(x1 - x0, y1 - y0);
  p.add(
    'glass',
    new BoxGeometry(0.03, run * 0.94, s.width - 0.2)
      .rotateZ(Math.atan2(x0 - x1, y1 - y0))
      .translate((x0 + x1) / 2 + 0.05, (y0 + y1) / 2, 0),
  );
  for (const z of [-half - 0.005, half + 0.005])
    for (const w of s.windows)
      p.add('glass', sideWindow(s.profile, w, z + Math.sign(z) * 0.001));
  for (const z of [-1, 1]) {
    p.box(
      'detail',
      [front - 0.02, 0.72, (half - 0.45) * z],
      [front + 0.03, 0.9, (half - 0.1) * z],
      LAMP,
    );
    p.box(
      'detail',
      [back - 0.03, 0.8, (half - 0.14) * z],
      [back + 0.02, 1.35, (half - 0.02) * z],
      RED,
    );
  }
  p.box(
    'detail',
    [front - 0.02, 0.55, -0.45],
    [front + 0.02, 0.8, 0.45],
    PLASTIC,
  );
  p.box(
    'detail',
    [front - 0.2, 0.3, -half],
    [front + 0.08, 0.52, half],
    PLASTIC,
  );
  p.box('detail', [back - 0.08, 0.3, -half], [back + 0.2, 0.5, half], PLASTIC);
  for (const x of s.axles)
    for (const z of [-1, 1])
      wheel(p, s.wheel, 0.26, x, s.wheel, z * (half - 0.1), z);
  return p;
};

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

const buildTruck = (variant: 'box' | 'tractor' | 'tanker'): Pieces => {
  const tractor = variant !== 'box';
  const p = new Pieces();
  const dark = '#2d3136';
  const plastic = '#43484e';
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
  const rearX = tractor ? -2.5 : -4.45;
  box('detail', [rearX, 0.62, -1.15], [3.9, 1.12, 1.15], dark);
  const mudFrom = tractor ? -2.45 : -3.72;
  const mudTo = tractor ? 0.15 : -1.22;
  box('detail', [mudFrom, 1.02, 0.78], [mudTo, 1.06, 1.24], '#1e1f21', true);
  if (tractor) {
    box('detail', [-1.5, 1.12, -0.75], [0.3, 1.3, 0.75], dark); // fifth wheel
  } else {
    box('detail', [-1.25, 0.45, 1.12], [2.1, 0.88, 1.17], steel, true); // side guards
    box('detail', [-4.53, 0.42, -1.1], [-4.4, 0.6, 1.1], steel); // underrun bar
    box('detail', [-4.48, 0.68, 0.62], [-4.46, 0.86, 0.9], red, true);
    box('detail', [-4.48, 0.68, 0.9], [-4.46, 0.86, 1.0], amber, true);
  }

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
  } else if (tractor) {
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
  } else {
    // ----- Box body -----
    p.add('paint', new BoxGeometry(6.4, 2.98, 2.5).translate(-1.25, 2.61, 0));
    box('detail', [-4.47, 1.2, 0.0], [-4.45, 4.0, 1.14], '#ececea', true); // rear doors
    box('chrome', [-4.48, 1.08, 1.17], [1.98, 1.19, 1.27], undefined, true);
    box('chrome', [-4.48, 4.02, 1.17], [1.98, 4.13, 1.27], undefined, true);
  }

  // ----- Wheels: a ten-sided tyre with a steel hub -----
  const axles =
    variant === 'tanker'
      ? [3.2, -0.5, -1.8, -9.4, -10.7, -12.0]
      : tractor
        ? [3.2, -0.5, -1.8, -10.4, -11.7]
        : [3.2, -1.8, -3.1];
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

const MODEL: Record<VehicleKind, () => Model> = {
  car: () => ({ pieces: buildCar('car'), centre: 0 }),
  hatch: () => ({ pieces: buildCar('hatch'), centre: 0 }),
  sport: () => ({ pieces: buildCar('sport'), centre: 0 }),
  van: () => ({ pieces: buildVan('small'), centre: 0 }),
  bigvan: () => ({ pieces: buildVan('large'), centre: 0 }),
  box: () => ({ pieces: buildTruck('box'), centre: 0.03 }),
  trailer: () => ({ pieces: buildTruck('tractor'), centre: -4.13 }),
  tanker: () => ({ pieces: buildTruck('tanker'), centre: -4.13 }),
};

/**
 * Every parked vehicle of the layout as instanced meshes: per model one mesh per part (paint,
 * cab paint, glass, chrome, details), instance colours carrying each vehicle's paint.
 */
export function buildFleet(b: Build): Group {
  const group = new Group();
  group.name = 'start-row vehicles';
  const mats = materialFor();
  const layout = getLayout();
  for (const kind of Object.keys(MODEL) as VehicleKind[]) {
    const placements: Placement[] = layout.vehicles[kind];
    if (!placements.length) continue;
    const model = MODEL[kind]();
    const { length, width } = VEHICLE_SIZE[kind];
    const matrices = placements.map(({ x, z, heading }) => {
      // Stand on the ground under the four corners, not level at the middle: a long truck on a sloping yard
      // otherwise hangs in the air at one end. Each end / side takes its higher corner (the yard surface is
      // lifted to clear the ground), the body pitches and rolls to match.
      const f = [Math.cos(heading), -Math.sin(heading)];
      const r = [-f[1], f[0]];
      const h = (i: number, j: number) =>
        b.ground(
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
        placements.forEach((pl, i) =>
          mesh.setColorAt(
            i,
            new Color(part === 'cab' ? (pl.cabColor ?? pl.color) : pl.color),
          ),
        );
      mesh.castShadow = part !== 'glass';
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
  }
  return group;
}
