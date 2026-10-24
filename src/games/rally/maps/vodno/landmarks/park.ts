import { IcosahedronGeometry, Matrix4, Quaternion, Vector3 } from 'three';
import type { MatKey } from '../../ajvatovci/start-row/build/materials';
import { placeAt, type Local, type V2, type V3 } from './common';

/**
 * Small park and lot furniture for the Vodno car parks, from the Ajvatovci kit (`Local` boxes / fans): timber gazebos
 * and towers, picnic tables, benches, lamps, signs, bins, rail fences, rusty bollards, a lattice tower. Every piece
 * stands at local (x, z) of a site with its base at height `y` (relative to the site's base) and turns by `yaw`
 * (three.js, about Y: a piece's +x runs along the lot's direction `phi` with yaw = -phi). Rough shapes and flat colours.
 */
export const WOOD = '#6d4a2b';
export const LOG = '#5e3a20';
export const DARK_WOOD = '#4a3320';
const GREY = '#9ba1a5';
const WHITE = '#ecece6';
const BLUE = '#1d4fa3';
const GREEN = '#2f6a3b';
const RUST = '#7a4a2e';

const GLOBE = new IcosahedronGeometry(1, 1);

/** A box strut from `a` to `b` (local metres), `t` thick: rails, braces, legs, leaning posts. */
export function strut(
  l: Local,
  a: V3,
  b: V3,
  t: number,
  key: MatKey,
  color: string,
): void {
  const d = new Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = d.length();
  if (len < 1e-4) return;
  const q = new Quaternion().setFromUnitVectors(
    new Vector3(0, 0, 1),
    d.clone().divideScalar(len),
  );
  const m = new Matrix4().compose(
    new Vector3(a[0], a[1], a[2]),
    q,
    new Vector3(1, 1, 1),
  );
  l.box(key, [-t / 2, -t / 2, 0], [t / 2, t / 2, len], color, m);
}

/** A vertical square post from y0 to y1. */
export function post(
  l: Local,
  x: number,
  z: number,
  y0: number,
  y1: number,
  t: number,
  key: MatKey,
  color: string,
): void {
  l.box(key, [x - t / 2, y0, z - t / 2], [x + t / 2, y1, z + t / 2], color);
}

/** A horizontal board between two local points (x, z), y0..y1 tall, `t` thick. */
export function wallSeg(
  l: Local,
  a: V2,
  b: V2,
  y0: number,
  y1: number,
  t: number,
  key: MatKey,
  color: string,
): void {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 0.01) return;
  const yaw = -Math.atan2(b[1] - a[1], b[0] - a[0]);
  l.box(
    key,
    [-len / 2, y0, -t / 2],
    [len / 2, y1, t / 2],
    color,
    placeAt((a[0] + b[0]) / 2, 0, (a[1] + b[1]) / 2, yaw),
  );
}

/** A turned point of a piece frame (x right, z across) in the site's frame. */
const turn =
  (cx: number, cz: number, yaw: number) =>
  (px: number, pz: number): V2 => [
    cx + px * Math.cos(yaw) + pz * Math.sin(yaw),
    cz - px * Math.sin(yaw) + pz * Math.cos(yaw),
  ];

/** A timber picnic table with two benches, 2 m long along the piece's x. */
export function picnicTable(
  l: Local,
  x: number,
  y: number,
  z: number,
  yaw: number,
): void {
  const m = placeAt(x, y, z, yaw);
  l.box('paint', [-1, 0.74, -0.4], [1, 0.8, 0.4], WOOD, m);
  for (const s of [-1, 1]) {
    l.box(
      'paint',
      [-1, 0.42, s * 0.78 - 0.14],
      [1, 0.47, s * 0.78 + 0.14],
      WOOD,
      m,
    );
    for (const e of [-0.8, 0.8])
      l.box(
        'paint',
        [e - 0.04, 0, s * 0.78 - 0.04],
        [e + 0.04, 0.42, s * 0.78 + 0.04],
        DARK_WOOD,
        m,
      );
  }
  for (const e of [-0.7, 0.7])
    l.box('paint', [e - 0.04, 0, -0.34], [e + 0.04, 0.74, 0.34], DARK_WOOD, m);
}

