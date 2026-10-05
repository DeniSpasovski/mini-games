import { Vector2 } from 'three';
import type { MatKey } from '../materials';
import { condenser, solarField } from '../props';
import { Shell, type Wall } from '../wall';
import { COLOR, ribbon, type LotCtx } from './common';
import { fromFront } from './north';

/**
 * North 6-9: office blocks across the street front of a hall (the plot's `annex` is the office, its
 * `corners` the hall behind), modelled from the user's Street View screenshots (`ref-20..29` in
 * `sources/maps/ajvatovci/`). u runs west to east on the street front.
 */

type UW = [number, number];

/**
 * A prism standing out of a wall: `outline` is its footprint in (u, w), from the wall at the left round
 * to the wall at the right (u growing), extruded from `y0` to `y1`. Side faces, top and soffit.
 */
export function prism(
  w: Wall,
  key: MatKey,
  outline: UW[],
  [y0, y1]: [number, number],
  color: string,
  raw = true,
): void {
  for (let i = 0; i + 1 < outline.length; i++) {
    const [ua, wa] = outline[i];
    const [ub, wb] = outline[i + 1];
    w.quad(
      key,
      [
        [ua, y0, wa],
        [ub, y0, wb],
        [ub, y1, wb],
        [ua, y1, wa],
      ],
      color,
      undefined,
      raw,
    );
  }
  // Top (facing up) and soffit (facing down): split into quads fanned from the first point.
  for (let i = 1; i + 1 < outline.length; i++) {
    const [p0, p1, p2] = [outline[0], outline[i], outline[i + 1]];
    // Walking the outline left to right, out of the wall and back, runs counter-clockwise seen from above.
    w.quad(
      key,
      [
        [p0[0], y1, p0[1]],
        [p1[0], y1, p1[1]],
        [p2[0], y1, p2[1]],
        [p2[0], y1, p2[1]],
      ],
      color,
      undefined,
      raw,
    );
    w.quad(
      key,
      [
        [p0[0], y0, p0[1]],
        [p2[0], y0, p2[1]],
        [p1[0], y0, p1[1]],
        [p1[0], y0, p1[1]],
      ],
      color,
      undefined,
      raw,
    );
  }
}

/** The office block's shell (the plot's annex). */
function office(
  ctx: LotCtx,
  mat: MatKey,
  walls: string,
  roof: string,
): { shell: Shell; h: number; front: Wall } {
  const a = ctx.plot.annex!;
  const shell = new Shell(
    ctx.f,
    a.corners,
    a.height,
    { mat, tint: walls },
    { mat: 'roofing', tint: roof },
  );
  return { shell, h: a.height, front: shell.side(ctx.front)! };
}

/** The hall behind the office: plinth, coping, a ribbon of high windows down the sides (the office hides its front). */
function hall(
  ctx: LotCtx,
  o: {
    coping: string;
    plinth?: string;
    windows?: [number, number];
    from?: number;
    dress?: (
      w: Wall,
      near: (d0: number, d1: number) => [number, number],
    ) => void;
  },
): void {
  for (const w of ctx.shell.walls) {
    if (w.w.side === ctx.front) continue;
    const L = w.length;
    w.plinth(o.plinth ?? COLOR.plinth, 0.5);
    w.coping(o.coping, 0.25, 0.12);
    const near = fromFront(w, ctx);
    const side = w.w.side === 'e' || w.w.side === 'w';
    if (o.windows) {
      const [u0, u1] = side ? near(o.from ?? 12, L - 2) : [2, L - 2];
      ribbon(w, [u0, u1], { width: 1.6, pitch: 3.2, y: o.windows });
    }
    o.dress?.(w, near);
  }
  ctx.shell.finish();
}

