import { BufferAttribute, BufferGeometry, Vector3 } from 'three';
import { paint } from '../../engine/geo';
import { GLOVE, HAT, LEATHER, REFLECT, RIB, tag } from './people-parts';

/**
 * What a rally crew wears and holds in the car besides the suit (crew.ts): gloves closed round the steering wheel or
 * the pace notes, the harness, the head restraint on the shoulders, the notes. Everything is built where it ends up
 * (the posed frame of the figure), painted and tagged with its cell of the people atlas.
 */

const v = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);

/** A painted part from points and triangles (smooth normals). */
function solid(
  pos: number[],
  idx: number[],
  color: string,
  cell: number,
): BufferGeometry {
  // Faces outward whichever way the rings ran: the volume they enclose has to be positive.
  const c = [0, 0, 0];
  for (let i = 0; i < pos.length; i++) c[i % 3] += pos[i] / (pos.length / 3);
  let vol = 0;
  for (let k = 0; k < idx.length; k += 3) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = [0, 1, 2].flatMap((j) =>
      [0, 1, 2].map((q) => pos[idx[k + j] * 3 + q] - c[q]),
    );
    vol +=
      ax * (by * cz - bz * cy) +
      ay * (bz * cx - bx * cz) +
      az * (bx * cy - by * cx);
  }
  if (vol < 0)
    for (let k = 0; k < idx.length; k += 3)
      [idx[k + 1], idx[k + 2]] = [idx[k + 2], idx[k + 1]];
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return tag(paint(g, color), cell);
}

/** Some vector square to `d`. */
function square(d: Vector3, hint: Vector3): Vector3 {
  const u = hint.clone().addScaledVector(d, -hint.dot(d));
  if (u.lengthSq() < 1e-8) u.set(1, 0, 0).addScaledVector(d, -d.x);
  return u.normalize();
}

/**
 * A round tube through `pts` with a radius at each (ends closed by a small dome), `hint` fixing where the first side
 * is so two tubes side by side match.
 */
export function tubeAlong(
  pts: Vector3[],
  radii: number[],
  sides: number,
  color: string,
  cell: number,
  hint = v(0, 1, 0),
  flat = 1,
  ends: [boolean, boolean] = [true, true],
): BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const n = pts.length;
  let u = v(0, 0, 0);
  const rings: number[] = [];
  const ring = (c: Vector3, d: Vector3, r: number): void => {
    u = square(d, rings.length ? u : hint);
    const w = d.clone().cross(u).normalize();
    rings.push(pos.length / 3);
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2;
      const p = c
        .clone()
        .addScaledVector(u, Math.cos(a) * r)
        .addScaledVector(w, Math.sin(a) * r * flat);
      pos.push(p.x, p.y, p.z);
    }
  };
  const dirAt = (i: number): Vector3 =>
    pts[Math.min(n - 1, i + 1)]
      .clone()
      .sub(pts[Math.max(0, i - 1)])
      .normalize();
  // A dome at a closed end: a ring pulled in and pushed out.
  if (ends[0])
    ring(
      pts[0].clone().addScaledVector(dirAt(0), -radii[0] * 0.6),
      dirAt(0),
      radii[0] * 0.55,
    );
  for (let i = 0; i < n; i++) ring(pts[i], dirAt(i), radii[i]);
  if (ends[1])
    ring(
      pts[n - 1].clone().addScaledVector(dirAt(n - 1), radii[n - 1] * 0.6),
      dirAt(n - 1),
      radii[n - 1] * 0.55,
    );
  for (let j = 0; j < rings.length - 1; j++)
    for (let k = 0; k < sides; k++) {
      const a = rings[j] + k;
      const b = rings[j] + ((k + 1) % sides);
      const c = rings[j + 1] + k;
      const d = rings[j + 1] + ((k + 1) % sides);
      idx.push(a, b, c, b, d, c);
    }
  const cap = (r: number, at: Vector3, rev: boolean): void => {
    const c = pos.length / 3;
    pos.push(at.x, at.y, at.z);
    for (let k = 0; k < sides; k++) {
      const a = r + k;
      const b = r + ((k + 1) % sides);
      if (rev) idx.push(c, b, a);
      else idx.push(c, a, b);
    }
  };
  if (ends[0])
    cap(
      rings[0],
      pts[0].clone().addScaledVector(dirAt(0), -radii[0] * 0.85),
      true,
    );
  if (ends[1])
    cap(
      rings[rings.length - 1],
      pts[n - 1].clone().addScaledVector(dirAt(n - 1), radii[n - 1] * 0.85),
      false,
    );
  return solid(pos, idx, color, cell);
}

