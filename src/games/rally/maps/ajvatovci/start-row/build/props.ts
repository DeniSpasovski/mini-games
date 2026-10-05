import {
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  LatheGeometry,
  Matrix4,
  Vector2,
} from 'three';
import type { Frame } from './kit';
import { placeAt } from './ctx';
import type { Wall } from './wall';

/**
 * Small props of the street and the yards: wire fences, pillars, power poles with their wires,
 * roof units, solar fields, cartons, striped barriers, boom barriers, sign pylon, garden pots,
 * planters, benches. Each adds its pieces to a frame; `lift(x, z)` drapes the piece on the terrain
 * (street dressing); inside a lot's frame heights are above the pad.
 */

type Lift = (x: number, z: number) => number;

/** Points every `spacing` metres along a line, with the direction there. */
export function every(
  line: Vector2[],
  spacing: number,
  start = spacing / 2,
): { p: Vector2; dir: Vector2 }[] {
  const out: { p: Vector2; dir: Vector2 }[] = [];
  let next = start;
  let walked = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const length = a.distanceTo(b);
    while (next <= walked + length) {
      out.push({
        p: a.clone().lerp(b, (next - walked) / length),
        dir: b.clone().sub(a).normalize(),
      });
      next += spacing;
    }
    walked += length;
  }
  return out;
}

export interface FenceOptions {
  /** The mesh runs from `bottom` to `top` m (default 0.1 to 1.8). */
  bottom?: number;
  top?: number;
  /** A low concrete base under the mesh (then `bottom` is its height). */
  base?: boolean;
  /** Post paint (default galvanised grey). */
  post?: string;
  postTop?: number;
  /** Square posts instead of round. */
  square?: boolean;
  /** Posts spread evenly over the run (ends included) instead of every 2.5 m. */
  even?: boolean;
  /** Heavier gate posts at both ends. */
  gatePost?: boolean;
  /** A last post at the end of the run. */
  endPost?: boolean;
  lift?: Lift;
}

/** A wire-mesh fence along `line` with a post every 2.5 m (the street's and the yards'). */
export function meshFence(
  f: Frame,
  line: Vector2[],
  o: FenceOptions = {},
): void {
  if (line.length < 2) return;
  const bottom = o.bottom ?? 0.1;
  const top = o.top ?? 1.8;
  const lift = o.lift;
  if (o.base)
    f.sweep(
      'concrete',
      line,
      [
        [-0.1, 0.02],
        [-0.1, bottom],
        [0.1, bottom],
        [0.1, 0.02],
      ],
      '#d4d1ca',
      { lift },
    );
  f.sweep(
    'fence',
    line,
    [
      [0, bottom],
      [0, top],
    ],
    '#ffffff',
    { lift },
  );
  // A top rail and a bottom rail make the mesh read as a framed panel.
  const rail = (y: number) =>
    f.sweep(
      'metal',
      line,
      [
        [-0.02, y],
        [0.02, y],
        [0.02, y + 0.04],
        [-0.02, y + 0.04],
        [-0.02, y],
      ],
      '#8f969b',
      { lift },
    );
  rail(top - 0.04);
  rail(bottom + 0.02);
  const spots: Vector2[] = [];
  if (o.even) {
    const length = line.reduce(
      (s, q, i) => (i ? s + q.distanceTo(line[i - 1]) : 0),
      0,
    );
    const count = Math.max(1, Math.round(length / 2.5));
    for (const { p } of every(line, length / count, 0)) spots.push(p);
    spots.push(line[line.length - 1]);
  } else {
    for (const { p } of every(line, 2.5, 0)) spots.push(p);
    if (o.endPost) spots.push(line[line.length - 1]);
  }
  const postTop = o.postTop ?? 1.9;
  const color = o.post ?? '#8d9296';
  for (const at of spots) {
    const y = lift ? lift(at.x, at.y) : 0;
    if (o.square)
      f.box(
        'paint',
        [at.x - 0.035, y, at.y - 0.035],
        [at.x + 0.035, y + postTop, at.y + 0.035],
        color,
        {
          bottom: false,
        },
      );
    else
      f.add(
        'metal',
        new CylinderGeometry(0.035, 0.035, postTop, 6).translate(
          0,
          postTop / 2,
          0,
        ),
        color,
        { matrix: placeAt(at.x, y, at.y) },
      );
  }
  if (o.gatePost)
    for (const at of [line[0], line[line.length - 1]]) {
      const y = lift ? lift(at.x, at.y) : 0;
      f.add(
        'metal',
        new CylinderGeometry(0.08, 0.08, 2.3, 8).translate(0, 1.15, 0),
        '#b9b5ac',
        { matrix: placeAt(at.x, y, at.y) },
      );
    }
}