/** Thin railing: top and bottom rails, posts, and an X in every panel (the north 8 balconies). */
function railing(
  w: Wall,
  [u0, u1]: [number, number],
  y: number,
  out: number,
  color: string,
): void {
  const H = 1.05;
  const t = 0.03;
  const at: [number, number] = [out - t, out + t];
  w.paint([u0, u1], [y + H - 0.04, y + H], at, color);
  w.paint([u0, u1], [y + 0.08, y + 0.11], at, color);
  const n = Math.max(1, Math.round((u1 - u0) / 1.1));
  const step = (u1 - u0) / n;
  for (let k = 0; k <= n; k++) {
    const u = u0 + k * step;
    w.paint([u - t, u + t], [y, y + H], at, color);
  }
  for (let k = 0; k < n; k++) {
    const a = u0 + k * step;
    const b = a + step;
    for (const [p, q] of [
      [a, b],
      [b, a],
    ]) {
      // A thin diagonal bar from (p, bottom) to (q, top), facing out.
      const lo = y + 0.11;
      const hi = y + H - 0.04;
      const dx = 0.025;
      w.quad(
        'paint',
        [
          [p - dx, lo, out + t],
          [p + dx, lo, out + t],
          [q + dx, hi, out + t],
          [q - dx, hi, out + t],
        ],
        color,
        undefined,
        true,
      );
    }
  }
}

/** Steel canopy out of a wall over `u`, `y` high at the wall falling `drop` m over `out` m, on posts. */
export function canopy(
  w: Wall,
  [u0, u1]: [number, number],
  y: number,
  out: number,
  drop: number,
  color: string,
  beams: string,
): void {
  const T = 0.18;
  // Top sheet and its underside.
  w.quad(
    'sheet',
    [
      [u0, y + T, 0],
      [u0, y + T - drop, out],
      [u1, y + T - drop, out],
      [u1, y + T, 0],
    ],
    color,
    [
      [0, 0],
      [0, out],
      [u1 - u0, out],
      [u1 - u0, 0],
    ],
  );
  w.quad(
    'paint',
    [
      [u0, y, 0],
      [u1, y, 0],
      [u1, y - drop, out],
      [u0, y - drop, out],
    ],
    beams,
    undefined,
    true,
  );
  // Edge fascia, beams under it, and posts at the outer edge.
  w.paint([u0, u1], [y - drop - 0.25, y - drop + T], [out - 0.1, out], color);
  const n = Math.max(1, Math.round((u1 - u0) / 3));
  for (let k = 0; k <= n; k++) {
    const u = u0 + 0.1 + ((u1 - u0 - 0.2) * k) / n;
    w.quad(
      'paint',
      [
        [u - 0.06, y - 0.35, 0.02],
        [u + 0.06, y - 0.35, 0.02],
        [u + 0.06, y - drop - 0.2, out - 0.1],
        [u - 0.06, y - drop - 0.2, out - 0.1],
      ],
      beams,
      undefined,
      true,
    );
    w.box(
      'metal',
      [u - 0.08, u + 0.08],
      [0, y - drop],
      [out - 0.3, out - 0.14],
      beams,
    );
  }
}

// ----- north 6: the grey office with the red trim -----

const N6_RED = '#b8352d';
const N6_GREY = '#c7c9c8';
const N6_FRAME = '#2b2f33';