/** A flat strap through `pts`, lying on a surface whose normals are `nor`: `width` wide, `thick` proud of it. */
export function strap(
  pts: Vector3[],
  nor: Vector3[],
  width: number,
  thick: number,
  color: string,
  cell = RIB,
): BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const d = pts[Math.min(n - 1, i + 1)]
      .clone()
      .sub(pts[Math.max(0, i - 1)])
      .normalize();
    const side = d.clone().cross(nor[i]).normalize();
    const up = side.clone().cross(d).normalize();
    for (const [s, h] of [
      [-1, 0],
      [-1, 1],
      [1, 1],
      [1, 0],
    ]) {
      const p = pts[i]
        .clone()
        .addScaledVector(side, (s * width) / 2)
        .addScaledVector(up, h * thick);
      pos.push(p.x, p.y, p.z);
    }
  }
  for (let i = 0; i < n - 1; i++)
    for (let k = 0; k < 3; k++) {
      const a = i * 4 + k;
      const b = a + 1;
      const c = a + 4;
      const d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  // Hard edges: every face has its own vertices.
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  const flatG = g.toNonIndexed();
  flatG.computeVertexNormals();
  g.dispose();
  return tag(paint(flatG, color), cell);
}

/** A box given by its centre and three half axes. */
export function slab(
  at: Vector3,
  a: Vector3,
  b: Vector3,
  c: Vector3,
  color: string,
  cell = HAT,
): BufferGeometry {
  const pos: number[] = [];
  for (const sa of [-1, 1])
    for (const sb of [-1, 1])
      for (const sc of [-1, 1]) {
        const p = at
          .clone()
          .addScaledVector(a, sa)
          .addScaledVector(b, sb)
          .addScaledVector(c, sc);
        pos.push(p.x, p.y, p.z);
      }
  // Corner i = sa * 4 + sb * 2 + sc (0 / 1 each).
  const quads = [
    [0, 1, 3, 2],
    [4, 6, 7, 5],
    [0, 4, 5, 1],
    [2, 3, 7, 6],
    [0, 2, 6, 4],
    [1, 5, 7, 3],
  ];
  const idx: number[] = [];
  for (const [p, q, r, s] of quads) idx.push(p, q, r, p, r, s);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  const flatG = g.toNonIndexed();
  flatG.computeVertexNormals();
  g.dispose();
  // Outward whatever the handedness of the axes.
  const p = flatG.getAttribute('position');
  const nn = flatG.getAttribute('normal');
  const out = v(p.getX(0), p.getY(0), p.getZ(0)).sub(at);
  if (out.dot(v(nn.getX(0), nn.getY(0), nn.getZ(0))) < 0) {
    for (let i = 0; i < p.count; i += 3) {
      const x = [p.getX(i + 1), p.getY(i + 1), p.getZ(i + 1)];
      p.setXYZ(i + 1, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2));
      p.setXYZ(i + 2, x[0], x[1], x[2]);
    }
    flatG.computeVertexNormals();
  }
  return tag(paint(flatG, color), cell);
}

/** A hand closed round a bar: the rim of a steering wheel, the edge of a book. */
export interface Grip {
  /** Centre of the bar inside the fist. */
  at: Vector3;
  /** Along the bar, towards the thumb. */
  bar: Vector3;
  /** From the bar to the back of the hand (away from what is held), and to the side the fingers reach over. */
  outer: Vector3;
  far: Vector3;
  /** Radius of the bar. */
  r: number;
}

const KNUCKLE = -0.45;

/** Round the bar: 0 = the back of the hand, a quarter turn = the far side. */
function roundBar(g: Grip, angle: number, radius: number, along = 0): Vector3 {
  return g.at
    .clone()
    .addScaledVector(g.outer, Math.cos(angle) * radius)
    .addScaledVector(g.far, Math.sin(angle) * radius)
    .addScaledVector(g.bar, along);
}

/** Where the knuckles of a hand in this grip are: the point the arm has to bring the hand to. */
export function knuckles(g: Grip): Vector3 {
  return roundBar(g, KNUCKLE, g.r + 0.02);
}

/**
 * A racing glove on a hand in a grip: the back of the hand from the wrist to the knuckles, four fingers wrapped over
 * the bar, the thumb along its near side (`fore` = from the elbow to the wrist).
 */
