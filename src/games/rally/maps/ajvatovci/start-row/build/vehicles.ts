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
  Material,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
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

/**
 * The parked vehicles of the lots: three cars (a modern hatchback, a small boxy Yugo-style hatch,
 * a 90s sports saloon), two vans (a Caddy-type and a high-roof Transit-type) and three trucks (a
 * cab-over box truck, a tractor unit with a box semi-trailer and the same with a tank semi-trailer). Each is built once from simple side
 * profiles and drawn as instanced meshes, one per part (paint, cab paint, glass,
 * chrome, details), so a hundred vehicles cost a few dozen draw calls. Only what reads from the
 * road is modelled (body, glass, lamps, bumpers, grille, wheels): a car is ~500 triangles, a
 * tractor-trailer ~1500. Models face +x with the origin on the ground under their middle
 * (`centre` shifts the truck models, whose origin is over the rear axle).
 */

type Pt = [number, number];
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

const texturedMaterials = new Map<string, Material>();

/**
 * The material of a textured part (baked trucks). `cab` / `paint` take the instance colour where the texture's tint
 * mask is white (all of it without a mask): the texel's brightness stays, scaled so the panels' own brightness comes
 * out as the paint colour. `detail` shows the texture as it is.
 */
const texturedMaterial = (slot: Slot): Material => {
  const key = slotKey(slot);
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

const buildDump = (back: Back): Pieces => {
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

const buildTruck = (variant: 'box' | 'tractor' | 'tanker'): Pieces => {
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
    // ----- Tank semi-trailer: a white cylinder with dished ends on an underframe, landing legs, a valve
    // cabinet at the rear, a blue stripe down each side and a walkway rail on top (no livery). Built in the old
    // frame (rear axle of the tractor at 0), then shifted under the baked tractor. -----
    const t = new Pieces();
    const tbox = (
      part: Part,
      a: number[],
      b: number[],
      color?: string,
      mirror = false,
    ) => t.box(part, a, b, color, mirror);
    const front = 0.6;
    const rear = -12.5;
    const R = 1.18;
    const y = 2.62;
    const len = front - rear - 2 * R * 0.35;
    const mid = (front + rear) / 2;
    t.add(
      'paint',
      new CylinderGeometry(R, R, len, 14)
        .rotateZ(Math.PI / 2)
        .translate(mid, y, 0),
    );
    for (const [x, s] of [
      [mid + len / 2, 1],
      [mid - len / 2, -1],
    ])
      t.add(
        'paint',
        new SphereGeometry(R, 14, 5, 0, Math.PI * 2, 0, Math.PI / 2)
          .rotateZ((-s * Math.PI) / 2)
          .scale(0.35, 1, 1)
          .translate(x, y, 0),
      );
    tbox(
      'detail',
      [mid - len / 2 + 0.2, y - 0.1, R - 0.01],
      [mid + len / 2 - 0.2, y + 0.1, R + 0.02],
      '#1f5fb4',
      true,
    );
    tbox('detail', [rear + 0.3, 1.12, -0.6], [front - 0.2, 1.48, 0.6], dark); // underframe
    for (const x of [-1.2, -6, -10.6])
      tbox('detail', [x - 0.25, 1.4, -0.95], [x + 0.25, y - 0.6, 0.95], dark); // saddles
    for (const z of [0.9, -0.9])
      tbox('detail', [-3.1, 0.2, z - 0.1], [-2.9, 1.12, z + 0.1], steel); // landing legs
    tbox('detail', [-9.0, 0.6, 1.12], [-3.4, 1.0, 1.17], steel, true); // side guards
    tbox('detail', [rear - 0.1, 1.0, -1.0], [rear + 0.9, 1.9, 1.0], '#c9cdd0'); // valve cabinet
    tbox('detail', [rear - 0.2, 0.42, -1.1], [rear - 0.08, 0.6, 1.1], steel); // underrun bar
    tbox(
      'detail',
      [rear - 0.22, 0.66, 0.62],
      [rear - 0.2, 0.86, 0.9],
      red,
      true,
    );
    tbox(
      'chrome',
      [mid - 4, y + R + 0.12, -0.35],
      [mid + 4, y + R + 0.16, 0.35],
    ); // walkway rail
    for (const x of [mid - 4, mid, mid + 4])
      tbox(
        'chrome',
        [x - 0.03, y + R - 0.05, -0.33],
        [x + 0.03, y + R + 0.14, -0.3],
        undefined,
        true,
      );
    for (const x of [-9.4, -10.7, -12.0])
      for (const z of [-0.9, 0.9]) truckTyre(t, 0.5, x, 0.5, z, Math.sign(z));
    p.append(t, 4.13);
    return p;
  }

  // ----- Rigid box truck: the baked cab, a frame, a box body and two rear axles -----
  baked(p, 'cab');
  const cabBack = truckData('cab').cabBack ?? 1.6;
  const rearX = -4.45;
  const bodyEnd = cabBack - 0.08;
  box('detail', [rearX, 0.62, -1.0], [bodyEnd + 0.4, 1.12, 1.0], dark); // frame
  box('detail', [-3.72, 1.02, 0.78], [-1.22, 1.06, 1.24], '#1e1f21', true); // mudguards
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
  box('detail', [-1.25, 0.45, 1.12], [1.0, 0.88, 1.17], steel, true); // side guards
  box('detail', [rearX - 0.08, 0.42, -1.1], [rearX, 0.6, 1.1], steel); // underrun bar
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

/** A model of the fleet: every parked kind, plus the dump truck and its other backs (shown in place of some box trucks). */
type FleetKind = VehicleKind | Back;

const MODEL: Record<FleetKind, () => Model> = {
  car: () => ({ pieces: buildCar('car'), centre: 0 }),
  hatch: () => ({ pieces: buildCar('hatch'), centre: 0 }),
  sport: () => ({ pieces: buildCar('sport'), centre: 0 }),
  van: () => ({ pieces: buildVan('small'), centre: 0 }),
  bigvan: () => ({ pieces: buildVan('large'), centre: 0 }),
  box: () => ({ pieces: buildTruck('box'), centre: 0.03 }),
  trailer: () => ({ pieces: buildTruck('tractor'), centre: -4.13 }),
  tanker: () => ({ pieces: buildTruck('tanker'), centre: 0 }),
  tipper: () => ({ pieces: buildDump('tipper'), centre: 0 }),
  flatbed: () => ({ pieces: buildDump('flatbed'), centre: 0 }),
  vanbody: () => ({ pieces: buildDump('vanbody'), centre: 0 }),
  tank: () => ({ pieces: buildDump('tank'), centre: 0 }),
};

/** The dump trucks take every few of the box-truck places, with the four backs in turn. */
const DUMP_CYCLE: (Back | undefined)[] = [
  undefined,
  'tipper',
  undefined,
  'flatbed',
  undefined,
  'vanbody',
  undefined,
  'tank',
];
/** Paint of a dump truck's back (the cab keeps the truck palette). */
const BACK_PAINT: Record<Back, string[]> = {
  tipper: ['#e0a020', '#c96f1d', '#e8c020', '#7b8288'],
  flatbed: ['#2f5d8a', '#a8322c', '#7b8288', '#e0a020'],
  vanbody: ['#f4f4f2', '#dfe3e6', '#2f5d8a', '#3b7a57'],
  tank: ['#eef0f0', '#dfe3e6', '#e0a020'],
};

/** Placements per model: a box truck's place goes to a dump truck by `DUMP_CYCLE`. */
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
      const back = DUMP_CYCLE[i % DUMP_CYCLE.length];
      const fleet: FleetKind = back ?? 'box';
      const paint = back
        ? { ...pl, color: BACK_PAINT[back][i % BACK_PAINT[back].length] }
        : pl;
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
  for (const [fleet, kind, placements] of fleetOf(layout)) {
    if (!placements.length) continue;
    const model = MODEL[fleet]();
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
