import { Matrix4, Vector2, Vector3 } from 'three';
import { DEALER } from '../../layout';
import type { Corner } from '../../frame';
import type { MatKey } from '../materials';
import { roofUnit, splitUnit } from '../props';
import { Shell, Wall, type WallFrame } from '../wall';
import { COLOR, dockDoors, hippedRoof, ribbon, type LotCtx } from './common';
import { canopy, prism } from './north-offices';

/**
 * The east end of the row (user's Street View screenshots `ref-30..49` in `sources/maps/ajvatovci/`): the
 * villa on the corner with the east road (north 10), the slab lot west of it, and the south side east of
 * south 6 - the car dealer, the truck yard, and off the street the old compound, the statue yard and the
 * wholesale mall. Every sign, flag and lettering is plain (the real ones carry business names).
 */

type V3 = [number, number, number];

/** A free-standing frame along a line (u from `a` towards `b`, w to its left seen from above), for props. */
export function lineFrame(a: Vector2, b: Vector2): WallFrame {
  const dir = b.clone().sub(a).normalize();
  const normal = new Vector2(-dir.y, dir.x);
  const length = a.distanceTo(b);
  const matrix = new Matrix4().makeBasis(
    new Vector3(dir.x, 0, dir.y),
    new Vector3(0, 1, 0),
    new Vector3(normal.x, 0, normal.y),
  );
  matrix.setPosition(a.x, 0, a.y);
  return {
    a,
    b,
    dir,
    normal,
    length,
    side: 'n',
    matrix,
    span: (d0, d1) => [d0, d1],
    far: (d0, d1) => [length - d1, length - d0],
    point: (u, w = 0) =>
      new Vector2(
        a.x + dir.x * u + normal.x * w,
        a.y + dir.y * u + normal.y * w,
      ),
  };
}

/** A prop frame at site point `at`, u running along `heading` (radians, 0 = east, as vehicles). */
export function propFrame(ctx: LotCtx, at: Corner, heading: number): Wall {
  const a = new Vector2(at[0], at[1]);
  const b = a.clone().add(new Vector2(Math.cos(heading), -Math.sin(heading)));
  return new Wall(ctx.f, lineFrame(a, b), 0, { mat: 'paint', tint: '#ffffff' });
}

/** A thin square bar between two points in a wall's coordinates (struts, diagonals, lattice, arches). */
export function bar(
  w: Wall,
  p0: V3,
  p1: V3,
  t: number,
  color: string,
  key: MatKey = 'paint',
): void {
  const a = new Vector3(...p0);
  const b = new Vector3(...p1);
  const d = b.clone().sub(a).normalize();
  const ref = Math.abs(d.y) > 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
  const s = d
    .clone()
    .cross(ref)
    .normalize()
    .multiplyScalar(t / 2);
  const u = s
    .clone()
    .cross(d)
    .normalize()
    .multiplyScalar(t / 2);
  const corners = [
    s.clone().add(u),
    s.clone().negate().add(u),
    s.clone().negate().sub(u),
    s.clone().sub(u),
  ];
  for (let i = 0; i < 4; i++) {
    const c0 = corners[i];
    const c1 = corners[(i + 1) % 4];
    const v = (o: Vector3, e: Vector3): V3 => {
      const p = o.clone().add(e);
      return [p.x, p.y, p.z];
    };
    // Outward winding: the face between c0 and c1 runs a -> b along the bar.
    w.quad(
      key,
      [v(a, c1), v(a, c0), v(b, c0), v(b, c1)],
      color,
      undefined,
      true,
    );
  }
}

/** A gabled roof over a shell: the ridge along the front wall (`side`), gable triangles on the two ends. */
export function gableRoof(
  shell: Shell,
  front: 's' | 'n' | 'e' | 'w',
  h: number,
  rise: number,
  color: string,
  over = 0.45,
): void {
  const opposite = { s: 'n', n: 's', e: 'w', w: 'e' } as const;
  for (const side of [front, opposite[front]]) {
    const w = shell.side(side)!;
    const L = w.length;
    const D = shell.side(side === 's' || side === 'n' ? 'e' : 's')!.length;
    const half = D / 2;
    const drop = (rise / half) * over;
    w.quad(
      'sheet',
      [
        [-over, h - drop, over],
        [L + over, h - drop, over],
        [L + over, h + rise, -half],
        [-over, h + rise, -half],
      ],
      color,
      [
        [0, 0],
        [L + 2 * over, 0],
        [L + 2 * over, Math.hypot(half + over, rise + drop)],
        [0, Math.hypot(half + over, rise + drop)],
      ],
    );
    // Its underside at the eaves, and a fascia board.
    w.paint(
      [-over, L + over],
      [h - drop - 0.18, h - drop],
      [0, over + 0.03],
      '#e9eae8',
    );
  }
  for (const side of [
    front === 's' || front === 'n' ? 'e' : 's',
    front === 's' || front === 'n' ? 'w' : 'n',
  ] as const) {
    const w = shell.side(side)!;
    const L = w.length;
    w.quad(
      w.look.mat,
      [
        [0, h, 0],
        [L, h, 0],
        [L / 2, h + rise, 0],
        [L / 2, h + rise, 0],
      ],
      w.look.tint,
      [
        [0, h],
        [L, h],
        [L / 2, h + rise],
        [L / 2, h + rise],
      ],
    );
    // Verge trim up both rakes.
    bar(
      w,
      [-0.1, h - 0.1, 0.08],
      [L / 2, h + rise + 0.05, 0.08],
      0.16,
      '#d9dbda',
    );
    bar(
      w,
      [L / 2, h + rise + 0.05, 0.08],
      [L + 0.1, h - 0.1, 0.08],
      0.16,
      '#d9dbda',
    );
  }
}