/** A park bench, 1.7 m long along the piece's x, its back towards -z. */
export function bench(
  l: Local,
  x: number,
  y: number,
  z: number,
  yaw: number,
  color = GREEN,
): void {
  const m = placeAt(x, y, z, yaw);
  for (const k of [0, 1, 2])
    l.box(
      'paint',
      [-0.85, 0.44, -0.2 + k * 0.14],
      [0.85, 0.48, -0.08 + k * 0.14],
      color,
      m,
    );
  for (const k of [0, 1])
    l.box(
      'paint',
      [-0.85, 0.62 + k * 0.14, -0.24],
      [0.85, 0.7 + k * 0.14, -0.2],
      color,
      m,
    );
  for (const e of [-0.75, 0.75]) {
    l.box('metal', [e - 0.03, 0, -0.22], [e + 0.03, 0.46, -0.16], '#3a3d3f', m);
    l.box('metal', [e - 0.03, 0, 0.12], [e + 0.03, 0.46, 0.18], '#3a3d3f', m);
  }
}

/**
 * A street lamp: a pole `h` m tall with an arm of `reach` m towards +z of the piece (over the lot) and a lamp head.
 */
export function lampPost(
  l: Local,
  x: number,
  y: number,
  z: number,
  yaw: number,
  h = 6.5,
  reach = 1.7,
): void {
  const m = placeAt(x, y, z, yaw);
  l.box('metal', [-0.07, -0.3, -0.07], [0.07, h, 0.07], GREY, m);
  l.box('metal', [-0.05, h - 0.1, -0.05], [0.05, h, reach], GREY, m);
  l.box(
    'metal',
    [-0.2, h - 0.2, reach - 0.5],
    [0.2, h - 0.1, reach + 0.3],
    '#d9dcde',
    m,
  );
}

/** A solar lamp on a green pole: a curved arm with a globe, a small solar panel on the pole. */
export function solarLamp(
  l: Local,
  x: number,
  y: number,
  z: number,
  yaw: number,
  h = 3.6,
): void {
  const m = placeAt(x, y, z, yaw);
  l.box('metal', [-0.05, -0.3, -0.05], [0.05, h, 0.05], GREEN, m);
  // The arm bends over in three straight pieces.
  const arm: V3[] = [
    [0, h - 0.4, 0],
    [0.2, h + 0.05, 0],
    [0.65, h + 0.3, 0],
    [1.05, h + 0.2, 0],
  ];
  for (let i = 0; i + 1 < arm.length; i++) {
    const a = arm[i];
    const b = arm[i + 1];
    const d = new Vector3(b[0] - a[0], b[1] - a[1], 0);
    const len = d.length();
    const ang = Math.atan2(d.y, d.x);
    l.box(
      'metal',
      [0, -0.025, -0.025],
      [len, 0.025, 0.025],
      GREEN,
      m
        .clone()
        .multiply(new Matrix4().makeTranslation(a[0], a[1], a[2]))
        .multiply(new Matrix4().makeRotationZ(ang)),
    );
  }
  l.add(
    'paint',
    GLOBE,
    '#f2f2ea',
    m
      .clone()
      .multiply(
        new Matrix4().compose(
          new Vector3(1.05, h - 0.05, 0),
          new Quaternion(),
          new Vector3(0.2, 0.2, 0.2),
        ),
      ),
  );
  // A solar panel on a tilted bracket at the top of the pole.
  l.box(
    'solar',
    [-0.3, 0, -0.2],
    [0.3, 0.04, 0.2],
    '#ffffff',
    m
      .clone()
      .multiply(new Matrix4().makeTranslation(-0.15, h + 0.1, 0))
      .multiply(new Matrix4().makeRotationZ(0.45)),
  );
}

/** The blue parking sign on a pole (a white P from boxes). */
export function parkingSign(
  l: Local,
  x: number,
  y: number,
  z: number,
  yaw: number,
): void {
  const m = placeAt(x, y, z, yaw);
  l.box('metal', [-0.03, -0.3, -0.03], [0.03, 2.5, 0.03], GREY, m);
  l.box('paint', [-0.32, 1.9, 0.03], [0.32, 2.54, 0.05], BLUE, m);
  const w = (x0: number, y0: number, x1: number, y1: number) =>
    l.box('paint', [x0, y0, 0.05], [x1, y1, 0.062], WHITE, m);
  w(-0.17, 1.98, -0.1, 2.46);
  w(-0.17, 2.38, 0.1, 2.46);
  w(-0.17, 2.2, 0.1, 2.28);
  w(0.1, 2.2, 0.17, 2.46);
}

