import { Matrix4 } from 'three';
import type { StaticCollider } from '../../../physics/types';
import {
  archOutline,
  rectOutline,
  type Local,
  type V2,
  type V3,
  type Wall,
} from '../../ajvatovci/hilltop/build/shapes';
import type { MatKey } from '../../ajvatovci/start-row/build/materials';
import { toWorld, type Site } from '../../ajvatovci/hilltop/site';

/**
 * Shared pieces of the Vodno landmarks (churches, platform, stations, towers): the Ajvatovci hilltop's geometry kit
 * (`ajvatovci/hilltop/build/shapes.ts` `Local`: a structure's own frame, walls with openings, tiled roof planes) plus the
 * few shapes those buildings add - walls round any outline, a half cone over an apse, an octagonal drum with a cone roof,
 * a gabled box. Far landmarks: the rough shape and the materials of the Ajvatovci church, fewer details.
 */
export { archOutline, rectOutline };
export type { Local, V2, V3, Wall };

/** Walls reach this far below the structure's ground (the pad is levelled, but a road beside it cuts into it). */
export const FOOT = -1.6;
/** Roof tiles sit this far over the wall tops. */
export const LIFT = 0.1;

export const STONE = '#ffffff';
export const PLINTH = '#d8cfc0';
export const TRIM = '#45484b';
export const GLASS = '#25292e';
export const DOOR = '#3d2a1e';
export const WOOD = '#6a3d22';
export const BRASS = '#c4a96a';

/** Points on an arc of a circle (local x, z): angles in radians, `n` segments (n + 1 points). */
export function arc(
  cx: number,
  cz: number,
  r: number,
  a0: number,
  a1: number,
  n: number,
): V2[] {
  const out: V2[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
  }
  return out;
}

/** Vertical walls round an outline (local x, z), from y0 to y1, facing outwards; closed unless `open`. */
export function ringWalls(
  l: Local,
  pts: V2[],
  y0: number,
  y1: number,
  key: MatKey,
  color: string,
  open = false,
): void {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[(i + 1) % pts.length];
    area += ax * bz - bx * az;
  }
  const ccw = area > 0;
  let u = 0;
  const n = open ? pts.length - 1 : pts.length;
  for (let i = 0; i < n; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[(i + 1) % pts.length];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-4) continue;
    const dx = (bx - ax) / len;
    const dz = (bz - az) / len;
    const want: V3 = ccw ? [dz, 0, -dx] : [-dz, 0, dx];
    const u0 = u;
    l.fan(
      key,
      [
        [ax, y0, az],
        [bx, y0, bz],
        [bx, y1, bz],
        [ax, y1, az],
      ],
      color,
      want,
      (p) => [u0 + Math.hypot(p[0] - ax, p[2] - az), p[1]],
    );
    u += len;
  }
}

/** A flat horizontal polygon (local x, z) at height y facing up (`down`: facing down). */
export function flatTop(
  l: Local,
  pts: V2[],
  y: number,
  key: MatKey,
  color: string,
  down = false,
): void {
  l.fan(
    key,
    pts.map(([x, z]): V3 => [x, y, z]),
    color,
    down ? [0, -1, 0] : [0, 1, 0],
    (p) => [p[0], p[2]],
  );
}

/**
 * A tiled cone / half cone over a circular wall: the eave ring at `yEave` (grown by `over` m), rising to `apex` over
 * the arc from a0 to a1.
 */
export function coneRoof(
  l: Local,
  cx: number,
  cz: number,
  r: number,
  a0: number,
  a1: number,
  n: number,
  yEave: number,
  apex: V3,
  over = 0.3,
): void {
  const ring = arc(cx, cz, r + over, a0, a1, n);
  const k = (apex[1] - yEave) / Math.max(0.01, r);
  const y = yEave - over * k + LIFT;
  for (let i = 0; i < n; i++)
    l.roof(
      [
        [ring[i][0], y, ring[i][1]],
        [ring[i + 1][0], y, ring[i + 1][1]],
        [apex[0], apex[1] + LIFT, apex[2]],
      ],
      { trim: [0] },
    );
}

/** An arched window (dark glass, pale surround) on wall `w`, centred at `s`, sill `y0`. */
export function slit(
  l: Local,
  w: Wall,
  s: number,
  y0: number,
  width: number,
  h: number,
): void {
  l.panel('paint', w, archOutline(s, y0, width, y0 + h), GLASS, { off: 0.015 });
  l.panel(
    'ashlar',
    w,
    archOutline(s, y0 - 0.1, width + 0.2, y0 + h + 0.1),
    PLINTH,
    {
      holes: [archOutline(s, y0, width, y0 + h)],
      off: 0.025,
    },
  );
}