/** A steel railing: top rail, bottom rail and balusters. */
function rail(
  w: Wall,
  [u0, u1]: [number, number],
  y: number,
  out: number,
  color = '#9ea3a6',
): void {
  const H = 1.0;
  w.paint([u0, u1], [y + H - 0.05, y + H], [out - 0.03, out + 0.03], color);
  w.paint([u0, u1], [y + 0.1, y + 0.13], [out - 0.02, out + 0.02], color);
  for (let u = u0; u <= u1 + 1e-6; u += 0.14)
    w.paint(
      [u - 0.012, u + 0.012],
      [y, y + H],
      [out - 0.012, out + 0.012],
      color,
    );
}

// ----- north 10: the house on the corner -----

const VILLA_WALL = '#cfd1cf';
const VILLA_FRAME = '#f2f3f1';
const POSTER_RED = '#c8322d';

/** Red promo posters stuck on a shop window (plain red and white panels, no lettering). */
function posters(
  w: Wall,
  [u0, u1]: [number, number],
  [y0, y1]: [number, number],
  at: number,
): void {
  const n = Math.max(1, Math.round((u1 - u0) / 0.9));
  const pw = (u1 - u0) / n;
  for (let k = 0; k < n; k++) {
    const a = u0 + k * pw + 0.06;
    const b = a + pw - 0.12;
    w.panel('paint', [a, b], [y0 + 0.2, y1 - 0.25], at, POSTER_RED);
    w.panel(
      'paint',
      [a + 0.12, b - 0.12],
      [y1 - 0.9, y1 - 0.45],
      at + 0.005,
      '#f1eee8',
    );
    w.panel(
      'paint',
      [a + 0.2, b - 0.2],
      [y0 + 0.5, y0 + 0.75],
      at + 0.005,
      '#f1eee8',
    );
  }
}