export function dressRedTrim(ctx: LotCtx): void {
  hall(ctx, { coping: '#9fa3a5', windows: [5.3, 6.1], from: 13 });
  const { shell, h, front } = office(ctx, 'render', N6_GREY, '#a7a9a7');
  const FLOOR = 3.5;
  for (const w of shell.walls) {
    const L = w.length;
    const back = w.w.side === 'n';
    w.plinth('#8f8c86', 0.35);
    // Red parapet band round the top, a red floor band, red pilasters at the corners.
    w.paint([-0.12, L + 0.12], [h - 1.1, h + 0.25], [-0.02, 0.12], N6_RED);
    if (back) continue;
    w.paint([0, L], [FLOOR, FLOOR + 0.4], [-0.02, 0.08], N6_RED);
    w.paint([-0.12, 0.7], [0, h - 1.1], [-0.02, 0.12], N6_RED);
    w.paint([L - 0.7, L + 0.12], [0, h - 1.1], [-0.02, 0.12], N6_RED);
    if (w === front) continue;
    // Side walls: the office windows near the front, an AC unit and a dish on the east.
    const near = fromFront(w, ctx);
    for (const d of [2.2, 6.4]) {
      w.window(near(d, d + 2), [4.3, 5.9], {
        frame: N6_FRAME,
        panes: 3,
        sill: false,
      });
      w.window(near(d, d + 2), [0.9, 2.6], {
        frame: N6_FRAME,
        panes: 3,
        sill: false,
      });
    }
    if (w.w.side === 'e') {
      const [u] = near(4.6, 5.6);
      w.box('paint', [u, u + 0.12], [4.6, 5.2], [0, 0.35], '#d8dad8');
      w.box('paint', [u - 0.25, u + 0.4], [4.9, 5.55], [0.35, 0.45], '#eceeed');
    }
  }

  // The street front.
  const w = front;
  const L = w.length;
  const b0 = L * 0.26;
  const b1 = L * 0.5;
  // The red bay over the upper floor: chamfered corners, four tall narrow windows, its top above the parapet.
  const OUT = 0.9;
  const bay: UW[] = [
    [b0, 0],
    [b0 + 0.7, OUT],
    [b1 - 0.7, OUT],
    [b1, 0],
  ];
  prism(w, 'paint', bay, [FLOOR, h + 0.55], N6_RED);
  const face: [number, number] = [b0 + 0.7, b1 - 0.7];
  const n = 4;
  const pitch = (face[1] - face[0]) / n;
  for (let k = 0; k < n; k++) {
    const u = face[0] + pitch * k;
    w.applied([u + 0.2, u + pitch - 0.2], [4.1, 6.7], OUT + 0.01, {
      frame: N6_FRAME,
    });
  }
  // The entrance under it: a wide glazed front, steps, terracotta planters.
  w.applied([b0 + 0.2, b1 - 0.2], [0.35, 3.1], 0.02, {
    frame: N6_FRAME,
    across: 1.3,
    rows: [2.5],
  });
  w.paint([b0 - 0.4, b1 + 0.4], [0, 0.17], [0, 1.6], COLOR.steps);
  w.paint([b0, b1], [0.17, 0.34], [0, 0.9], COLOR.steps);
  for (let u = 1.2; u < L - 1; u += 1.7) {
    if (u > b0 - 0.6 && u < b1 + 0.6) continue;
    w.box('paint', [u, u + 0.9], [0, 0.4], [0.4, 0.8], '#c4683f');
    w.box('leaf', [u + 0.1, u + 0.8], [0.4, 0.75], [0.45, 0.75], '#5f7d3a');
  }
  // Windows: three-pane dark frames upstairs, wide dark glazing on the ground floor.
  const cols = [
    (0.8 + b0) / 2,
    b1 + (L - 0.8 - b1) * 0.27,
    b1 + (L - 0.8 - b1) * 0.73,
  ];
  for (const c of cols) {
    w.window([c - 1.3, c + 1.3], [4.3, 5.9], {
      frame: N6_FRAME,
      panes: 3,
      sill: false,
    });
    w.window([c - 1.5, c + 1.5], [0.6, 2.9], {
      frame: N6_FRAME,
      panes: 3,
      sill: false,
    });
  }
  condenser(w, [cols[2] + 1.8, cols[2] + 2.7]);
  // A generic sign on the parapet above the east half: red letter blocks on white strips, no readable name.
  const s0 = b1 + 1.2;
  const s1 = L - 1.2;
  w.box(
    'paint',
    [s0 - 1.4, s0 - 0.2],
    [h + 0.25, h + 1.5],
    [0.02, 0.14],
    '#f3f1ec',
  );
  w.box(
    'paint',
    [s0 - 1.25, s0 - 0.35],
    [h + 0.4, h + 1.35],
    [0.14, 0.18],
    N6_RED,
  );
  let u = s0;
  let k = 0;
  while (u < s1) {
    const wd = 0.3 + ((k * 37) % 5) * 0.05;
    if (u + wd > s1) break;
    w.box(
      'paint',
      [u - 0.05, u + wd + 0.05],
      [h + 0.25, h + 1.15],
      [0.02, 0.1],
      '#f3f1ec',
    );
    w.box('paint', [u, u + wd], [h + 0.3, h + 1.1], [0.1, 0.16], N6_RED);
    u += wd + (k % 6 === 5 ? 0.5 : 0.08);
    k++;
  }
  shell.finish();
}