/** A rectangular window / door. */
export function hole(
  l: Local,
  w: Wall,
  s0: number,
  y0: number,
  s1: number,
  y1: number,
  fill = GLASS,
): void {
  l.panel('paint', w, rectOutline(s0, y0, s1, y1), fill, { off: 0.015 });
  l.panel(
    'paint',
    w,
    rectOutline(s0 - 0.12, y0 - 0.08, s1 + 0.12, y1 + 0.12),
    TRIM,
    { holes: [rectOutline(s0, y0, s1, y1)], off: 0.02 },
  );
}

/** A gable triangle on wall `w`: base from s0 to s1 at y0, apex at (mid, y1). */
export function gable(
  l: Local,
  w: Wall,
  s0: number,
  s1: number,
  y0: number,
  y1: number,
  key: MatKey = 'render',
  color = STONE,
): void {
  l.panel(
    key,
    w,
    [
      [s0, y0],
      [s1, y0],
      [(s0 + s1) / 2, y1],
    ],
    color,
  );
}

/**
 * An octagonal drum on a square / round base: walls from y0 to y1 round (cx, cz) with circumradius `r`, arched slits on
 * the faces listed in `windows`, a cone of tiles to `apex` m.
 */
export function octagonDrum(
  l: Local,
  cx: number,
  cz: number,
  r: number,
  y0: number,
  y1: number,
  apex: number,
  wall: { key: MatKey; color: string },
  windows: number[] = [0, 2, 4, 6],
): void {
  const apothem = r * Math.cos(Math.PI / 8);
  const half = r * Math.sin(Math.PI / 8);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const n: V3 = [Math.cos(a), 0, Math.sin(a)];
    const face: Wall = {
      o: [cx + n[0] * apothem, 0, cz + n[2] * apothem],
      n,
    };
    l.panel(wall.key, face, rectOutline(-half, y0, half, y1), wall.color, {
      uOff: k * half * 2,
    });
    if (windows.includes(k))
      slit(l, face, 0, y0 + (y1 - y0) * 0.3, half * 0.5, (y1 - y0) * 0.5);
    l.panel(
      'paint',
      face,
      rectOutline(-half - 0.02, y1 - 0.14, half + 0.02, y1),
      TRIM,
      { off: 0.04 },
    );
  }
  for (let k = 0; k < 8; k++) {
    const a0 = (k / 8) * Math.PI * 2 + Math.PI / 8;
    const a1 = ((k + 1) / 8) * Math.PI * 2 + Math.PI / 8;
    const rr = r + 0.3;
    l.roof(
      [
        [cx + Math.cos(a0) * rr, y1 - 0.08, cz + Math.sin(a0) * rr],
        [cx + Math.cos(a1) * rr, y1 - 0.08, cz + Math.sin(a1) * rr],
        [cx, apex, cz],
      ],
      { trim: [0] },
    );
  }
}

/** A square drum (side `s`) with a pyramid roof, centred at (cx, cz): walls y0..y1, apex `apex`. */
export function squareDrum(
  l: Local,
  cx: number,
  cz: number,
  s: number,
  y0: number,
  y1: number,
  apex: number,
  wall: { key: MatKey; color: string },
): void {
  const h = s / 2;
  l.box(wall.key, [cx - h, y0, cz - h], [cx + h, y1, cz + h], wall.color);
  const faces: Wall[] = [
    { o: [cx, 0, cz + h], n: [0, 0, 1] },
    { o: [cx, 0, cz - h], n: [0, 0, -1] },
    { o: [cx + h, 0, cz], n: [1, 0, 0] },
    { o: [cx - h, 0, cz], n: [-1, 0, 0] },
  ];
  for (const f of faces)
    slit(l, f, 0, y0 + (y1 - y0) * 0.25, h * 0.45, (y1 - y0) * 0.55);
  const o = 0.25;
  const c: V2[] = [
    [cx - h - o, cz - h - o],
    [cx + h + o, cz - h - o],
    [cx + h + o, cz + h + o],
    [cx - h - o, cz + h + o],
  ];
  for (let i = 0; i < 4; i++) {
    const a = c[i];
    const b = c[(i + 1) % 4];
    l.roof(
      [
        [a[0], y1 + LIFT, a[1]],
        [b[0], y1 + LIFT, b[1]],
        [cx, apex + LIFT, cz],
      ],
      { trim: [0] },
    );
  }
}

/**
 * A gabled box: walls x0..x1 / z0..z1 from FOOT to `eave`, a tiled gable roof (ridge along x, or along z with
 * `ridgeAlongZ`) rising to `ridge`, gable ends in the wall material, an overhang of 0.35 m.
 */