export function dressVilla(ctx: LotCtx): void {
  const { shell, h } = ctx;
  const RISE = 3.2;
  for (const w of shell.walls) {
    const L = w.length;
    w.plinth('#9b9a95', 0.3);
    if (w.w.side === 'e' || w.w.side === 'w') {
      // Gable ends: two small windows high up, a wall lamp; the east one has the AC units.
      for (const c of [L * 0.36, L * 0.64])
        w.window([c - 0.4, c + 0.4], [h + 0.6, h + 1.6], {
          frame: VILLA_FRAME,
          panes: 1,
          sill: false,
        });
      w.paint(
        [L / 2 - 0.1, L / 2 + 0.1],
        [h - 1.5, h - 1.2],
        [0, 0.18],
        '#5d6164',
      );
      if (w.w.side === 'e') {
        w.window([L * 0.3, L * 0.3 + 1.2], [3.9, 5.3], {
          frame: VILLA_FRAME,
          panes: 2,
        });
        splitUnit(w, L * 0.3 + 1.5, 4.2);
        w.window([L * 0.6, L * 0.6 + 1.2], [0.9, 2.3], {
          frame: VILLA_FRAME,
          panes: 2,
        });
      } else {
        w.window([L * 0.3, L * 0.3 + 0.9], [3.9, 5.1], {
          frame: VILLA_FRAME,
          panes: 1,
        });
      }
    }
  }
  gableRoof(shell, ctx.front as 's', h, RISE, ctx.plot.roof);

  // The street front: plain on the west part, the balcony block by the east corner.
  const w = shell.side(ctx.front)!;
  const L = w.length;
  for (const c of [2.6, 6.2])
    for (const y of [
      [0.9, 2.3],
      [3.9, 5.3],
    ] as [number, number][])
      w.window([c - 0.6, c + 0.6], y, { frame: VILLA_FRAME, panes: 2 });
  const b0 = L - 8.6;
  const b1 = L - 0.6;
  const OUT = 1.3;
  // The block stands out of the front up to the eaves; its ground floor is the shop window (posters).
  prism(
    w,
    'render',
    [
      [b0, 0],
      [b0, OUT],
      [b1, OUT],
      [b1, 0],
    ],
    [0, h],
    VILLA_WALL,
    false,
  );
  w.applied([b0 + 0.4, b1 - 0.4], [0.2, 2.8], OUT + 0.01, {
    frame: VILLA_FRAME,
    across: 1.1,
  });
  posters(w, [b0 + 0.45, b1 - 0.45], [0.2, 2.8], OUT + 0.03);
  w.paint([b0 - 0.2, b1 + 0.2], [0, 0.14], [0, OUT + 0.6], COLOR.steps);
  // First floor: windows, a balcony slab right across with a steel railing, AC units.
  for (const c of [b0 + 1.6, b0 + 4.2])
    w.applied([c - 0.65, c + 0.65], [3.7, 5.3], OUT + 0.01, {
      frame: VILLA_FRAME,
      across: 0.65,
    });
  w.applied([b1 - 2, b1 - 1.1], [3.4, 5.6], OUT + 0.01, { frame: VILLA_FRAME });
  w.box(
    'render',
    [b0 - 0.1, b1 + 0.1],
    [3.05, 3.3],
    [OUT, OUT + 1.2],
    VILLA_WALL,
  );
  rail(w, [b0 + 0.2, b1 - 0.2], 3.3, OUT + 1.15);
  splitUnit(w, b0 + 5.4, 4.4);
  // The attic room above it with its own balcony, under a deep flat roof on brackets.
  const A: [number, number] = [b0 + 0.5, b1 - 0.5];
  w.box('render', A, [h, h + 2.6], [-3.4, 0.4], VILLA_WALL);
  for (const c of [A[0] + 1.6, A[0] + 4.1])
    w.applied([c - 0.6, c + 0.6], [h + 0.3, h + 2.1], 0.41, {
      frame: VILLA_FRAME,
      across: 0.6,
    });
  w.box(
    'render',
    [b0 - 0.1, b1 + 0.1],
    [h - 0.05, h + 0.2],
    [0, OUT + 0.5],
    VILLA_WALL,
  );
  rail(w, [b0 + 0.2, b1 - 0.2], h + 0.2, OUT + 0.45);
  w.box(
    'render',
    [b0 - 0.4, b1 + 0.4],
    [h + 2.6, h + 2.9],
    [-3.6, OUT + 0.7],
    '#c3c5c3',
  );
  for (const u of [b0 + 0.2, b1 - 0.4])
    bar(w, [u, h + 2.6, 0.45], [u, h + 1.9, 0.42], 0.18, '#c3c5c3');
  splitUnit(w, A[1] - 1.2, h + 0.6);
  // A brick chimney by the east gable.
  w.box(
    'paint',
    [L - 2.4, L - 1.7],
    [h + 1.4, h + 4.2],
    [-6.3, -5.6],
    '#a65640',
  );
  w.box(
    'paint',
    [L - 2.5, L - 1.6],
    [h + 4.2, h + 4.35],
    [-6.4, -5.5],
    '#8d8a83',
  );
  shell.finish();

  // The wing behind: single storey, a low roof falling to the street side, a carport at its east end.
  const a = ctx.plot.annex!;
  const wing = new Shell(
    ctx.f,
    a.corners,
    a.height,
    { mat: 'render', tint: VILLA_WALL },
    { mat: 'sheet', tint: ctx.plot.roof },
  );
  for (const ww of wing.walls) {
    const WL = ww.length;
    ww.plinth('#9b9a95', 0.3);
    ww.coping('#d9dbda', 0.5, 0.35);
    if (ww.w.side === 'n')
      ribbon(
        ww,
        [2, WL - 2],
        { width: 1.4, pitch: 3.6, y: [1.6, 2.5] },
        { frame: VILLA_FRAME },
      );
    if (ww.w.side === 'e') {
      ww.doorway([WL * 0.3, WL * 0.3 + 1], 2.2, {
        leaf: 'panel',
        color: '#e9eae8',
        frame: '#bfc2c1',
      });
      // The carport: a flat roof out from the wing's east wall on two posts.
      canopy(ww, [0.3, WL - 0.3], a.height - 0.3, 4.4, 0, '#dfe1e0', '#8b9093');
    }
  }
  wing.finish();
}

// ----- the slab lot -----

export function dressSlab(ctx: LotCtx): void {
  const [c0, c1, c2] = ctx.plot.corners.map(([x, z]) => new Vector2(x, z));
  const w = new Wall(ctx.f, lineFrame(c0, c1), 0, {
    mat: 'concrete',
    tint: '#cfccc4',
  });
  const L = c0.distanceTo(c1);
  const D = c1.distanceTo(c2);
  // The slab's sign of depth: build towards the third corner.
  const inward = c2.clone().sub(c1).dot(w.w.normal) > 0 ? 1 : -1;
  const ws: [number, number] = inward > 0 ? [0, D] : [-D, 0];
  w.box('concrete', [0, L], [-0.4, ctx.plot.height], ws, '#cfccc4');
  // Anchor bolts in rows along the edges, and a few rebar stubs.
  for (let u = 0.6; u < L - 0.3; u += 3)
    for (const d of [0.5, D - 0.5]) {
      const wv = inward * d;
      w.box(
        'metal',
        [u - 0.04, u + 0.04],
        [ctx.plot.height, ctx.plot.height + 0.18],
        [wv - 0.04, wv + 0.04],
        '#5b5148',
      );
    }
}