/** A pay-and-display style information board: two grey poles and a two-part panel (orange header, white body). */
export function infoBoard(
  l: Local,
  x: number,
  y: number,
  z: number,
  yaw: number,
): void {
  const m = placeAt(x, y, z, yaw);
  for (const s of [-0.5, 0.5])
    l.box('metal', [s - 0.03, -0.3, -0.03], [s + 0.03, 2.3, 0.03], GREY, m);
  l.box('paint', [-0.62, 1.3, 0.03], [0.04, 2.3, 0.07], '#2d6fb6', m);
  l.box('paint', [-0.62, 1.95, 0.07], [0.04, 2.25, 0.075], '#d9632b', m);
  l.box('paint', [-0.62, 1.34, 0.07], [0.04, 1.9, 0.075], WHITE, m);
  l.box('paint', [0.06, 1.3, 0.03], [0.68, 2.3, 0.07], WHITE, m);
  l.box('paint', [0.06, 2.0, 0.07], [0.68, 2.25, 0.075], '#d9632b', m);
}

/** A big brown notice board on two log posts with a green cap. */
export function woodBoard(
  l: Local,
  x: number,
  y: number,
  z: number,
  yaw: number,
  width = 2.8,
): void {
  const m = placeAt(x, y, z, yaw);
  const h = width / 2;
  for (const s of [-h + 0.1, h - 0.1])
    l.box('paint', [s - 0.1, -0.4, -0.1], [s + 0.1, 3.1, 0.1], LOG, m);
  l.box('paint', [-h, 1.8, 0.1], [h, 2.9, 0.18], '#5b3a24', m);
  l.box('paint', [-h - 0.06, 2.9, 0.06], [h + 0.06, 3.02, 0.24], '#2d5a3a', m);
}

/** A waste bin on a post. */
export function bin(
  l: Local,
  x: number,
  y: number,
  z: number,
  yaw: number,
  color = GREEN,
): void {
  const m = placeAt(x, y, z, yaw);
  l.box('metal', [-0.03, -0.3, -0.03], [0.03, 0.55, 0.03], GREY, m);
  l.box('paint', [-0.24, 0.55, -0.22], [0.24, 1.02, 0.22], color, m);
  l.box('paint', [-0.26, 1.02, -0.24], [0.26, 1.07, 0.24], '#233a28', m);
}

/** A row of wheeled waste containers (green) with a recycling bell (teal) at one end, `n` containers along +x. */
export function containers(
  l: Local,
  x: number,
  y: number,
  z: number,
  yaw: number,
  n = 4,
): void {
  const m = placeAt(x, y, z, yaw);
  l.box('paint', [-0.55, 0, -0.5], [0.55, 1.6, 0.5], '#2c8a86', m);
  l.box('paint', [-0.5, 1.6, -0.45], [0.5, 1.72, 0.45], '#237370', m);
  for (let i = 0; i < n; i++) {
    const cx = 1.5 + i * 1.12;
    l.box(
      'paint',
      [cx - 0.52, 0.12, -0.42],
      [cx + 0.52, 1.15, 0.42],
      '#2f6d3b',
      m,
    );
    l.box(
      'paint',
      [cx - 0.55, 1.15, -0.45],
      [cx + 0.55, 1.22, 0.45],
      '#244f2d',
      m,
    );
    l.box('metal', [cx - 0.5, 0, -0.3], [cx + 0.5, 0.12, 0.3], '#2a2c2e', m);
  }
}

/** A log rail fence along a polyline (site local x, z): posts every ~2 m, two rails. `yAt` = ground height there. */
export function logRail(
  l: Local,
  pts: V2[],
  yAt: (x: number, z: number) => number,
  h = 1.05,
): void {
  // Posts every 2 m along the polyline (and at its ends).
  const posts: V3[] = [];
  let next = 0;
  let run = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    for (; next <= run + len; next += 2) {
      const t = (next - run) / (len || 1);
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      posts.push([x, yAt(x, z), z]);
    }
    run += len;
  }
  const last = pts[pts.length - 1];
  if (next - 2 < run - 0.3)
    posts.push([last[0], yAt(last[0], last[1]), last[1]]);
  for (const [x, y, z] of posts)
    post(l, x, z, y - 0.35, y + h, 0.14, 'paint', LOG);
  for (let i = 0; i + 1 < posts.length; i++) {
    const a = posts[i];
    const b = posts[i + 1];
    for (const k of [0.5, 0.95])
      strut(
        l,
        [a[0], a[1] + k * h, a[2]],
        [b[0], b[1] + k * h, b[2]],
        0.08,
        'paint',
        WOOD,
      );
  }
}