// ----- north 7: the three-storey office with the red portal -----

const N7_RED = '#e0262b';
const N7_WALL = '#8b8f92';

export function dressRedPortal(ctx: LotCtx): void {
  hall(ctx, {
    coping: '#e6e7e5',
    plinth: '#6f7376',
    windows: [4.9, 5.9],
    from: 10,
    dress: (w, near) => {
      const L = w.length;
      // The ground floor is darker cladding; the second row of small windows up top.
      w.paint([0, L], [0.5, 3.6], [-0.02, 0.04], '#8a8e91');
      const side = w.w.side === 'e' || w.w.side === 'w';
      const [u0, u1] = side ? near(10, L - 2) : [2, L - 2];
      ribbon(w, [u0, u1], { width: 1.6, pitch: 3.2, y: [8.1, 9.1] });
      if (w.w.side !== 'e') return;
      // East wall: a side door behind a black slatted screen, a white door, a tall sectional door, lamps.
      const [d0, d1] = near(10.2, 11.4);
      w.doorway([d0, d1], 2.3, {
        leaf: 'panel',
        color: '#3d4245',
        frame: '#2a2d30',
      });
      for (let k = 0; k < 8; k++) {
        const s = d0 - 0.4 + k * 0.27;
        w.box('paint', [s, s + 0.12], [0, 2.8], [0.6, 0.66], '#1f2224');
      }
      w.paint([d0 - 0.5, d1 + 0.5], [2.8, 2.95], [0, 0.75], '#1f2224');
      w.doorway(near(12.6, 13.6), 2.2, {
        leaf: 'panel',
        color: '#f2f3f1',
        frame: '#d9dbda',
      });
      if (L > 20)
        w.doorway(near(15.5, 19.5), 4.6, {
          leaf: 'roller',
          color: '#5b6064',
          frame: '#3c4043',
        });
      for (const d of [9.6, 14.6])
        w.box('paint', near(d, d + 0.25), [3.4, 3.6], [0, 0.3], '#d7d9d9');
    },
  });
  const { shell, h, front } = office(ctx, 'render', N7_WALL, '#a9aba9');
  const WIN = '#f4f5f3';
  const floors: [number, number][] = [
    [0.9, 2.3],
    [4.3, 5.7],
    [7.6, 9.0],
  ];
  for (const w of shell.walls) {
    w.coping('#d9dbd9', 0.08, 0.1);
    w.plinth('#7e8285', 0.3);
    if (w === front || w.w.side === 'n') continue;
    const near = fromFront(w, ctx);
    for (const d of [1.6, 5.2])
      for (const y of floors)
        w.window(near(d, d + 1.3), y, { frame: WIN, panes: 2 });
    if (w.w.side === 'e')
      w.box('paint', near(2, 2.2), [0, h - 0.6], [0, 0.12], '#b9bcbe'); // drain pipe
  }
  // The plant / stair box on the roof.
  const w = front;
  const L = w.length;
  const m = L / 2;
  w.box(
    'render',
    [m - 3, m + 3.5],
    [h - 0.1, h + 1.7],
    [-7.5, -3.5],
    '#d6d8d6',
  );

  // The red portal: two pillars up to the second floor and a lintel with downlights; a dark recess with
  // two windows inside, a dark canopy over the glazed entrance, a white sign box on the lintel.
  const P0 = m - 3.4;
  const P1 = m + 3.4;
  const PW = 0.85;
  const OUT = 0.9;
  const TOP = 7.4;
  w.paint([P0, P0 + PW], [0, TOP], [0, OUT], N7_RED);
  w.paint([P1 - PW, P1], [0, TOP], [0, OUT], N7_RED);
  w.paint([P0, P1], [TOP - 0.85, TOP], [0, OUT], N7_RED);
  for (let k = 0; k < 5; k++) {
    const u = P0 + PW + 0.5 + ((P1 - P0 - 2 * PW - 1) * k) / 4;
    w.paint(
      [u - 0.1, u + 0.1],
      [TOP - 0.92, TOP - 0.85],
      [0.35, 0.55],
      '#f6f3e6',
    );
  }
  w.paint([P0 + PW, P1 - PW], [3.6, TOP - 0.85], [-0.02, 0.04], '#55595c');
  for (const c of [m - 1.35, m + 1.35])
    w.window([c - 0.7, c + 0.7], [4.3, 5.7], { frame: WIN, panes: 2 });
  w.paint([P0 - 0.3, P1 + 0.6], [3.25, 3.6], [0, 1.6], '#3b4043');
  w.applied([P0 + PW + 0.1, P1 - PW - 0.1], [0.15, 3.2], 0.03, {
    frame: '#2c3033',
    across: 1,
    rows: [2.4],
  });
  w.paint([P0, P1], [0, 0.15], [0, 1.4], COLOR.steps);
  w.box('paint', [m - 1.1, m + 1.1], [TOP, TOP + 0.85], [0.2, 0.75], '#eef0ef');
  // Windows either side of the portal on every floor, two more above it on the top floor.
  for (const c of [(0.4 + P0) / 2, (P1 + L - 0.4) / 2])
    for (const y of floors)
      w.window([c - 0.65, c + 0.65], y, { frame: WIN, panes: 2 });
  for (const c of [m - 1.6, m + 1.6])
    w.window([c - 0.65, c + 0.65], floors[2], { frame: WIN, panes: 2 });
  // Potted plants along the front.
  for (const u of [P0 - 1.6, P0 - 0.8, P1 + 0.5, P1 + 1.4]) {
    w.box('paint', [u, u + 0.45], [0, 0.45], [0.4, 0.85], '#b9c95a');
    w.box('leaf', [u - 0.05, u + 0.5], [0.45, 1.1], [0.35, 0.9], '#56763a');
  }
  shell.finish();
}