// ----- south 7: the car dealer -----

const DARK_STEEL = '#2f3437';
const TRUSS_GREEN = '#7fd23a';

/** A dark carport: flat roof on Y-shaped posts, `length` along the street, `depth` deep, centred on its frame. */
function carport(w: Wall, length: number, depth: number): void {
  const H = 2.75;
  const hl = length / 2;
  const hd = depth / 2;
  w.box('paint', [-hl, hl], [H, H + 0.22], [-hd, hd], DARK_STEEL);
  w.paint([-hl, hl], [H + 0.22, H + 0.3], [-hd - 0.05, hd + 0.05], '#3c4246');
  for (let u = -hl + 0.5; u <= hl - 0.4; u += 1.2)
    w.paint([u - 0.04, u + 0.04], [H - 0.18, H], [-hd, hd], '#262a2c');
  for (const u of [-hl + 1.5, 0, hl - 1.5]) {
    w.box(
      'metal',
      [u - 0.09, u + 0.09],
      [0, H - 0.9],
      [-0.09, 0.09],
      DARK_STEEL,
    );
    bar(w, [u, H - 0.95, 0], [u, H - 0.1, hd - 0.5], 0.14, DARK_STEEL, 'metal');
    bar(
      w,
      [u, H - 0.95, 0],
      [u, H - 0.1, -hd + 0.5],
      0.14,
      DARK_STEEL,
      'metal',
    );
    bar(w, [u, H - 0.95, 0], [u - 1.2, H - 0.1, 0], 0.1, DARK_STEEL, 'metal');
    bar(w, [u, H - 0.95, 0], [u + 1.2, H - 0.1, 0], 0.1, DARK_STEEL, 'metal');
  }
}

/** The bright green space-truss roof frame on grey columns over a new slab, with a scaffold and steel lying about. */
function trussFrame(w: Wall, length: number, depth: number): void {
  const hl = length / 2;
  const hd = depth / 2;
  const Y0 = 5.6;
  const Y1 = 6.6;
  w.box(
    'concrete',
    [-hl - 0.5, hl + 0.5],
    [-0.2, 0.2],
    [-hd - 0.5, hd + 0.5],
    '#d2cfc6',
  );
  for (const u of [-hl, 0, hl])
    for (const d of [-hd, hd])
      w.box(
        'metal',
        [u - 0.14, u + 0.14],
        [0.2, Y0],
        [d - 0.14, d + 0.14],
        '#6d7276',
      );
  const step = 2.5;
  const nu = Math.round(length / step);
  const nd = Math.round(depth / step);
  const t = 0.09;
  for (let i = 0; i <= nd; i++) {
    const d = -hd + (depth * i) / nd;
    bar(w, [-hl, Y0, d], [hl, Y0, d], t, TRUSS_GREEN);
    bar(w, [-hl, Y1, d], [hl, Y1, d], t, TRUSS_GREEN);
    for (let k = 0; k < nu; k++) {
      const u0 = -hl + (length * k) / nu;
      const u1 = -hl + (length * (k + 1)) / nu;
      bar(w, [u0, Y0, d], [(u0 + u1) / 2, Y1, d], t * 0.7, TRUSS_GREEN);
      bar(w, [(u0 + u1) / 2, Y1, d], [u1, Y0, d], t * 0.7, TRUSS_GREEN);
    }
  }
  for (let k = 0; k <= nu; k++) {
    const u = -hl + (length * k) / nu;
    bar(w, [u, Y0, -hd], [u, Y0, hd], t, TRUSS_GREEN);
    bar(w, [u, Y1, -hd], [u, Y1, hd], t, TRUSS_GREEN);
  }
  // Purlin posts standing on the top chord along one edge.
  for (let k = 0; k <= nu; k++) {
    const u = -hl + (length * k) / nu;
    bar(w, [u, Y1, hd], [u, Y1 + 0.5, hd], t, TRUSS_GREEN);
  }
  bar(w, [-hl, Y1 + 0.5, hd], [hl, Y1 + 0.5, hd], t, TRUSS_GREEN);
  // A scaffold tower, steel sections on the slab, a forklift.
  const s = hl - 3;
  for (const [du, dd] of [
    [0, 0],
    [1.4, 0],
    [0, 1.2],
    [1.4, 1.2],
  ])
    bar(w, [s + du, 0.2, dd], [s + du, 5.2, dd], 0.05, '#c9cdd0', 'metal');
  for (let y = 1.2; y < 5.3; y += 1.3) {
    bar(w, [s, y, 0], [s + 1.4, y, 0], 0.04, '#c9cdd0', 'metal');
    bar(w, [s, y, 1.2], [s + 1.4, y, 1.2], 0.04, '#c9cdd0', 'metal');
  }
  for (const d of [-1.5, -1.1, -0.7])
    w.box('metal', [-hl + 1, -hl + 7], [0.2, 0.36], [d, d + 0.2], '#6d7276');
  w.box('paint', [-2, 0.4], [0.2, 1.4], [hd - 3, hd - 1.8], '#e0742a');
  w.box('paint', [-1.8, -0.4], [1.4, 2.4], [hd - 2.9, hd - 1.9], '#3a3d40');
  w.box('metal', [0.4, 0.5], [0.2, 2.8], [hd - 2.9, hd - 1.9], '#3a3d40');
}