/** A pitched pyramid roof over a regular `n`-gon: eave ring at `y0` (radius `r`), apex at `apex`. */
function pyramidRoof(
  l: Local,
  at: (px: number, pz: number) => V2,
  y0: number,
  r: number,
  apex: number,
  n: number,
  key: MatKey,
  color: string,
  under: string,
): void {
  const ring: V2[] = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    ring.push(at(Math.cos(a) * r, Math.sin(a) * r));
  }
  const c = at(0, 0);
  for (let k = 0; k < n; k++) {
    const a = ring[k];
    const b = ring[(k + 1) % n];
    l.fan(
      key,
      [
        [a[0], y0, a[1]],
        [b[0], y0, b[1]],
        [c[0], apex, c[1]],
      ],
      color,
      [0, 1, 0],
      (p) => [p[0], p[2]],
    );
    l.fan(
      'paint',
      [
        [a[0], y0 - 0.1, a[1]],
        [b[0], y0 - 0.1, b[1]],
        [c[0], apex - 0.1, c[1]],
      ],
      under,
      [0, -1, 0],
      (p) => [p[0], p[2]],
    );
    // The eave edge, so the roof is a slab.
    const out: V3 = [(a[0] + b[0]) / 2 - c[0], 0, (a[1] + b[1]) / 2 - c[1]];
    l.fan(
      'paint',
      [
        [a[0], y0, a[1]],
        [b[0], y0, b[1]],
        [b[0], y0 - 0.1, b[1]],
        [a[0], y0 - 0.1, a[1]],
      ],
      under,
      out,
      () => [0, 0],
    );
  }
}

export interface GazeboOptions {
  /** Distance from the centre to a side (m). */
  apothem: number;
  /** Roof colour and material. */
  roof: string;
  roofKey?: MatKey;
  /** Sides (0..7, side k faces angle k * 45 deg of the piece) left open. */
  open?: number[];
  /** Picnic tables inside. */
  tables?: number;
}

/**
 * An octagonal timber gazebo: log posts at the corners, a low plank wall on the closed sides, a pitched pyramid roof and
 * picnic tables inside. Local site frame, centre (cx, cz), base height `y`.
 */
export function gazebo(
  l: Local,
  cx: number,
  y: number,
  cz: number,
  yaw: number,
  o: GazeboOptions,
): void {
  const at = turn(cx, cz, yaw);
  const R = o.apothem / Math.cos(Math.PI / 8);
  const H = 2.5;
  const corner = (k: number): V2 => {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    return at(Math.cos(a) * R, Math.sin(a) * R);
  };
  const open = new Set(o.open ?? []);
  for (let k = 0; k < 8; k++) {
    const c = corner(k);
    post(l, c[0], c[1], y - 0.4, y + H, 0.22, 'paint', LOG);
    if (!open.has(k)) {
      const d = corner((k + 1) % 8);
      // Low plank wall with a rail on top.
      wallSeg(l, c, d, y + 0.2, y + 1.15, 0.07, 'paint', '#6b2e1f');
      wallSeg(l, c, d, y + 1.15, y + 1.22, 0.14, 'paint', WOOD);
    }
    const d2 = corner((k + 1) % 8);
    // The beam on the posts' tops.
    wallSeg(l, c, d2, y + H - 0.25, y + H, 0.16, 'paint', LOG);
  }
  // Floor: packed earth, a little over the ground.
  const floor: V3[] = [];
  for (let k = 0; k < 8; k++)
    floor.push([corner(k)[0], y + 0.04, corner(k)[1]]);
  l.fan('paint', floor, '#5b4a3a', [0, 1, 0], (p) => [p[0], p[2]]);
  pyramidRoof(
    l,
    at,
    y + H - 0.2,
    R + 0.75,
    y + H + 1.9,
    8,
    o.roofKey ?? 'sheet',
    o.roof,
    '#5a4636',
  );
  l.box(
    'paint',
    [cx - 0.1, y + H + 1.8, cz - 0.1],
    [cx + 0.1, y + H + 2.2, cz + 0.1],
    DARK_WOOD,
  );
  const tables = o.tables ?? 2;
  for (let i = 0; i < tables; i++) {
    const a = (i / Math.max(1, tables)) * Math.PI * 2 + 0.4;
    const [tx, tz] = at(
      Math.cos(a) * o.apothem * 0.45,
      Math.sin(a) * o.apothem * 0.45,
    );
    picnicTable(l, tx, y, tz, yaw - a + Math.PI / 2);
  }
}