/** A square stone pillar `size` m across and `height` m tall at `at`. */
export function pillar(
  f: Frame,
  at: Vector2,
  lift?: Lift,
  height = 2.2,
  size = 0.44,
): void {
  const y = lift ? lift(at.x, at.y) : 0;
  f.box(
    'concrete',
    [at.x - size / 2, y - 0.1, at.y - size / 2],
    [at.x + size / 2, y + height, at.y + size / 2],
    '#d9d6cf',
  );
  f.box(
    'concrete',
    [at.x - size / 2 - 0.04, y + height, at.y - size / 2 - 0.04],
    [at.x + size / 2 + 0.04, y + height + 0.07, at.y + size / 2 + 0.04],
    '#c9c6bf',
  );
}

// ----- Power poles -----

/** Where the three wires hang from a crossarm (m across the road). */
const POLE_WIRES = [-0.75, 0, 0.75];
const WIRE_TOP = 8.85;

/**
 * A concrete power pole at `at` with a crossarm over the road (`dir` is the road's direction), and
 * a street lamp on an arm if `lamp`.
 */
export function powerPole(
  f: Frame,
  at: Vector2,
  dir: Vector2,
  lamp: boolean,
  lift: Lift,
): void {
  const y = lift(at.x, at.y);
  const across = new Vector2(dir.y, -dir.x); // left of travel = north, over the road
  const turn = new Matrix4()
    .makeRotationY(Math.atan2(-across.y, across.x))
    .setPosition(at.x, y, at.y);
  f.add(
    'paint',
    new CylinderGeometry(0.11, 0.17, 9, 8).translate(0, 4.5, 0),
    '#bdb9b0',
    {
      matrix: placeAt(at.x, y, at.y),
    },
  );
  // Crossarm and insulators.
  f.box('metal', [-0.95, 8.55, -0.06], [0.95, 8.67, 0.06], '#5d6268', {
    matrix: turn,
  });
  for (const o of POLE_WIRES)
    f.add(
      'paint',
      new CylinderGeometry(0.04, 0.05, 0.2, 6).translate(o, 8.76, 0),
      '#7c8085',
      {
        matrix: turn,
      },
    );
  // Climbing steps up the shaft.
  for (let k = 0; k < 6; k++)
    f.box(
      'metal',
      [-0.2, 2.4 + k * 0.4, -0.02],
      [0.2, 2.44 + k * 0.4, 0.02],
      '#4d5156',
      {
        matrix: turn,
      },
    );
  if (lamp) {
    f.box('metal', [0, 7.3, -0.04], [2.2, 7.38, 0.04], '#5d6268', {
      matrix: turn,
    });
    f.box('metal', [1.9, 7.2, -0.15], [2.6, 7.34, 0.15], '#6a6f74', {
      matrix: turn,
    });
    f.box('paint', [1.95, 7.18, -0.12], [2.55, 7.2, 0.12], '#f4f1e6', {
      matrix: turn,
    });
  }
}

/** The three wires between two poles, each sagging a little: thin crossed ribbons. */
export function powerWires(
  f: Frame,
  a: { p: Vector2; dir: Vector2; y: number },
  b: { p: Vector2; dir: Vector2; y: number },
): void {
  const left = (d: Vector2) => new Vector2(d.y, -d.x);
  for (const o of POLE_WIRES) {
    const from = a.p.clone().addScaledVector(left(a.dir), o);
    const to = b.p.clone().addScaledVector(left(b.dir), o);
    const steps = 8;
    const at = (s: number): [number, number, number] => {
      const q = from.clone().lerp(to, s);
      const base = a.y + (b.y - a.y) * s;
      return [q.x, base + WIRE_TOP - 0.7 * 4 * s * (1 - s), q.y];
    };
    for (let s = 0; s < steps; s++) {
      const p0 = at(s / steps);
      const p1 = at((s + 1) / steps);
      const w = 0.018;
      // Horizontal and vertical ribbons, so the wire is visible from any side.
      f.quad(
        'metal',
        [p0[0], p0[1], p0[2] - w],
        [p1[0], p1[1], p1[2] - w],
        [p1[0], p1[1], p1[2] + w],
        [p0[0], p0[1], p0[2] + w],
        '#2f3235',
      );
      f.quad(
        'metal',
        [p0[0], p0[1] + w, p0[2]],
        [p1[0], p1[1] + w, p1[2]],
        [p1[0], p1[1] - w, p1[2]],
        [p0[0], p0[1] - w, p0[2]],
        '#2f3235',
      );
    }
  }
}