export function dressDealer(ctx: LotCtx): void {
  const { shell, h } = ctx;
  // The container office: white panels in a dark steel frame, a door and windows, an AC unit on the roof.
  for (const w of shell.walls) {
    const L = w.length;
    w.paint([-0.1, 0.12], [0, h], [-0.02, 0.1], DARK_STEEL);
    w.paint([L - 0.12, L + 0.1], [0, h], [-0.02, 0.1], DARK_STEEL);
    w.paint([-0.1, L + 0.1], [h - 0.2, h + 0.05], [-0.02, 0.1], DARK_STEEL);
    w.paint([-0.1, L + 0.1], [-0.1, 0.25], [-0.02, 0.1], DARK_STEEL);
    for (let u = 1.2; u < L - 0.8; u += 1.2)
      w.paint([u - 0.02, u + 0.02], [0.25, h - 0.2], [0, 0.03], '#cfd2d2');
    if (w.w.side === 's') {
      w.doorway([L * 0.2, L * 0.2 + 0.95], 2.1, {
        leaf: 'panel',
        color: '#e3e5e4',
        frame: DARK_STEEL,
      });
      w.window([L * 0.5, L * 0.5 + 1.6], [1, 2.1], {
        frame: DARK_STEEL,
        panes: 2,
        sill: false,
      });
    }
    if (w.w.side === 'n') {
      // The sign panel by the street fence in front of it: dark, two lime stripes, no lettering.
      const m = L / 2;
      w.box('paint', [m - 1.7, m + 1.7], [0.2, 2], [1.6, 1.75], '#2a2e31');
      w.panel('paint', [m - 1.2, m + 1.2], [1.25, 1.33], 1.76, '#9be03c');
      w.panel('paint', [m - 0.8, m + 0.8], [0.85, 0.93], 1.76, '#9be03c');
    }
  }
  shell.finish();
  const wh = ctx.plot.corners.map(([x, z]) => new Vector2(x, z));
  const mid = wh.reduce((s, c) => s.add(c), new Vector2()).divideScalar(4);
  roofUnit(ctx.f, mid, 0.5, 0.4, h, 0.6);

  const { east, carports, truss, flags } = DEALER;
  for (const c of carports) carport(propFrame(ctx, c, east), 9, 5.6);
  trussFrame(propFrame(ctx, truss, east), 12, 12);
  // Flag poles with plain grey banners, and two slim lamps.
  for (const f of flags) {
    const w = propFrame(ctx, f, east);
    w.box('metal', [-0.06, 0.06], [0, 9.5], [-0.06, 0.06], '#3a3e41');
    w.paint([-0.04, 1.2], [9.2, 9.28], [-0.03, 0.03], '#3a3e41');
    for (const [a, b] of [
      [0.06, 0.04],
      [0.04, 0.06],
    ]) {
      // Both faces of the banner.
      const pts: V3[] = [
        [0.08, 5.2, a - 0.05],
        [1.15, 5.6, a - 0.05],
        [1.15, 9.2, b - 0.05],
        [0.08, 9.2, b - 0.05],
      ];
      w.quad(
        'paint',
        a > b ? pts : [pts[3], pts[2], pts[1], pts[0]],
        '#8e908d',
        undefined,
        true,
      );
    }
  }
  for (const c of [carports[0], carports[1]]) {
    const w = propFrame(ctx, c, east);
    w.box('metal', [6.5, 6.62], [0, 7], [3.4, 3.52], '#2f3437');
    w.box('paint', [6.3, 6.95], [6.9, 7.05], [3.35, 3.6], '#2f3437');
  }
}

// ----- south 8: the truck yard -----