export function gabledBox(
  l: Local,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  eave: number,
  ridge: number,
  wall: { key: MatKey; color: string },
  ridgeAlongZ = false,
  o: { roofColor?: string; trim?: boolean } = {},
): void {
  l.box(wall.key, [x0, FOOT, z0], [x1, eave, z1], wall.color);
  const ov = 0.35;
  if (!ridgeAlongZ) {
    const zm = (z0 + z1) / 2;
    const k = (ridge - eave) / ((z1 - z0) / 2);
    for (const side of [1, -1]) {
      const z = side > 0 ? z1 + ov : z0 - ov;
      const ye = eave - ov * k + LIFT;
      l.roof(
        [
          [x0 - ov, ye, z],
          [x1 + ov, ye, z],
          [x1 + ov, ridge + LIFT, zm],
          [x0 - ov, ridge + LIFT, zm],
        ],
        { color: o.roofColor, trim: o.trim === false ? [] : [0, 1, 3] },
      );
    }
    // On a wall facing +x the run s goes towards -z, on one facing -x towards +z.
    gable(
      l,
      { o: [x1, 0, 0], n: [1, 0, 0] },
      -z1,
      -z0,
      eave,
      ridge,
      wall.key,
      wall.color,
    );
    gable(
      l,
      { o: [x0, 0, 0], n: [-1, 0, 0] },
      z0,
      z1,
      eave,
      ridge,
      wall.key,
      wall.color,
    );
  } else {
    const xm = (x0 + x1) / 2;
    const k = (ridge - eave) / ((x1 - x0) / 2);
    for (const side of [1, -1]) {
      const x = side > 0 ? x1 + ov : x0 - ov;
      const ye = eave - ov * k + LIFT;
      l.roof(
        [
          [x, ye, z0 - ov],
          [x, ye, z1 + ov],
          [xm, ridge + LIFT, z1 + ov],
          [xm, ridge + LIFT, z0 - ov],
        ],
        { color: o.roofColor, trim: o.trim === false ? [] : [0, 1, 3] },
      );
    }
    gable(
      l,
      { o: [0, 0, z1], n: [0, 0, 1] },
      x0,
      x1,
      eave,
      ridge,
      wall.key,
      wall.color,
    );
    gable(
      l,
      { o: [0, 0, z0], n: [0, 0, -1] },
      -x1,
      -x0,
      eave,
      ridge,
      wall.key,
      wall.color,
    );
  }
}

/** A leaning strut between two points (a box `t` m thick; `key` 'paint' for timber, 'metal' for steel). */
export function strut(
  l: Local,
  a: V3,
  b: V3,
  t: number,
  color: string,
  key: MatKey = 'metal',
): void {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  const len = Math.hypot(dx, dy, dz);
  const ax = Math.atan2(Math.hypot(dx, dz), dy);
  const ay = Math.atan2(dx, dz);
  // A box along +Y, tipped onto the direction: rotate about X, then Y (the order power.ts uses).
  const m = new Matrix4()
    .makeRotationY(ay)
    .multiply(new Matrix4().makeRotationX(ax));
  m.setPosition((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  l.box(key, [-t / 2, -len / 2, -t / 2], [t / 2, len / 2, t / 2], color, m);
}

/** A box collider round a local rectangle of a site, from `y` up `h` m. */
export function boxCollider(
  site: Site,
  [x0, x1, z0, z1]: readonly [number, number, number, number],
  y: number,
  h: number,
): StaticCollider {
  const [x, z] = toWorld(site, (x0 + x1) / 2, (z0 + z1) / 2);
  const hx = (x1 - x0) / 2;
  const hz = (z1 - z0) / 2;
  // three.js yaw maps local +X to (cos t, -sin t): the site's axis runs along +yaw from +X towards +Z.
  return {
    kind: 'box',
    x,
    z,
    y,
    h,
    hx,
    hz,
    rot: -site.yaw,
    r: Math.hypot(hx, hz),
  };
}

export function cylinderCollider(
  site: Site,
  lx: number,
  lz: number,
  y: number,
  r: number,
  h: number,
): StaticCollider {
  const [x, z] = toWorld(site, lx, lz);
  return { kind: 'cylinder', x, z, y, r, h };
}

/** A matrix placing a local piece at (x, y, z) turned by `yaw` about Y. */
export const placeAt = (x: number, y: number, z: number, yaw = 0): Matrix4 =>
  new Matrix4()
    .makeTranslation(x, y, z)
    .multiply(new Matrix4().makeRotationY(yaw));

/** A box collider of half sizes (hx along the piece, hz across) centred on local (lx, lz), turned `angle` from the site's x axis. */
export function turnedBoxCollider(
  site: Site,
  lx: number,
  lz: number,
  angle: number,
  hx: number,
  hz: number,
  y: number,
  h: number,
): StaticCollider {
  const [x, z] = toWorld(site, lx, lz);
  return {
    kind: 'box',
    x,
    z,
    y,
    h,
    hx,
    hz,
    rot: -(site.yaw + angle),
    r: Math.hypot(hx, hz),
  };
}