// ----- north 8: the white office with the glass tower -----

const N8_TRIM = '#4a4f53';
const N8_GLASS_FRAME = '#2e3236';

export function dressGlassTower(ctx: LotCtx): void {
  hall(ctx, {
    coping: '#9ea2a4',
    windows: [4.6, 5.4],
    from: 10,
    dress: (w, near) => {
      if (w.w.side !== 'e') return;
      const L = w.length;
      // The lean-to canopy down the east side, a roller door under it.
      canopy(w, near(9.4, L - 0.3), 5.2, 2.4, 0.4, '#c3c7c8', '#6c7175');
      w.doorway(near(12, 16), 4.2, { leaf: 'roller', color: '#c9ced1' });
    },
  });
  const { shell, h, front } = office(ctx, 'panel', '#e7e9e8', '#b4b6b4');
  for (const w of shell.walls) {
    const L = w.length;
    // Dark parapet band and corner trims.
    w.paint([-0.1, L + 0.1], [h - 1.2, h + 0.15], [-0.02, 0.1], '#5a5f63');
    w.paint([-0.1, 0.25], [0, h - 1.2], [-0.02, 0.1], N8_TRIM);
    w.paint([L - 0.25, L + 0.1], [0, h - 1.2], [-0.02, 0.1], N8_TRIM);
    w.plinth('#9a9995', 0.25);
    if (w === front || w.w.side === 'n') continue;
    const near = fromFront(w, ctx);
    w.window(near(3, 4.4), [4.2, 5.8], {
      frame: N8_TRIM,
      panes: 1,
      sill: false,
    });
    w.window(near(1.6, 2.6), [1, 2.4], {
      frame: N8_TRIM,
      panes: 1,
      sill: false,
    });
    w.window(near(5.5, 6.5), [1, 2.4], {
      frame: N8_TRIM,
      panes: 1,
      sill: false,
    });
  }

  const w = front;
  const L = w.length;
  const m = L / 2;
  // The glass stair tower: mirrored dark curtain wall, one storey above the wings, leaning out at the top.
  const T0 = m - 2.6;
  const T1 = m + 2.6;
  const BASE = 1;
  const LEAN = 0.6;
  const TOP = h + 2.2;
  const side = (u: number, flip: boolean) => {
    const pts: [number, number, number][] = [
      [u, 0, 0],
      [u, 0, BASE],
      [u, TOP, BASE + LEAN],
      [u, TOP, 0],
    ];
    w.quad(
      'glass',
      flip ? [pts[3], pts[2], pts[1], pts[0]] : pts,
      '#ffffff',
      undefined,
      true,
    );
  };
  side(T0, false);
  side(T1, true);
  w.quad(
    'glass',
    [
      [T0, 0, BASE],
      [T1, 0, BASE],
      [T1, TOP, BASE + LEAN],
      [T0, TOP, BASE + LEAN],
    ],
    '#ffffff',
    undefined,
    true,
  );
  prism(
    w,
    'paint',
    [
      [T0 - 0.08, 0],
      [T0 - 0.08, BASE + LEAN + 0.08],
      [T1 + 0.08, BASE + LEAN + 0.08],
      [T1 + 0.08, 0],
    ],
    [TOP, TOP + 0.3],
    N8_GLASS_FRAME,
  );
  // The tower's frame: mullions and transoms on the leaning face, edges on its corners.
  const out = (y: number) => BASE + (LEAN * y) / TOP + 0.03;
  const bar = (u0: number, u1: number, y0: number, y1: number) =>
    w.quad(
      'paint',
      [
        [u0, y0, out(y0)],
        [u1, y0, out(y0)],
        [u1, y1, out(y1)],
        [u0, y1, out(y1)],
      ],
      N8_GLASS_FRAME,
      undefined,
      true,
    );
  for (let k = 0; k <= 4; k++) {
    const u = T0 + ((T1 - T0) * k) / 4;
    bar(u - 0.06, u + 0.06, 0, TOP);
  }
  for (let y = 0.05; y < TOP; y += 1.55) bar(T0, T1, y, y + 0.1);
  // Glazed entrance doors at its foot, a wide window either side on the ground floor (east only on the west).
  w.paint(
    [m - 1.2, m + 1.2],
    [0.05, 2.6],
    [out(0) - 0.02, out(0) + 0.01],
    '#3b2a26',
  );
  w.window([T1 + 0.8, T1 + 3.4], [0.5, 2.8], {
    frame: N8_TRIM,
    panes: 1,
    sill: false,
  });

  // The wings: a big square window, a glazed door onto a small balcony, three sunshade fins above.
  for (const sign of [-1, 1]) {
    const inner = sign < 0 ? T0 : T1;
    const outer = sign < 0 ? 0 : L;
    const door: [number, number] =
      sign < 0 ? [inner - 2.3, inner - 1.4] : [inner + 1.4, inner + 2.3];
    const win: [number, number] =
      sign < 0 ? [outer + 1.5, outer + 3.6] : [outer - 3.6, outer - 1.5];
    w.window(win, [3.9, 6.0], { frame: N8_TRIM, panes: 1, sill: false });
    w.window(door, [3.75, 6.05], {
      frame: N8_TRIM,
      panes: 1,
      sill: false,
      depth: 0.12,
    });
    const bal: [number, number] =
      sign < 0 ? [door[0] - 1.6, inner - 0.05] : [inner + 0.05, door[1] + 1.6];
    w.box('paint', bal, [3.45, 3.72], [0, 1.25], '#8f9496');
    railing(w, bal, 3.72, 1.2, '#1f2224');
    for (let k = 0; k < 3; k++) {
      const u = bal[0] + 0.5 + ((bal[1] - bal[0] - 1) * k) / 2;
      w.paint([u - 0.05, u + 0.05], [6.45, 6.55], [0, 1.3], N8_TRIM);
    }
  }
  shell.finish();
}