export function dressTruckYard(ctx: LotCtx): void {
  const { shell, h } = ctx;
  for (const w of shell.walls) {
    const L = w.length;
    w.plinth('#9a9893', 0.5);
    w.coping('#aeb2b4', 0.2, 0.15);
    if (ctx.dockEdges.has(w.w.side))
      dockDoors(w, ctx, { height: 4.2, width: 3.4 });
    else ribbon(w, [2, L - 2], { width: 2.4, pitch: 5, y: [h - 1.7, h - 0.9] });
  }
  shell.finish();
  const a = ctx.plot.annex!;
  const shed = new Shell(
    ctx.f,
    a.corners,
    a.height,
    { mat: 'sheet', tint: '#d8dbdc' },
    { mat: 'sheet', tint: a.roof! },
  );
  for (const w of shed.walls) {
    const L = w.length;
    w.plinth('#9a9893', 0.4);
    w.coping('#a8473a', 0.15, 0.3);
    if (w.w.side === 'e')
      w.doorway([L * 0.3, L * 0.3 + 3.6], 4, {
        leaf: 'roller',
        color: '#c9ced1',
      });
    if (w.w.side === 'n')
      w.doorway([L * 0.4, L * 0.4 + 1], 2.2, {
        leaf: 'panel',
        color: '#e3e5e4',
      });
  }
  shed.finish();
}

// ----- south 9: the old compound -----

export function dressCompound(ctx: LotCtx): void {
  const { shell, h } = ctx;
  for (const w of shell.walls) {
    const L = w.length;
    w.plinth('#8e8a82', 0.5);
    w.coping('#9c4b3b', 0.12, 0.45);
    if (w.w.side === 'n') {
      w.doorway([L * 0.2, L * 0.2 + 4], 4, {
        leaf: 'panel',
        color: '#7a6f62',
        frame: '#5f5a52',
      });
      ribbon(
        w,
        [L * 0.45, L - 2],
        { width: 1.4, pitch: 3.5, y: [2.2, 3.4] },
        { frame: '#e8e6e0' },
      );
    } else if (L > 15)
      ribbon(
        w,
        [2, L - 2],
        { width: 1.2, pitch: 4, y: [h - 2, h - 1.1] },
        { frame: '#e8e6e0' },
      );
  }
  shell.finish();
  const a = ctx.plot.annex!;
  const shed = new Shell(
    ctx.f,
    a.corners,
    a.height,
    { mat: 'render', tint: a.walls! },
    { mat: 'sheet', tint: a.roof! },
  );
  for (const w of shed.walls) {
    w.plinth('#8e8a82', 0.4);
    w.coping(a.roof!, 0.12, 0.4);
    if (w.w.side === 'n')
      w.window([1.5, 3], [1.2, 2.2], { frame: '#e8e6e0', panes: 2 });
  }
  shed.finish();

  // The gate on the north edge: brick pillars under a blue sign arch (plain), plank leaves, block walls either side.
  const [p0, p1] = ctx.yard.polygon;
  const w = new Wall(ctx.f, lineFrame(p1, p0), 0, {
    mat: 'paint',
    tint: '#ffffff',
  });
  const L = w.length;
  const g0 = L * 0.78 - 3;
  const g1 = L * 0.78 + 3;
  for (const u of [g0 - 0.6, g1])
    w.box('paint', [u, u + 0.6], [0, 3.8], [-0.3, 0.3], '#9a5a43');
  w.box('paint', [g0 - 0.9, g1 + 0.9], [3.8, 4.8], [-0.12, 0.12], '#2c56b8');
  for (let u = g0 + 0.05; u < g1 - 0.05; u += 0.2)
    w.box('paint', [u, u + 0.17], [0.05, 2.1], [-0.05, 0.03], '#6b5a45');
  w.box('paint', [g0 - 3.2, g0 - 1.6], [1.6, 2.8], [0.1, 0.16], '#2f8a4a');
  for (const [u0, u1] of [
    [Math.max(0.2, g0 - 18), g0 - 0.6],
    [g1 + 0.6, Math.min(L - 0.2, g1 + 10)],
  ] as [number, number][]) {
    w.box('concrete', [u0, u1], [-0.3, 2.3], [-0.15, 0.15], '#bdb9b0');
    w.paint([u0, u1], [2.3, 2.4], [-0.18, 0.18], '#a9a59c');
  }
}

// ----- south 10: the statue yard -----