// ----- Wall-mounted and roof equipment -----

/** An air-conditioning condenser on the ground against a wall, `u0` to `u1` along it. */
export function condenser(w: Wall, [u0, u1]: [number, number]): void {
  w.box('metal', [u0, u1], [0.05, 0.8], [0.1, 0.8], '#a9adb0');
  // Fan grille on the front and louvres on the side.
  w.panel('paint', [u0 + 0.12, u1 - 0.12], [0.2, 0.7], 0.805, '#4a4d50');
  for (let y = 0.2; y < 0.7; y += 0.09)
    w.panel('metal', [u0 + 0.12, u1 - 0.12], [y, y + 0.025], 0.81, '#7d8387');
}

/** A white split unit hung on a wall at `u` (its left edge), at the height of an upper window. */
export function splitUnit(w: Wall, u: number, y = 4.8): void {
  w.box('paint', [u, u + 0.8], [y, y + 0.6], [0, 0.4], '#f4f4f2');
  w.panel(
    'paint',
    [u + 0.05, u + 0.75],
    [y + 0.08, y + 0.14],
    0.405,
    '#cfd2d4',
  );
}

/** A plain rooftop unit centred at `at`, `w` x `d` m and `height` m tall, on a roof at `roofY`. */
export function roofUnit(
  f: Frame,
  at: Vector2,
  w: number,
  d: number,
  roofY: number,
  height: number,
): void {
  f.box(
    'metal',
    [at.x - w / 2, roofY, at.y - d / 2],
    [at.x + w / 2, roofY + height, at.y + d / 2],
    '#a9adb0',
    {
      bottom: false,
    },
  );
  // Fan cover and a service panel.
  f.box(
    'paint',
    [at.x - w / 2 + 0.2, roofY + height, at.y - d / 2 + 0.2],
    [at.x + w / 2 - 0.2, roofY + height + 0.04, at.y + d / 2 - 0.2],
    '#3d4247',
  );
}

/**
 * A field of solar panels on a flat roof of `corners` (any four): `inset` m in from every edge,
 * `cols` x `rows` panels with 0.8 m gaps, tilted a little, at roof height `y`.
 */
export function solarField(
  f: Frame,
  corners: Vector2[],
  inset: number,
  [cols, rows]: [number, number],
  y: number,
): void {
  // Axis: along the longest edge; cells in that frame.
  let best = 0;
  let axis = new Vector2(1, 0);
  corners.forEach((c, i) => {
    const n = corners[(i + 1) % corners.length];
    const len = c.distanceTo(n);
    if (len > best) {
      best = len;
      axis = n.clone().sub(c).normalize();
    }
  });
  const across = new Vector2(-axis.y, axis.x);
  const us = corners.map((c) => c.dot(axis));
  const vs = corners.map((c) => c.dot(across));
  const u0 = Math.min(...us) + inset;
  const u1 = Math.max(...us) - inset;
  const v0 = Math.min(...vs) + inset;
  const v1 = Math.max(...vs) - inset;
  const gap = 0.8;
  const cw = (u1 - u0 - gap * (cols - 1)) / cols;
  const ch = (v1 - v0 - gap * (rows - 1)) / rows;
  if (cw <= 0.5 || ch <= 0.5) return;
  const pt = (u: number, v: number) =>
    axis.clone().multiplyScalar(u).addScaledVector(across, v);
  for (let i = 0; i < cols; i++)
    for (let j = 0; j < rows; j++) {
      const a = u0 + i * (cw + gap);
      const b = v0 + j * (ch + gap);
      const p00 = pt(a, b);
      const p10 = pt(a + cw, b);
      const p11 = pt(a + cw, b + ch);
      const p01 = pt(a, b + ch);
      const tilt = 0.35;
      // Rows rise towards +across: the high side is `tilt` m above the roof.
      f.quad(
        'solar',
        [p00.x, y + 0.12, p00.y],
        [p10.x, y + 0.12, p10.y],
        [p11.x, y + 0.12 + tilt, p11.y],
        [p01.x, y + 0.12 + tilt, p01.y],
        '#ffffff',
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ],
        { rawUv: true },
      );
      // Frame rails under the panel.
      f.box(
        'metal',
        [p00.x - 0.05, y, p00.y - 0.05],
        [p00.x + 0.05, y + 0.12, p00.y + 0.05],
        '#8b9094',
      );
      f.box(
        'metal',
        [p10.x - 0.05, y, p10.y - 0.05],
        [p10.x + 0.05, y + 0.12, p10.y + 0.05],
        '#8b9094',
      );
    }
}