// ----- north 9: the dark showroom / office -----

const N9_DARK = '#4a4e52';
const N9_FRAME = '#2c3033';

export function dressDarkOffice(ctx: LotCtx): void {
  hall(ctx, {
    coping: '#8c9093',
    windows: [5, 5.8],
    from: 11,
    dress: (w, near) => {
      if (w.w.side !== 'e') return;
      const L = w.length;
      // The big canopy over two roller doors on the east side.
      canopy(w, near(10.3, L - 1), 5.4, 2.4, 0.2, '#8d9295', '#3a3e41');
      for (const d of [12, 17])
        w.doorway(near(d, d + 3.6), 4.4, {
          leaf: 'roller',
          color: '#7c8286',
          frame: N9_FRAME,
        });
    },
  });
  // The hall roof's solar panels (the satellite image's solar roof); those under the office are hidden.
  if (ctx.plot.solar)
    solarField(
      ctx.f,
      ctx.plot.corners.map(([x, z]) => new Vector2(x, z)),
      2.5,
      [3, 3],
      ctx.plot.height + 0.1,
    );
  const { shell, h, front } = office(ctx, 'panel', N9_DARK, '#7f8386');
  const UP = 3.9; // the upper floor starts here
  for (const w of shell.walls) {
    const L = w.length;
    w.coping('#3f4347', 0.1, 0.08);
    // Framed panel bays.
    for (let u = 3; u < L - 1; u += 3)
      w.paint([u - 0.03, u + 0.03], [0, h], [0, 0.05], '#3e4246');
    w.paint([0, L], [UP - 0.1, UP], [0, 0.06], '#3e4246');
    if (w === front || w.w.side === 'n') continue;
    const near = fromFront(w, ctx);
    w.applied(near(1.6, 5.4), [4.6, 7.4], 0.02, {
      frame: N9_FRAME,
      across: 0.95,
    });
    w.applied(near(1.6, 6.6), [0.3, 3.4], 0.02, {
      frame: N9_FRAME,
      across: 1.1,
    });
    if (w.w.side === 'w') {
      // The terrace at the west end: slab, a perforated screen as its railing, a pergola over it.
      const t = near(0.4, 4.4);
      w.box('paint', t, [UP - 0.25, UP + 0.05], [0, 1.9], '#3a3e41');
      w.box('metal', t, [UP + 0.05, UP + 1.15], [1.82, 1.88], '#4d5256');
      for (let u = t[0] + 0.25; u < t[1] - 0.2; u += 0.5)
        for (let y = UP + 0.25; y < UP + 1.0; y += 0.3)
          w.panel('paint', [u, u + 0.22], [y, y + 0.12], 1.885, '#1b1d1f');
      for (const u of [t[0] + 0.05, t[1] - 0.15])
        w.box(
          'metal',
          [u, u + 0.1],
          [UP + 0.05, h - 1.4],
          [1.75, 1.85],
          '#3a3e41',
        );
      w.box('paint', t, [h - 1.5, h - 1.35], [0, 1.95], '#3a3e41');
    }
  }

  const w = front;
  const L = w.length;
  // The upper floor stands 1 m out over the ground floor, with one long band of gridded windows.
  const OUT = 1;
  w.box('panel', [-0.05, L + 0.05], [UP, h + 0.05], [0, OUT], N9_DARK);
  for (let u = 0.1; u < L; u += 3.05)
    w.paint([u - 0.03, u + 0.03], [UP, h], [OUT, OUT + 0.04], '#3e4246');
  const g0 = L * 0.2;
  const g1 = L - 1.2;
  const gw = (g1 - g0) / 3;
  for (let k = 0; k < 3; k++)
    w.applied(
      [g0 + k * gw + 0.12, g0 + (k + 1) * gw - 0.12],
      [4.5, 7.5],
      OUT + 0.01,
      {
        frame: N9_FRAME,
        across: (gw - 0.24) / 4,
        rows: [5.5, 6.5],
        thickness: 0.07,
      },
    );
  // Ground floor: glazed almost full width with doors, a panelled pier at the west end.
  w.applied([2.6, L - 0.4], [0.2, UP - 0.25], 0.02, {
    frame: N9_FRAME,
    across: 1.5,
    rows: [2.7],
  });
  for (const c of [L * 0.38, L * 0.7])
    w.paint([c - 0.9, c + 0.9], [0.2, 2.6], [0.03, 0.05], '#2a2c2e');
  // Two raised planter beds in front, weedy.
  for (const [u0, u1] of [
    [1, 5.5],
    [L * 0.42, L * 0.42 + 3.5],
  ] as [number, number][]) {
    w.box('concrete', [u0, u1], [0, 0.35], [3.2, 5.6], '#cfccc4');
    w.box('leaf', [u0 + 0.2, u1 - 0.2], [0.35, 0.8], [3.4, 5.4], '#7b8a4a');
  }
  shell.finish();
}