export function dressStatues(ctx: LotCtx): void {
  const { shell, h } = ctx;
  for (const w of shell.walls) {
    w.plinth('#8e8a82', 0.3);
    for (let u = 0.6; u < w.length; u += 0.6)
      w.paint([u - 0.02, u + 0.02], [0.3, h], [0, 0.04], '#a9aeb1');
  }
  gableRoof(shell, 's', h, 1.6, ctx.plot.roof, 0.25);
  shell.finish();

  // White stone statues and broken sculpture in the weeds, west of the shed: figures, groups and fragments.
  const poly = ctx.yard.polygon;
  const [a, b, c, d] = poly;
  const lerp2 = (p: Vector2, q: Vector2, t: number) => p.clone().lerp(q, t);
  const at = (s: number, t: number) => lerp2(lerp2(a, b, s), lerp2(d, c, s), t);
  const STONE = '#e6e3dc';
  let seed = 11;
  const rnd = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return (seed >>> 8) / 16777216;
  };
  // In front of the shed and east of it (it stands in the west half, `s` 0..0.56, `t` 0.23..0.66).
  const spots: [number, number][] = [
    [0.1, 0.08],
    [0.28, 0.12],
    [0.48, 0.07],
    [0.2, 0.17],
    [0.72, 0.45],
    [0.84, 0.58],
    [0.7, 0.74],
    [0.9, 0.86],
    [0.55, 0.88],
    [0.32, 0.86],
  ];
  spots.forEach(([s, t], i) => {
    const p = at(s, t);
    const w = propFrame(ctx, [p.x, p.y], rnd() * Math.PI * 2);
    if (i % 3 === 2) {
      // A fallen fragment.
      w.box('paint', [-0.9, 0.9], [0, 0.55], [-0.35, 0.35], STONE);
      w.box('paint', [0.4, 1.3], [0, 0.35], [0.3, 0.8], '#d9d6ce');
      return;
    }
    const figures = i % 3 === 0 ? 2 : 1;
    w.box('paint', [-0.6, 0.6], [0, 0.35], [-0.45, 0.45], '#d9d6ce');
    for (let k = 0; k < figures; k++) {
      const o = (k - (figures - 1) / 2) * 0.55;
      const tall = 1.5 + rnd() * 0.4;
      w.box(
        'paint',
        [o - 0.22, o + 0.22],
        [0.35, 0.35 + tall],
        [-0.18, 0.18],
        STONE,
      );
      w.box(
        'paint',
        [o - 0.13, o + 0.13],
        [0.35 + tall, 0.35 + tall + 0.28],
        [-0.12, 0.12],
        STONE,
      );
    }
  });
  // Rusty steel arches lying in the weeds by the east fence.
  const arc = propFrame(ctx, [at(0.85, 0.15).x, at(0.85, 0.15).y], 0.3);
  for (let k = 0; k < 4; k++) {
    const u = k * 1.1;
    for (let i = 0; i < 8; i++) {
      const t0 = (Math.PI * i) / 8;
      const t1 = (Math.PI * (i + 1)) / 8;
      bar(
        arc,
        [u, Math.sin(t0) * 1.6, Math.cos(t0) * 2],
        [u, Math.sin(t1) * 1.6, Math.cos(t1) * 2],
        0.06,
        '#8a4a2e',
        'metal',
      );
    }
  }
  // A roadside billboard on two legs in the field north-east of the yard (plain red panel).
  const bp = at(0.92, -0.9);
  const bw = propFrame(ctx, [bp.x, bp.y], -2.62);
  for (const u of [-2.6, 2.6])
    bw.box('metal', [u - 0.12, u + 0.12], [0, 4.2], [-0.12, 0.12], '#7d8286');
  bw.box('paint', [-4.6, 4.6], [4.2, 7.2], [-0.15, 0.15], '#c8372d');
  bw.panel('paint', [-4.3, -2.4], [4.5, 6.9], 0.16, '#f2efe8');
  bw.panel('paint', [-1.8, 4.2], [5.5, 6.1], 0.16, '#f2efe8');
}

// ----- south 11: the wholesale mall -----

const MALL_FASCIA = '#7a3b2e';