export function gripGlove(
  g: Grip,
  wrist: Vector3,
  fore: Vector3,
  color: string,
  hi: boolean,
): BufferGeometry[] {
  const out: BufferGeometry[] = [];
  const kc = knuckles(g);
  const axis = kc.clone().sub(wrist).normalize();
  const u = square(axis, g.bar);
  let q = axis.clone().cross(u).normalize();
  if (q.dot(g.outer) < 0) q = q.negate();
  const sides = hi ? 8 : 5;

  // Back of the hand: a flattened tube widening from the wrist to the knuckles.
  {
    const st: [number, number, number][] = [
      [0, 0.034, 0.026],
      [0.35, 0.039, 0.021],
      [0.75, 0.044, 0.016],
      [1, 0.043, 0.014],
    ];
    const n = hi ? 12 : 8;
    const pos: number[] = [];
    const idx: number[] = [];
    st.forEach(([t, w, h]) => {
      const c = wrist
        .clone()
        .lerp(kc, t)
        .addScaledVector(q, -0.004 * t);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const cx = Math.cos(a);
        const sy = Math.sin(a);
        const p = c
          .clone()
          .addScaledVector(u, Math.sign(cx) * Math.pow(Math.abs(cx), 0.7) * w)
          .addScaledVector(q, Math.sign(sy) * Math.pow(Math.abs(sy), 0.7) * h);
        pos.push(p.x, p.y, p.z);
      }
    });
    for (let j = 0; j < st.length - 1; j++)
      for (let k = 0; k < n; k++) {
        const a = j * n + k;
        const b = j * n + ((k + 1) % n);
        idx.push(a, b, a + n, b, b + n, a + n);
      }
    const end = kc.clone().addScaledVector(axis, 0.008);
    const c = pos.length / 3;
    pos.push(end.x, end.y, end.z);
    const last = (st.length - 1) * n;
    for (let k = 0; k < n; k++) idx.push(c, last + k, last + ((k + 1) % n));
    out.push(solid(pos, idx, color, GLOVE));
  }

  // Fingers: from the knuckle over the bar and back under it.
  const offs = [0.031, 0.0105, -0.0105, -0.03];
  offs.forEach((o, f) => {
    const little = f === 3;
    const reach = little ? 3.25 : 3.6;
    const angles = [KNUCKLE, 0.55, 1.6, 2.6, reach];
    const rad = little ? 0.0085 : 0.0098;
    const pts = angles.map((a, i) =>
      roundBar(g, a, g.r + (i === 0 ? 0.019 : rad + 0.0015), o),
    );
    out.push(
      tubeAlong(
        pts,
        [rad + 0.0015, rad + 0.0008, rad, rad - 0.0005, rad - 0.0018],
        sides,
        color,
        GLOVE,
        g.bar,
      ),
    );
  });

  // Thumb: from the heel of the hand along the near side of the bar.
  {
    const root = wrist
      .clone()
      .lerp(kc, 0.32)
      .addScaledVector(u, 0.034)
      .addScaledVector(q, -0.012);
    const mid = roundBar(g, -1.25, g.r + 0.017, 0.04);
    const tip = roundBar(g, -2.1, g.r + 0.011, 0.05);
    const ball = root.clone().lerp(mid, 0.5).addScaledVector(u, 0.008);
    out.push(
      tubeAlong(
        [root, ball, mid, tip],
        [0.017, 0.0135, 0.0115, 0.0095],
        sides,
        color,
        GLOVE,
        g.bar,
      ),
    );
  }

  // The wrist of the glove, into the gauntlet (crew.ts makes that out of the end of the sleeve, so it fits the arm).
  out.push(
    tubeAlong(
      [
        wrist.clone().addScaledVector(axis, 0.024),
        wrist.clone(),
        wrist.clone().addScaledVector(fore, -0.03),
      ],
      [0.031, 0.037, 0.036],
      hi ? 10 : 6,
      color,
      GLOVE,
      u,
    ),
  );
  return out;
}