/** A timber watch tower with a hip roof (the entrance of the park): four log posts, X bracing, a platform, a roof. */
export function timberTower(
  l: Local,
  x: number,
  y: number,
  z: number,
  yaw: number,
): void {
  const at = turn(x, z, yaw);
  const h = 0.8;
  const corners: V2[] = [at(-h, -h), at(h, -h), at(h, h), at(-h, h)];
  for (const c of corners)
    post(l, c[0], c[1], y - 0.4, y + 5.2, 0.28, 'paint', LOG);
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    for (const lv of [0, 1]) {
      const y0 = y + 0.5 + lv * 2;
      const y1 = y0 + 2;
      strut(l, [a[0], y0, a[1]], [b[0], y1, b[1]], 0.14, 'paint', WOOD);
      strut(l, [a[0], y1, a[1]], [b[0], y0, b[1]], 0.14, 'paint', WOOD);
      wallSeg(l, a, b, y1 - 0.08, y1 + 0.08, 0.2, 'paint', LOG);
    }
  }
  // The platform and the roof.
  l.fan(
    'paint',
    corners.map((c): V3 => [c[0], y + 4.5, c[1]]),
    '#5b3a24',
    [0, 1, 0],
    (p) => [p[0], p[2]],
  );
  pyramidRoof(l, at, y + 5.0, 1.75, y + 6.7, 4, 'tiles', '#8b4a42', '#4a3a30');
  // A notice on one face.
  const a = corners[0];
  const b = corners[1];
  wallSeg(
    l,
    [a[0] + (b[0] - a[0]) * 0.2, a[1] + (b[1] - a[1]) * 0.2],
    [a[0] + (b[0] - a[0]) * 0.8, a[1] + (b[1] - a[1]) * 0.8],
    y + 1.1,
    y + 1.9,
    0.2,
    'paint',
    '#e6e2d6',
  );
}