export function dressMall(ctx: LotCtx): void {
  const { shell, h, f, plot } = ctx;
  const UP = 3.6; // the upper floor's walkway level
  for (const w of shell.walls) {
    const L = w.length;
    // Concrete plinth, a row of small windows, the upper glazing band behind a walkway rail.
    w.paint([-0.05, L + 0.05], [-0.1, 1.3], [-0.02, 0.08], '#a7a397');
    ribbon(
      w,
      [3, L - 3],
      { width: 3.2, pitch: 4.2, y: [1.7, 2.5] },
      { frame: '#d8d6d0' },
    );
    // The glazing band as real openings in bays (glass laid just in front of a 60 m wall z-fought from afar).
    const bays = Math.max(1, Math.round((L - 6) / 5.4));
    const bay = (L - 6) / bays;
    // (On the north wall the entrance's glazed corner fills the first 7 m from the west end.)
    const [e0, e1] = w.w.span(0, 7.4);
    for (let k = 0; k < bays; k++) {
      const u = 3 + k * bay;
      if (w.w.side === ctx.front && u < e1 && u + bay > e0) continue;
      w.window([u + 0.15, u + bay - 0.15], [UP + 0.4, UP + 3.2], {
        frame: '#e4e2dc',
        panes: 4,
        sill: false,
        depth: 0.12,
        transom: 1.7,
      });
    }
    w.box('render', [2.6, L - 2.6], [UP - 0.2, UP + 0.05], [0, 1.1], '#aaa498');
    w.paint([2.6, L - 2.6], [UP + 1.0, UP + 1.06], [1.04, 1.1], '#c4643f');
    for (let u = 2.7; u < L - 2.5; u += 6)
      w.paint([u - 0.03, u + 0.03], [UP, UP + 1.06], [1.04, 1.1], '#c4643f');
    // The deep red-brown roof fascia, sloping out over the wall all round.
    const OUT = 1.6;
    w.quad(
      'sheet',
      [
        [-OUT, h - 0.9, OUT],
        [L + OUT, h - 0.9, OUT],
        [L + OUT, h + 0.5, 0],
        [-OUT, h + 0.5, 0],
      ],
      MALL_FASCIA,
      [
        [0, 0],
        [L + 2 * OUT, 0],
        [L + 2 * OUT, 2.1],
        [0, 2.1],
      ],
    );
    w.paint(
      [-OUT, L + OUT],
      [h - 1.25, h - 0.9],
      [OUT - 0.06, OUT],
      MALL_FASCIA,
    );
    w.quad(
      'paint',
      [
        [-OUT, h - 1.25, OUT],
        [-OUT, h - 1.25, 0],
        [L + OUT, h - 1.25, 0],
        [L + OUT, h - 1.25, OUT],
      ],
      '#8f8a7f',
      undefined,
      true,
    );
  }
  hippedRoof(f, plot.corners, h + 0.5, plot.roof, ctx.front, 4);

  // The north-west corner: a raised entrance terrace with a glazed corner, a stair / ramp up to it along the
  // north wall, and a flat canopy on black lattice columns.
  const w = shell.side(ctx.front)!;
  const L = w.length;
  // Distances from the west end as u (u runs east to west along a north wall seen from outside).
  const fromWest = w.w.span(0, 1)[0] === 0;
  const at = (d: number) => (fromWest ? d : L - d);
  const span = (d0: number, d1: number): [number, number] =>
    fromWest ? [d0, d1] : [L - d1, L - d0];
  const TD = 4; // terrace depth
  w.box('concrete', span(0, 7), [-0.3, UP], [0, TD], '#bdb8ad');
  // The stair / ramp: from the terrace (7 m from the west end) down to the ground at 21 m.
  const [hiU, loU] = [at(7), at(21)];
  const top: V3[] = [
    [hiU, UP, 1.6],
    [hiU, UP, TD],
    [loU, 0, TD],
    [loU, 0, 1.6],
  ];
  // Counter-clockwise from above when the ramp falls towards +u; reversed when it falls towards -u.
  w.quad(
    'concrete',
    loU > hiU ? top : [top[3], top[2], top[1], top[0]],
    '#c4bfb4',
  );
  const side: V3[] = [
    [Math.min(hiU, loU), -0.3, TD],
    [Math.max(hiU, loU), -0.3, TD],
    [loU > hiU ? loU : hiU, loU > hiU ? 0 : UP, TD],
    [loU > hiU ? hiU : loU, loU > hiU ? UP : 0, TD],
  ];
  w.quad('concrete', side, '#b3aea3');
  for (let d = 7; d <= 21; d += 1.75) {
    const y = UP * (1 - (d - 7) / 14);
    const u = at(d);
    w.box(
      'concrete',
      [u - 0.12, u + 0.12],
      [y, y + 0.9],
      [TD - 0.25, TD - 0.01],
      '#c9c4b9',
    );
  }
  bar(w, [hiU, UP + 0.9, TD - 0.12], [loU, 0.9, TD - 0.12], 0.06, '#c4643f');
  for (let d = 0.3; d < 7; d += 1.7) {
    const u = at(d);
    w.box(
      'concrete',
      [u - 0.12, u + 0.12],
      [UP, UP + 0.9],
      [TD - 0.25, TD - 0.01],
      '#c9c4b9',
    );
  }
  w.paint(
    span(0, 7),
    [UP + 0.85, UP + 0.92],
    [TD - 0.16, TD - 0.08],
    '#c4643f',
  );
  w.applied(span(0.3, 6.5), [UP + 0.1, UP + 3.4], 0.03, {
    frame: '#e4e2dc',
    across: 1.2,
    rows: [UP + 2.4],
  });
  w.box('paint', span(0, 6.8), [UP + 3.4, UP + 3.7], [0, TD - 0.2], '#d1ccc1');
  w.paint(span(0, 6.8), [UP + 3.7, UP + 3.75], [0, TD - 0.2], '#c4643f');
  for (const d of [0.5, 6.3]) {
    const u = at(d);
    const dd0 = TD - 0.6;
    for (const [du, dd] of [
      [-0.2, -0.2],
      [0.2, -0.2],
      [0.2, 0.2],
      [-0.2, 0.2],
    ])
      bar(
        w,
        [u + du, UP, dd0 + dd],
        [u + du, UP + 3.4, dd0 + dd],
        0.05,
        '#1c1e20',
        'metal',
      );
    for (let y = UP; y < UP + 3.3; y += 0.55) {
      bar(
        w,
        [u - 0.2, y, dd0 - 0.2],
        [u + 0.2, y + 0.55, dd0 - 0.2],
        0.035,
        '#1c1e20',
        'metal',
      );
      bar(
        w,
        [u - 0.2, y, dd0 + 0.2],
        [u + 0.2, y + 0.55, dd0 + 0.2],
        0.035,
        '#1c1e20',
        'metal',
      );
    }
  }
  shell.finish();
}