/** The harness buckle: a round cam lock, `nor` out of the belly. */
export function camLock(
  at: Vector3,
  nor: Vector3,
  up: Vector3,
): BufferGeometry[] {
  const s = square(nor, up);
  const t = nor.clone().cross(s).normalize();
  const ring = (r: number, h: number): Vector3[] =>
    Array.from({ length: 12 }, (_, i) => {
      const a = (i / 12) * Math.PI * 2;
      return at
        .clone()
        .addScaledVector(s, Math.cos(a) * r)
        .addScaledVector(t, Math.sin(a) * r)
        .addScaledVector(nor, h);
    });
  const pos: number[] = [];
  const idx: number[] = [];
  const rings = [ring(0.034, 0), ring(0.034, 0.012), ring(0.026, 0.017)];
  for (const r of rings) for (const p of r) pos.push(p.x, p.y, p.z);
  for (let j = 0; j < 2; j++)
    for (let k = 0; k < 12; k++) {
      const a = j * 12 + k;
      const b = j * 12 + ((k + 1) % 12);
      idx.push(a, b, a + 12, b, b + 12, a + 12);
    }
  const c = pos.length / 3;
  const top = at.clone().addScaledVector(nor, 0.017);
  pos.push(top.x, top.y, top.z);
  for (let k = 0; k < 12; k++) idx.push(c, 24 + k, 24 + ((k + 1) % 12));
  return [
    solid(pos, idx, '#b4b7bd', REFLECT),
    slab(
      at.clone().addScaledVector(nor, 0.019),
      s.clone().multiplyScalar(0.016),
      t.clone().multiplyScalar(0.005),
      nor.clone().multiplyScalar(0.003),
      '#2a2b2f',
      LEATHER,
    ),
  ];
}

/**
 * The pace notes: a wire-bound A5 book open on one page. `at` its centre, `up` along the page away from the reader,
 * `nor` out of the page.
 */
export function notes(
  at: Vector3,
  up: Vector3,
  nor: Vector3,
): BufferGeometry[] {
  const side = up.clone().cross(nor).normalize();
  const w = 0.074;
  const h = 0.105;
  const out = [
    // Cover and the pages on it.
    slab(
      at.clone().addScaledVector(nor, -0.004),
      side.clone().multiplyScalar(w),
      up.clone().multiplyScalar(h),
      nor.clone().multiplyScalar(0.004),
      '#23262b',
      HAT,
    ),
    slab(
      at.clone().addScaledVector(nor, 0.003),
      side.clone().multiplyScalar(w - 0.003),
      up.clone().multiplyScalar(h - 0.003),
      nor.clone().multiplyScalar(0.003),
      '#f1efe6',
      HAT,
    ),
  ];
  // A page of notes: a few lines of calls with a rule under each, some marked with a highlighter; wire binding down
  // the left edge.
  const mark = (
    row: number,
    x0: number,
    x1: number,
    tall: number,
    lift: number,
    color: string,
  ): void => {
    out.push(
      slab(
        at
          .clone()
          .addScaledVector(nor, 0.006 + lift)
          .addScaledVector(up, h * (0.7 - row * 0.34))
          .addScaledVector(side, w * (x0 + x1) * 0.5),
        side.clone().multiplyScalar((w * (x1 - x0)) / 2),
        up.clone().multiplyScalar(tall),
        nor.clone().multiplyScalar(0.0003),
        color,
        HAT,
      ),
    );
  };
  const INK = '#3a4252';
  const calls: [number, number][][] = [
    [
      [-0.72, -0.5],
      [-0.3, 0.1],
      [0.25, 0.42],
      [0.58, 0.8],
    ],
    [
      [-0.72, -0.55],
      [-0.4, -0.2],
      [-0.05, 0.25],
      [0.4, 0.78],
    ],
    [
      [-0.7, -0.1],
      [0.05, 0.3],
    ],
    [
      [-0.72, -0.15],
      [0.1, 0.25],
      [0.42, 0.8],
    ],
    [
      [-0.7, -0.5],
      [-0.3, 0.2],
      [0.35, 0.6],
    ],
  ];
  const lit: Record<string, string> = {
    '1:3': '#f2e23a',
    '2:0': '#5db4e6',
    '3:0': '#f2e23a',
    '3:2': '#f2e23a',
  };
  calls.forEach((row, r) => {
    row.forEach(([x0, x1], k) => {
      const hl = lit[`${r}:${k}`];
      if (hl) mark(r, x0 - 0.04, x1 + 0.04, 0.0085, 0, hl);
      mark(r, x0, x1, 0.0042, 0.0004, INK);
    });
    mark(r + 0.22, row[0][0], row[row.length - 1][1], 0.0008, 0, INK);
  });
  out.push(
    tubeAlong(
      [
        at
          .clone()
          .addScaledVector(side, -w)
          .addScaledVector(up, -h + 0.006),
        at
          .clone()
          .addScaledVector(side, -w)
          .addScaledVector(up, h - 0.006),
      ],
      [0.006, 0.006],
      6,
      '#2a2b2f',
      HAT,
      nor,
    ),
  );
  return out;
}