/** Three cartons stacked just inside an open door, the first starting `u0` along the wall. */
export function cartons(w: Wall, u0: number): void {
  w.box('paint', [u0 + 0.4, u0 + 1.9], [0, 1.2], [-1.2, -0.1], '#a98457');
  w.box('paint', [u0 + 0.6, u0 + 1.7], [1.2, 2.1], [-1.1, -0.2], '#8f6d44');
  w.box('paint', [u0 + 2.3, u0 + 3.9], [0, 1.5], [-1.3, -0.2], '#a98457');
}

/** A low red-and-white striped concrete barrier along the run `a` to `b`. */
export function stripedBarrier(
  f: Frame,
  a: Vector2,
  b: Vector2,
  lift?: Lift,
): void {
  f.sweep(
    'barrier',
    [a, b],
    [
      [-0.3, 0],
      [-0.3, 0.2],
      [-0.12, 0.9],
      [0.12, 0.9],
      [0.3, 0.2],
      [0.3, 0],
    ],
    '#ffffff',
    { lift },
  );
}

/** A boom barrier at `at`, its striped arm raised: a white housing and the arm in red and white segments. */
export function boomBarrier(
  f: Frame,
  at: Vector2,
  dir: Vector2,
  lift?: Lift,
): void {
  const y = lift ? lift(at.x, at.y) : 0;
  const turn = placeAt(at.x, y, at.y, Math.atan2(-dir.y, dir.x));
  f.box('paint', [-0.2, 0, -0.2], [0.2, 1.1, 0.2], '#e8e8e4', { matrix: turn });
  f.box('paint', [-0.21, 0.6, -0.21], [0.21, 0.72, 0.21], '#c8322c', {
    matrix: turn,
  });
  for (let k = 0; k < 10; k++)
    f.add(
      'paint',
      new CylinderGeometry(0.04, 0.04, 0.5, 6).translate(
        0,
        1.1 + k * 0.5 + 0.25,
        0,
      ),
      k % 2 ? '#c8322c' : '#f1efeb',
      { matrix: turn },
    );
}

/** A sign pylon at wall position `u`, standing `out` m from the wall: dark post, grey panel edged in red, a dark head and chevron blocks. */
export function signPylon(w: Wall, u: number, out = 4): void {
  w.box(
    'paint',
    [u - 0.15, u + 0.15],
    [0, 7.2],
    [out - 0.1, out + 0.3],
    '#4a5056',
  );
  w.box('paint', [u - 1.1, u + 1.1], [3, 7], [out + 0.4, out + 0.6], '#d3d6d8');
  w.box(
    'paint',
    [u - 1.2, u - 1.05],
    [3, 7],
    [out + 0.35, out + 0.65],
    '#c8322b',
  );
  w.box(
    'paint',
    [u + 1.05, u + 1.2],
    [3, 7],
    [out + 0.35, out + 0.65],
    '#c8322b',
  );
  w.box(
    'paint',
    [u - 1.0, u + 1.0],
    [6.2, 7.6],
    [out + 0.35, out + 0.65],
    '#26282b',
  );
  for (let k = 0; k < 3; k++)
    w.box(
      'paint',
      [u - 0.8 + k * 0.55, u - 0.45 + k * 0.55],
      [4.3, 5.0],
      [out + 0.5, out + 0.7],
      '#c8322b',
    );
}

// ----- The Mileks front garden -----

/** A stone urn: foot, waist, belly, lipped rim. */
const URN = new LatheGeometry(
  [
    [0, 0],
    [0.24, 0],
    [0.24, 0.04],
    [0.18, 0.08],
    [0.16, 0.15],
    [0.2, 0.26],
    [0.27, 0.38],
    [0.29, 0.46],
    [0.26, 0.55],
    [0.3, 0.57],
    [0.3, 0.62],
    [0.25, 0.62],
    [0.25, 0.56],
  ].map(([r, y]) => new Vector2(r, y)),
  16,
);