/** A mesh crowd barrier panel (2.2 m) between two local points; `n` panels along. */
export function crowdBarrier(
  l: Local,
  a: V2,
  b: V2,
  yAt: (x: number, z: number) => number,
): void {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.max(1, Math.round(len / 2.2));
  for (let i = 0; i < n; i++) {
    const p0: V2 = [
      a[0] + ((b[0] - a[0]) * i) / n,
      a[1] + ((b[1] - a[1]) * i) / n,
    ];
    const p1: V2 = [
      a[0] + ((b[0] - a[0]) * (i + 1)) / n,
      a[1] + ((b[1] - a[1]) * (i + 1)) / n,
    ];
    const y = yAt((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2);
    wallSeg(l, p0, p1, y + 0.05, y + 0.1, 0.04, 'metal', '#8d9296');
    wallSeg(l, p0, p1, y + 1.05, y + 1.1, 0.04, 'metal', '#8d9296');
    wallSeg(l, p0, p1, y + 0.1, y + 1.05, 0.02, 'fence', '#9ba1a5');
    for (const p of [p0, p1])
      post(l, p[0], p[1], y, y + 1.1, 0.05, 'metal', '#8d9296');
  }
}

/** A rusty steel bollard sticking out of the asphalt, leaning by `lean` rad towards `dir`. */
export function bollard(
  l: Local,
  x: number,
  y: number,
  z: number,
  dir: number,
  lean: number,
  h = 0.95,
): void {
  const top: V3 = [
    x + Math.cos(dir) * Math.sin(lean) * h,
    y + Math.cos(lean) * h,
    z + Math.sin(dir) * Math.sin(lean) * h,
  ];
  strut(l, [x, y - 0.1, z], top, 0.1, 'metal', RUST);
  strut(
    l,
    [top[0] - (top[0] - x) * 0.12, top[1] - 0.1, top[2] - (top[2] - z) * 0.12],
    top,
    0.11,
    'paint',
    '#2a2a2a',
  );
}

/** A coin-operated binocular viewer on a ring base (the Vidikovec's). */
export function binocular(
  l: Local,
  x: number,
  y: number,
  z: number,
  yaw: number,
): void {
  const m = placeAt(x, y, z, yaw);
  l.box('metal', [-0.1, 0, -0.1], [0.1, 1.5, 0.1], '#1d1f21', m);
  l.box('paint', [-0.16, 1.4, -0.08], [0.16, 1.62, 0.12], '#1d1f21', m);
  for (const [x0, x1, z0, z1] of [
    [-0.5, 0.5, -0.5, -0.45],
    [-0.5, 0.5, 0.45, 0.5],
    [-0.5, -0.45, -0.5, 0.5],
    [0.45, 0.5, -0.5, 0.5],
  ])
    l.box('metal', [x0, 0.08, z0], [x1, 0.13, z1], '#7d8286', m);
}

/** A yellow steel lattice tower (the Vidikovec lookout): tapered, four legs, X bracing, a top platform and a solar panel. */
export function latticeTower(
  l: Local,
  x: number,
  y: number,
  z: number,
  yaw: number,
  height = 9,
): void {
  const at = turn(x, z, yaw);
  const yellow = '#d6ab1c';
  const half = (v: number): number => 1.15 - 0.45 * (v / height);
  const level = (v: number): V3[] =>
    [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([sx, sz]) => {
      const p = at(sx * half(v), sz * half(v));
      return [p[0], y + v, p[1]];
    });
  const base = level(-0.3);
  const top = level(height);
  for (let i = 0; i < 4; i++) strut(l, base[i], top[i], 0.12, 'metal', yellow);
  const bays = 4;
  for (let b = 0; b < bays; b++) {
    const v0 = (height * b) / bays;
    const v1 = (height * (b + 1)) / bays;
    const lo = level(v0);
    const hi = level(v1);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      strut(l, lo[i], hi[j], 0.05, 'metal', yellow);
      strut(l, lo[j], hi[i], 0.05, 'metal', yellow);
      strut(l, hi[i], hi[j], 0.06, 'metal', yellow);
    }
  }
  // The top platform, a rail, a solar panel on a mast.
  l.fan(
    'metal',
    top.map((p): V3 => [p[0], p[1] + 0.02, p[2]]),
    '#5a5d60',
    [0, 1, 0],
    (p) => [p[0], p[2]],
  );
  for (let i = 0; i < 4; i++) {
    const a = top[i];
    const b = top[(i + 1) % 4];
    strut(
      l,
      [a[0], a[1] + 1, a[2]],
      [b[0], b[1] + 1, b[2]],
      0.05,
      'metal',
      yellow,
    );
  }
  const mast = at(0, 0);
  strut(
    l,
    [mast[0], y + height, mast[1]],
    [mast[0], y + height + 1.8, mast[1]],
    0.07,
    'metal',
    '#6b6f72',
  );
  l.box(
    'solar',
    [-0.45, 0, -0.3],
    [0.45, 0.05, 0.3],
    '#ffffff',
    new Matrix4()
      .makeTranslation(mast[0], y + height + 1.7, mast[1])
      .multiply(new Matrix4().makeRotationY(yaw))
      .multiply(new Matrix4().makeRotationZ(0.5)),
  );
}

/** A concrete utility pole with a cross arm and three insulators. */
export function utilityPole(
  l: Local,
  x: number,
  y: number,
  z: number,
  yaw: number,
): void {
  const m = placeAt(x, y, z, yaw);
  l.box('paint', [-0.14, -0.5, -0.14], [0.14, 9, 0.14], '#a9a8a2', m);
  l.box('paint', [-1.1, 8.3, -0.06], [1.1, 8.45, 0.06], '#5f5f5c', m);
  for (const s of [-0.9, 0, 0.9])
    l.box(
      'paint',
      [s - 0.04, 8.45, -0.04],
      [s + 0.04, 8.65, 0.04],
      '#3d6b6a',
      m,
    );
}