/** A stone urn on a square plinth with a clipped ball of box on a short stem, at (x, z). */
export function stonePot(f: Frame, x: number, z: number): void {
  const m = placeAt(x, 0, z);
  f.box('concrete', [-0.3, 0, -0.3], [0.3, 0.08, 0.3], '#d9d6cf', {
    matrix: m,
  });
  f.box('concrete', [-0.27, 0.08, -0.27], [0.27, 0.11, 0.27], '#d9d6cf', {
    matrix: m,
  });
  f.add('concrete', URN.clone().translate(0, 0.11, 0), '#d9d6cf', {
    matrix: m,
  });
  f.add(
    'leaf',
    new CircleGeometry(0.25, 14).rotateX(-Math.PI / 2).translate(0, 0.7, 0),
    '#4a3a2c',
    { matrix: m },
  );
  f.add(
    'leaf',
    new CylinderGeometry(0.02, 0.03, 0.2, 5).translate(0, 0.78, 0),
    '#6b5842',
    { matrix: m },
  );
  f.add(
    'leaf',
    new ConeGeometry(0.33, 0.6, 9).translate(0, 1.0, 0),
    '#3f6a30',
    { matrix: m },
  );
}

/** A dark round planter on short feet with a dwarf conifer of stacked tiers, at (x, z). */
export function planter(f: Frame, x: number, z: number): void {
  const m = placeAt(x, 0, z);
  const body = new LatheGeometry(
    [
      [0, 0.075],
      [0.14, 0.075],
      [0.15, 0.1],
      [0.2, 0.6],
      [0.225, 0.62],
      [0.2, 0.64],
      [0.185, 0.58],
    ].map(([r, y]) => new Vector2(r, y)),
    16,
  );
  f.add('paint', body, '#3d4247', { matrix: m });
  f.add(
    'leaf',
    new CircleGeometry(0.19, 14).rotateX(-Math.PI / 2).translate(0, 0.6, 0),
    '#4a3a2c',
    { matrix: m },
  );
  f.add(
    'leaf',
    new CylinderGeometry(0.02, 0.03, 0.3, 5).translate(0, 0.75, 0),
    '#6b5842',
    { matrix: m },
  );
  (
    [
      [0.32, 0.55, 0.62],
      [0.25, 0.5, 0.92],
      [0.17, 0.45, 1.2],
    ] as const
  ).forEach(([radius, height, y], k) =>
    f.add(
      'leaf',
      new ConeGeometry(radius, height, 9, 1)
        .rotateY(k * 0.6)
        .translate(0, y + height / 2, 0),
      k % 2 ? '#3f6a30' : '#4f7a35',
      { matrix: m },
    ),
  );
}

/** A wooden bench 1.5 m long at (x, z), long along its x (turned `yaw`), its back to -z. */
export function bench(f: Frame, x: number, z: number, yaw: number): void {
  const m = placeAt(x, 0, z, yaw);
  const wood = '#a8784f';
  const iron = '#3d4247';
  for (let k = 0; k < 5; k++) {
    const zz = -0.14 + k * 0.085;
    f.box('paint', [-0.75, 0.42, zz - 0.035], [0.75, 0.46, zz + 0.035], wood, {
      matrix: m,
    });
  }
  for (const [y0, y1, zz] of [
    [0.52, 0.6, -0.215],
    [0.63, 0.71, -0.23],
    [0.74, 0.82, -0.245],
  ])
    f.box('paint', [-0.72, y0, zz - 0.012], [0.72, y1, zz + 0.012], wood, {
      matrix: m,
    });
  for (const side of [-1, 1]) {
    const bx = side * 0.68;
    f.box('metal', [bx - 0.025, 0, -0.24], [bx + 0.025, 0.84, -0.2], iron, {
      matrix: m,
    });
    f.box('metal', [bx - 0.025, 0, 0.16], [bx + 0.025, 0.62, 0.2], iron, {
      matrix: m,
    });
    f.box('paint', [bx - 0.035, 0.62, -0.22], [bx + 0.035, 0.65, 0.22], wood, {
      matrix: m,
    });
    f.box('metal', [bx - 0.02, 0.2, -0.22], [bx + 0.02, 0.24, 0.18], iron, {
      matrix: m,
    });
  }
  f.box('metal', [-0.68, 0.22, 0.16], [0.68, 0.25, 0.2], iron, { matrix: m });
}
