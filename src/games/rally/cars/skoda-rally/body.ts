import { TorusGeometry, type BufferGeometry } from 'three';
import {
  box,
  cyl,
  emptyGeometry,
  mergeAll,
  rbox,
  type CarPartGeometry,
} from '../shared/car-parts';
import {
  Soup,
  clamp,
  densify,
  lerp,
  offsetPoly,
  roundedPoly,
  smoothstep,
  table,
  vtx,
  type P2,
  type V3,
} from '../shared/mesh-kit';
import { face, frame, plane, rrect, slab, walls } from '../zastava-101/lamps';
import * as B from './blueprint';
import { uvFront, uvRear, uvSide, uvTop } from './paint';

/**
 * Skoda Rally body, built from blueprint.ts - same construction as the
 * Zastava (cars/zastava-101/body.ts):
 *  - body sides: columns of 16 points (sill / arch edge -> crease -> belt -> shoulder) at stations
 *    from z = 1.65 back to z = -2.0, dense round the wheel arches (rows follow the opening so the
 *    flare band has crisp edges); behind the C pillar the columns continue up the leaning quarter
 *    to the rear screen's side edge;
 *  - top: rows across the car - bonnet, windscreen (open), roof, rear screen (open), tailgate top -
 *    whose ends sit on the side columns / the pillar + rail edges;
 *  - nose and tail: x-y panels that round off in plan (|u|^3 nose, u^2 tail) and dome over the
 *    bonnet lip, leaving no column to lean;
 *  - cabin sides (A / B / C pillars, door frames): a polygon with the three window openings on the
 *    leaning side-glass plane.
 * Then: wheel wells + floor, glass + rubbers, rally parts (skirt, splitter, vents, scoop, wing,
 * mirrors, grille, intakes, lamps, diffuser), a cockpit with a roll cage.
 */

const TOP = 15;
const LOWER = [0, 0.05, 0.12, 0.22, 0.38, 0.58, 0.8, 1];
/** Rows round a wheel arch sit at these fractions of the flare band outside the opening. */
const LIP_D = [0, 0.4, 0.55, 0.78, 1];
/** Columns across the top surfaces (fraction of the half width); 0.95 / 0.85 = screen edges. */
const U_HALF = [0, 0.2, 0.4, 0.58, 0.72, 0.85, 0.9, 0.95, 1];
const U = [
  ...U_HALF.slice(1)
    .reverse()
    .map((u) => -u),
  ...U_HALF,
];
const SCREEN_F = [0, 0.06, 0.2, 0.35, 0.5, 0.65, 0.8, 0.94, 1];
const SCREEN_GLASS: P2 = [0.06, 0.94];
const SCREEN_U = 0.95;
const REAR_F = [0, 0.1, 0.25, 0.42, 0.6, 0.78, 0.92, 1];
const REAR_GLASS: P2 = [0.1, 0.92];
const REAR_U = 0.85;
const ROOF_Z = [
  0.05, -0.02, -0.1, -0.2, -0.32, -0.45, -0.58, -0.72, -0.86, -1.0, -1.1, -1.2,
];
/** Plan rounding of the nose / tail panels (|u|^p; the nose is blunt, ref-01 top view). */
const NOSE_P = 6;
const TAIL_P = 2;
/** First / last side column: the nose and tail panels take over beyond them. */
const Z_NOSE_COL = 1.65;
const Z_TAIL_COL = -2.0;
/** Scuttle bow: the windscreen base is 11 cm further back on the centreline than at the wings. */
const bonnetBow = (z: number) =>
  0.11 * clamp((B.Z_TIP - z) / (B.Z_TIP - B.SCREEN_SIDE[0][0]), 0, 1) ** 1.5;
const roofBow = table([
  [-1.2, 0],
  [-0.8, 0],
  [0.05, 0.03],
]);
/** Centreline z of the nose at height y (bumper face, then the domed bonnet lip). */
const zcNose = table([
  [0.6, B.Z_TIP],
  [0.7, 1.93],
  [0.76, 1.85],
  [0.815, 1.75],
  [0.845, 1.65],
]);
/** Centreline z of the tail at height y (bumper, then the leaning tailgate). */
const zcTail = (y: number) => B.Z_TAIL + B.tailSetback(y);

/** Stations (z of the column) along the body side, nose -> tail. */
function stations(): number[] {
  const keys = [
    Z_NOSE_COL,
    B.SCREEN_SIDE[0][0],
    B.Z_BELT_F,
    B.Z_BELT_R,
    B.C_EDGE[0][0],
    B.C_EDGE[1][0],
    Z_TAIL_COL,
  ];
  const zs = [...keys];
  for (const a of [B.ARCH_F, B.ARCH_R]) {
    const o = a.opening;
    for (const [z] of o) zs.push(z);
    for (let i = 0; i + 1 < o.length; i++) zs.push((o[i][0] + o[i + 1][0]) / 2);
    const z0 = o[0][0];
    const z1 = o[o.length - 1][0];
    for (const e of [...LIP_D.slice(1).map((k) => k * a.lipW), a.lipW + 0.03])
      zs.push(z0 - e, z1 + e);
  }
  for (let z = 1.6; z > -2.0; z -= 0.1) zs.push(z);
  zs.sort((a, b) => b - a);
  const out: number[] = [];
  for (const z of zs) {
    if (z > Z_NOSE_COL || z < Z_TAIL_COL) continue;
    const prev = out[out.length - 1];
    if (prev === undefined || prev - z > 0.006) out.push(z);
    else if (keys.includes(z)) out[out.length - 1] = z;
  }
  return out;
}

/**
 * Heights of the 8 rows below the crease. Over a wheel arch the first rows follow the opening
 * outline (and circles round its ends), so the flare band has clean edges.
 */
function lowerRows(z0: number, low: number, top: number): number[] {
  for (const a of [B.ARCH_F, B.ARCH_R]) {
    const o = a.opening;
    const za = o[0][0];
    const zb = o[o.length - 1][0];
    if (z0 < za - a.lipW - 1e-6 || z0 > zb + a.lipW + 1e-6) continue;
    const inside = z0 > za && z0 < zb;
    const dz = inside ? 0 : z0 <= za ? za - z0 : z0 - zb;
    const ys = [low];
    for (const k of LIP_D.slice(1)) {
      const rr = k * a.lipW;
      const y = inside
        ? low + rr
        : rr >= dz
          ? 0.19 + Math.sqrt(rr * rr - dz * dz)
          : low;
      ys.push(Math.max(y, ys[ys.length - 1] + 1e-4));
    }
    const y4 = Math.min(ys[4], top - 0.01);
    ys[4] = y4;
    return [...ys, ...[0.3, 0.62, 1].map((f) => lerp(y4, top, f))];
  }
  return LOWER.map((g) => lerp(low, top, g));
}

/** Half width of the body skin at (z, y): side below the belt, leaning cabin plane above it. */
function skinX(z: number, y: number): number {
  const b = B.belt(z);
  if (z <= B.Z_BELT_F && y > b && B.shoulder(z) > b + 0.02)
    return B.cabinX(z, y);
  return B.sideX(z, y);
}

/** One column of the body side (left, x > 0): 16 points from the lower edge up to the shoulder. */
function sideColumn(z0: number): V3[] {
  const top = B.shoulder(z0);
  const low = B.lowerEdge(z0);
  const quarter = z0 <= B.Z_BELT_F && top > B.belt(z0) + 0.02;
  const yC = Math.min(
    Math.max(B.CREASE_Y, low + B.ARCH_F.lipW + 0.03),
    (quarter ? B.belt(z0) : top) - 0.05,
  );
  const pts: V3[] = [];
  const add = (x: number, y: number) => pts.push([x + B.archLip(z0, y), y, z0]);
  for (const y of lowerRows(z0, low, yC - 0.01)) add(skinX(z0, y), y);
  add(skinX(z0, yC), yC);
  if (quarter) {
    const yb = B.belt(z0);
    for (const h of [0, 0.35, 0.7, 1]) {
      const y = lerp(yC + 0.01, yb, h);
      add(skinX(z0, y), y);
    }
    for (const h of [0.35, 0.7, 1]) {
      const y = lerp(yb, top, h);
      add(B.cabinX(z0, y), y);
    }
  } else {
    const ys = top - 0.03;
    for (const h of [0, 0.3, 0.65, 1]) {
      const y = lerp(yC + 0.01, ys, h);
      add(skinX(z0, y), y);
    }
    // Rounded shoulder.
    for (const a of [0.33, 0.66, 1]) {
      const t = (a * Math.PI) / 2;
      const y = ys + 0.03 * Math.sin(t);
      add(skinX(z0, y) - 0.02 * (1 - Math.cos(t)), y);
    }
  }
  return pts;
}

/** Point of a side column at height y. */
function colAt(col: V3[], y: number): V3 {
  for (let j = 0; j < TOP; j++)
    if (y <= col[j + 1][1]) {
      const t = clamp((y - col[j][1]) / (col[j + 1][1] - col[j][1]), 0, 1);
      return [
        lerp(col[j][0], col[j + 1][0], t),
        y,
        lerp(col[j][2], col[j + 1][2], t),
      ];
    }
  return col[TOP];
}

/** A line across a top surface: its end on the body-side edge (left) and its centre point. */
interface TopRow {
  e: V3;
  c: V3;
  /** Cross-section crown exponent. */
  pow: number;
  /** The strip from this row to the next is open (glass) for |u| <= this. */
  open?: number;
}
function topPoint(r: TopRow, u: number): V3 {
  const a = Math.abs(u);
  return [
    r.e[0] * u,
    r.e[1] + (r.c[1] - r.e[1]) * (1 - a ** r.pow),
    r.e[2] + (r.c[2] - r.e[2]) * (1 - a * a),
  ];
}
function screenRow(f: number): TopRow {
  const [a0, a1] = B.SCREEN_SIDE;
  const [s0, s1] = B.SCREEN;
  const z = lerp(a0[0], a1[0], f);
  const y = lerp(a0[1], a1[1], f);
  return {
    e: [B.cabinX(z, y), y, z],
    c: [0, lerp(s0[1], s1[1], f), lerp(s0[0], s1[0], f)],
    pow: 2,
  };
}
/** Rear screen rows: side edge down the C edge, centreline from the roof lip down the screen. */
function rearRow(f: number): TopRow {
  const [a0, a1] = B.C_EDGE;
  const z = lerp(a0[0], a1[0], f);
  const y = lerp(a0[1], a1[1], f);
  const [s0, s1] = B.REAR_SCREEN;
  const c: P2 =
    f < 0.1
      ? [
          lerp(B.ROOF_LIP[0], s0[0], f / 0.1),
          lerp(B.ROOF_LIP[1], s0[1], f / 0.1),
        ]
      : [
          lerp(s0[0], s1[0], (f - 0.1) / 0.9),
          lerp(s0[1], s1[1], (f - 0.1) / 0.9),
        ];
  return { e: [B.cabinX(z, y), y, z], c: [0, c[1], c[0]], pow: 2 };
}
function roofRow(z: number): TopRow {
  const y = B.rail(z);
  const zc = z + roofBow(z);
  return { e: [B.cabinX(z, y), y, z], c: [0, B.centre(zc), zc], pow: 2.6 };
}

const addV = (p: V3, d: V3, k: number): V3 => [
  p[0] + d[0] * k,
  p[1] + d[1] * k,
  p[2] + d[2] * k,
];

export function buildSkodaRallyBody(): {
  paint: BufferGeometry;
  parts: CarPartGeometry;
} {
  const paint = new Soup();
  const painted = new Soup();
  const trim = new Soup();
  const carbon = new Soup();
  const glass = new Soup();
  const lining = new Soup();
  const cabin = new Soup();
  const mesh = new Soup();
  const trimParts: BufferGeometry[] = [];
  const carbonParts: BufferGeometry[] = [];
  const meshParts: BufferGeometry[] = [];
  const paintParts: BufferGeometry[] = [];
  const lightParts: BufferGeometry[] = [];
  const tailParts: BufferGeometry[] = [];
  const cabinParts: BufferGeometry[] = [];
  const cageParts: BufferGeometry[] = [];

  const zs = stations();
  const cols = zs.map(sideColumn);
  const iScuttle = zs.indexOf(B.SCREEN_SIDE[0][0]);
  const iA = zs.indexOf(B.Z_BELT_F);
  const iC = zs.indexOf(B.Z_BELT_R);
  const iLamp = zs.indexOf(B.C_EDGE[1][0]);
  const last = cols.length - 1;

  // --- body sides + wheel wells / floor -------------------------------------------------------
  /** Flat floor, rising into the diffuser behind the rear axle. */
  const floorY = (z: number) => lerp(0.14, 0.25, smoothstep(-1.6, -2.0, z));
  for (const s of [1, -1]) {
    paint.grid(
      cols.map((col) =>
        col.map(([x, y, z]) => vtx(s * x, y, z, uvSide(s, z, y))),
      ),
      [s, 0.2, 0],
    );
    trim.grid(
      cols.map((col) => {
        const [x, y, z] = col[0];
        const deep = 0.6 - 0.1 * smoothstep(0.55, 0.7, z);
        const xin = Math.min(deep, x - 0.03);
        return [
          vtx(s * x, y, z),
          vtx(s * xin, y, z),
          vtx(s * xin, floorY(z), z),
          vtx(0, floorY(z), z),
        ];
      }),
    );
  }

  // --- top surfaces ---------------------------------------------------------------------------------
  const rows: TopRow[] = [];
  for (let i = 0; i <= iScuttle; i++) {
    const zc = zs[i] + bonnetBow(zs[i]);
    rows.push({ e: cols[i][TOP], c: [0, B.centre(zc), zc], pow: 2.2 });
  }
  const iScreen = rows.length;
  for (const f of SCREEN_F) rows.push(screenRow(f));
  for (const z of ROOF_Z) rows.push(roofRow(z));
  const iRear = rows.length;
  for (const f of REAR_F) rows.push(rearRow(f));
  const iHatch = rows.length;
  // Tailgate top band: level rows from the lamp tops to the centreline.
  for (let i = iLamp + 1; i <= last; i++) {
    const e = cols[i][TOP];
    rows.push({ e, c: [0, e[1], zcTail(e[1])], pow: 2.2 });
  }
  SCREEN_F.forEach((f, k) => {
    if (f >= SCREEN_GLASS[0] && f < SCREEN_GLASS[1])
      rows[iScreen + k].open = SCREEN_U;
  });
  REAR_F.forEach((f, k) => {
    if (f >= REAR_GLASS[0] && f < REAR_GLASS[1]) rows[iRear + k].open = REAR_U;
  });
  const isOpen = (i: number, j: number) => {
    const open = rows[i].open;
    return (
      open !== undefined &&
      Math.max(Math.abs(U[j]), Math.abs(U[j + 1])) <= open + 1e-6
    );
  };
  paint.grid(
    rows.map((r) =>
      U.map((u) => {
        const [x, y, z] = topPoint(r, u);
        return vtx(x, y, z, uvTop(z, x));
      }),
    ),
    [0, 1, 0],
    isOpen,
  );
  // Headliner (seen from inside / through the glass).
  lining.grid(
    rows.slice(iScreen, iHatch + 1).map((r) =>
      U.map((u) => {
        const [x, y, z] = topPoint(r, u * 0.985);
        return vtx(x, y - 0.018, z);
      }),
    ),
    [0, 1, 0],
    (i, j) => isOpen(i + iScreen, j),
  );
  /** Height of the top surface at (x, z) on the bonnet (rows up to the scuttle). */
  const bonnetY = (x: number, z: number): number => {
    for (let i = 0; i < iScuttle; i++) {
      const a = rows[i];
      const b = rows[i + 1];
      if (z <= a.e[2] && z >= b.e[2]) {
        const t = (a.e[2] - z) / (a.e[2] - b.e[2] || 1);
        const ya = topPoint(a, clamp(Math.abs(x) / a.e[0], 0, 1))[1];
        const yb = topPoint(b, clamp(Math.abs(x) / b.e[0], 0, 1))[1];
        return lerp(ya, yb, t);
      }
    }
    return B.centre(z);
  };

  // --- nose + tail panels ------------------------------------------------------------------------
  /** End of a panel row at height y: on the column, or above it on the first / last top row. */
  const panelEnd = (col: V3[], y: number): V3 => {
    if (y <= col[TOP][1]) return colAt(col, y);
    const first = rows[col === cols[0] ? 0 : rows.length - 1];
    const t = clamp((first.c[1] - y) / (first.c[1] - first.e[1] || 1), 0, 1);
    return topPoint(first, t ** (1 / first.pow));
  };
  /** z of a nose / tail panel at (x, y): centreline zc, rounded in plan by |u|^p out to the column. */
  const panelZ = (
    col: V3[],
    zc: (y: number) => number,
    p: number,
    x: number,
    y: number,
  ): number => {
    const [xe, , ze] = panelEnd(col, y);
    const u = clamp(Math.abs(x) / (xe || 1e-6), 0, 1);
    const z0 = zc(y);
    return z0 + (ze - z0) * u ** p;
  };
  /** Panel between the first / last column and the centreline, rounded in plan by |u|^p. */
  const panel = (
    col: V3[],
    endZ: (y: number) => number,
    zc: (y: number) => number,
    yTop: number,
    p: number,
    out: V3,
    uvOf: (x: number, y: number) => P2,
    extraYs: number[],
  ) => {
    const ys = [...col.map((q) => q[1]).filter((y) => y < yTop), ...extraYs]
      .sort((a, b) => a - b)
      .filter((y, i, a) => i === 0 || y - a[i - 1] > 1e-4);
    const us = [-0.95, -0.85, -0.7, -0.5, -0.25, 0, 0.25, 0.5, 0.7, 0.85, 0.95];
    const grid = ys.map((y) => {
      const [xe, , ze] = panelEnd(col, y);
      const z0 = zc(y);
      const row = [vtx(-xe, y, ze, uvOf(-xe, y))];
      for (const u of us)
        row.push(
          vtx(u * xe, y, z0 + (ze - z0) * Math.abs(u) ** p, uvOf(u * xe, y)),
        );
      row.push(vtx(xe, y, ze, uvOf(xe, y)));
      return row;
    });
    // Close the dome: a final row collapsed on the centreline.
    const yt = yTop;
    const zt = zc(yt);
    grid.push(grid[grid.length - 1].map(() => vtx(0, yt, zt, uvOf(0, yt))));
    paint.grid(grid, out);
    void endZ;
  };
  panel(
    cols[0],
    () => Z_NOSE_COL,
    zcNose,
    B.centre(Z_NOSE_COL + bonnetBow(Z_NOSE_COL)) - 0.002,
    NOSE_P,
    [0, 0.4, 1],
    uvFront,
    [0.55, 0.6, 0.66, 0.72, 0.78, 0.82],
  );
  panel(
    cols[last],
    () => Z_TAIL_COL,
    zcTail,
    cols[last][TOP][1] + 0.001,
    TAIL_P,
    [0, 0.2, -1],
    uvRear,
    [0.5, 0.56, 0.62, 0.7, 0.8, 0.9],
  );

  // --- cabin sides: pillars + door frames round the window openings ---------------------------------
  const edge = (r: TopRow): P2 => [r.e[2], r.e[1]];
  const outline: P2[] = [
    ...cols.slice(iA, iC + 1).map((c): P2 => [c[TOP][2], c[TOP][1]]),
    [B.C_PILLAR[1][0], B.C_PILLAR[1][1]],
    ...rows
      .slice(iScreen + 1, iRear)
      .reverse()
      .map(edge),
    ...cols.slice(iScuttle, iA).map((c): P2 => [c[TOP][2], c[TOP][1]]),
  ];
  const windows = [B.WINDOW_F, B.WINDOW_R, B.WINDOW_Q].map((w) =>
    roundedPoly(w, 0.03, 5),
  );
  for (const s of [1, -1]) {
    const on = (dx: number) => (z: number, y: number) =>
      vtx(s * (B.cabinX(z, y) + dx), y, z, uvSide(s, z, y));
    paint.polygon(outline, windows, on(0), [s, 0, 0]);
    lining.polygon(outline, windows, on(-0.02), [s, 0, 0]);
    windows.forEach((w, k) => {
      glass.polygon(offsetPoly(w, 0.004), [], on(-0.003), [s, 0, 0]);
      trim.polygon(offsetPoly(w, 0.014), [offsetPoly(w, -0.01)], on(0.0025), [
        s,
        0,
        0,
      ]);
      // Black vent panel along the top of the rear door / quarter glass.
      if (k > 0) {
        const top = Math.max(...w.map((q) => q[1]));
        const strip = w.filter((q) => q[1] > top - B.VENT_PANEL_H - 0.02);
        if (strip.length >= 3)
          trim.polygon(
            [
              ...strip,
              [strip[strip.length - 1][0], top - B.VENT_PANEL_H],
              [strip[0][0], top - B.VENT_PANEL_H],
            ],
            [],
            on(0.0015),
            [s, 0, 0],
          );
      }
    });
  }

  // --- windscreen + rear screen: glass and rubbers ------------------------------------------------------
  const screens = [
    {
      row: screenRow,
      fs: SCREEN_F,
      f: SCREEN_GLASS,
      u: SCREEN_U,
      out: [0, 0.8, 0.6] as V3,
    },
    {
      row: rearRow,
      fs: REAR_F,
      f: REAR_GLASS,
      u: REAR_U,
      out: [0, 0.75, -0.66] as V3,
    },
  ];
  for (const sc of screens) {
    const us = U.filter((u) => Math.abs(u) <= sc.u + 1e-6);
    glass.grid(
      sc.fs
        .filter((f) => f >= sc.f[0] && f <= sc.f[1])
        .map((f) =>
          us.map((u) => vtx(...addV(topPoint(sc.row(f), u), sc.out, -0.004))),
        ),
      sc.out,
    );
    const rect = (du: number, df: number): P2[] => [
      [-sc.u - du, sc.f[0] - df],
      [sc.u + du, sc.f[0] - df],
      [sc.u + du, sc.f[1] + df],
      [-sc.u - du, sc.f[1] + df],
    ];
    trim.polygon(
      densify(rect(0.02, 0.022), 0.1),
      [densify(roundedPoly(rect(-0.03, -0.03), 0.07, 5), 0.1)],
      (u, f) => vtx(...addV(topPoint(sc.row(f), u), sc.out, 0.003)),
      sc.out,
    );
  }

  // --- rally body kit --------------------------------------------------------------------------------
  // Side skirt under the doors.
  for (const s of [1, -1]) {
    const x = B.sideX(0, 0.21) + B.SKIRT.out - 0.03;
    trimParts.push(
      box(
        0.06,
        B.SKIRT.y[1] - B.SKIRT.y[0] + 0.01,
        B.SKIRT.z[0] - B.SKIRT.z[1],
        s * x,
        (B.SKIRT.y[0] + B.SKIRT.y[1]) / 2,
        (B.SKIRT.z[0] + B.SKIRT.z[1]) / 2,
      ),
    );
  }
  // Splitter + the black lower bumper band it hangs from.
  carbonParts.push(
    box(
      B.SPLITTER.hw * 2,
      B.SPLITTER.y[1] - B.SPLITTER.y[0],
      B.SPLITTER.z - B.SPLITTER.back,
      0,
      (B.SPLITTER.y[0] + B.SPLITTER.y[1]) / 2,
      (B.SPLITTER.z + B.SPLITTER.back) / 2,
    ),
  );
  trimParts.push(box(1.5, 0.05, 0.08, 0, 0.155, B.Z_TIP - 0.05));
  // Bonnet vents: carbon frame recessed into the bonnet, mesh inside.
  for (const s of [1, -1]) {
    const patch = (soup: Soup, pad: number, lift: number) =>
      soup.grid(
        [
          B.VENT.z[1] + pad,
          (B.VENT.z[0] + B.VENT.z[1]) / 2,
          B.VENT.z[0] - pad,
        ].map((z) =>
          [
            B.VENT.x[0] - pad,
            (B.VENT.x[0] + B.VENT.x[1]) / 2,
            B.VENT.x[1] + pad,
          ].map((x) => vtx(s * x, bonnetY(x, z) + lift, z, [x, z])),
        ),
        [0, 1, 0],
      );
    patch(carbon, 0.015, 0.003);
    patch(mesh, 0, 0.006);
  }
  // Roof scoop (carbon): a low wedge sunk into the roof's front curve, dark mesh mouth.
  const scoopZ = (B.SCOOP.z[0] + B.SCOOP.z[1]) / 2;
  const scoopLen = B.SCOOP.z[0] - B.SCOOP.z[1];
  const scoopTilt = Math.atan2(
    B.centre(B.SCOOP.z[1]) - B.centre(B.SCOOP.z[0]),
    scoopLen,
  );
  carbonParts.push(
    rbox(
      B.SCOOP.hw * 2,
      0.07,
      scoopLen,
      0.02,
      0,
      B.centre(scoopZ) + 0.02,
      scoopZ,
      scoopTilt,
    ),
  );
  meshParts.push(
    box(
      B.SCOOP.hw * 2 - 0.08,
      0.036,
      0.012,
      0,
      B.centre(B.SCOOP.z[0]) + 0.035,
      B.SCOOP.z[0] - 0.004,
      scoopTilt,
    ),
  );
  // Rear wing: main plane rising to the trailing edge, end plates, swan-neck pylons.
  const wingLen = B.WING.z[0] - B.WING.z[1];
  const wingRise = B.WING.y[1] - B.WING.y[0];
  const wingZ = (B.WING.z[0] + B.WING.z[1]) / 2;
  const wingY = (B.WING.y[0] + B.WING.y[1]) / 2;
  carbonParts.push(
    box(
      B.WING.halfSpan * 2,
      0.022,
      wingLen,
      0,
      wingY,
      wingZ,
      Math.atan2(wingRise, wingLen),
    ),
  );
  for (const s of [1, -1]) {
    carbonParts.push(
      box(
        0.012,
        B.WING.plateH,
        wingLen + 0.04,
        s * B.WING.halfSpan,
        wingY + 0.03,
        wingZ,
      ),
    );
    const [pz, py] = B.WING.pylonBase;
    const dz = B.WING.z[0] - 0.08 - pz;
    const dy = B.WING.y[0] + 0.01 - py;
    carbonParts.push(
      box(
        0.04,
        0.028,
        Math.hypot(dz, dy),
        s * B.WING.pylonX,
        py + dy / 2,
        pz + dz / 2,
        -Math.atan2(dy, -dz),
      ),
    );
  }
  // Mirrors on the sail panels.
  for (const s of [1, -1]) {
    const mx = B.cabinX(B.MIRROR.z, 0.98);
    carbonParts.push(
      rbox(0.17, 0.09, 0.09, 0.02, s * (mx + 0.14), 0.99, B.MIRROR.z),
      box(0.1, 0.022, 0.035, s * (mx + 0.05), 0.955, B.MIRROR.z),
    );
  }
  // Door handles (body colour).
  for (const s of [1, -1])
    for (const h of [B.HANDLE_F, B.HANDLE_R]) {
      const z = (h.z[0] + h.z[1]) / 2;
      paintParts.push(
        rbox(
          0.02,
          0.03,
          h.z[0] - h.z[1],
          0.008,
          s * (B.sideX(z, h.y) + 0.008),
          h.y,
          z,
        ),
      );
    }

  // --- nose: grille, intakes, headlights --------------------------------------------------------------
  const lean = Math.atan2(B.Z_TIP - zcNose(0.72), 0.22);
  const cl = Math.cos(lean);
  const sl = Math.sin(lean);
  const nose = plane(
    [0, B.GRILLE.y0, B.Z_TIP + 0.004],
    [1, 0, 0],
    [0, cl, -sl],
    [0, sl, cl],
  );
  const gh = (B.GRILLE.y1 - B.GRILLE.y0) / cl;
  const hex: P2[] = [
    [-B.GRILLE.hw + 0.07, 0],
    [B.GRILLE.hw - 0.07, 0],
    [B.GRILLE.hw, gh * 0.5],
    [B.GRILLE.hw - 0.07, gh],
    [-B.GRILLE.hw + 0.07, gh],
    [-B.GRILLE.hw, gh * 0.5],
  ];
  const hexIn = offsetPoly(hex, -0.022);
  frame(trim, nose, hex, hexIn, -0.02, 0.012, -0.03);
  face(mesh, nose, hexIn, [], -0.03);
  for (let a = -0.3; a <= 0.3001; a += 0.05)
    slab(trim, nose, a - 0.004, a + 0.004, 0.02, gh - 0.02, -0.03, -0.012);
  // Lower intake in the bumper face.
  const bumper = plane(
    [0, 0, B.Z_TIP + 0.002],
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  );
  const low = rrect(
    0,
    (B.INTAKE_LOW.y0 + B.INTAKE_LOW.y1) / 2,
    B.INTAKE_LOW.hw * 2,
    B.INTAKE_LOW.y1 - B.INTAKE_LOW.y0,
    0.03,
  );
  frame(trim, bumper, low, offsetPoly(low, -0.018), -0.01, 0.008, -0.04);
  face(mesh, bumper, offsetPoly(low, -0.018), [], -0.04);
  /**
   * z of the skin at (|x|, y) near an end of the car: on the nose / tail panel, or, further out
   * than the panel's edge, on the side columns that round the corner (`end` 0 = nose, 1 = tail).
   */
  const skinZ = (end: 0 | 1, x: number, y: number): number => {
    const col = end ? cols[last] : cols[0];
    const ax = Math.abs(x);
    const [xe] = panelEnd(col, y);
    if (ax <= xe)
      return panelZ(col, end ? zcTail : zcNose, end ? TAIL_P : NOSE_P, ax, y);
    const step = end ? -1 : 1;
    let i = end ? last : 0;
    let prev = colAt(col, y);
    for (let k = 0; k < 12; k++) {
      const j = i - step;
      if (j < 0 || j > last) break;
      const q = colAt(cols[j], y);
      if (q[0] < prev[0] - 1e-4) return prev[2];
      if (q[0] >= ax) {
        const t = (ax - prev[0]) / (q[0] - prev[0] || 1);
        return lerp(prev[2], q[2], clamp(t, 0, 1));
      }
      prev = q;
      i = j;
    }
    return prev[2];
  };
  const noseZ = (x: number, y: number) => skinZ(0, x, y);
  // Corner intakes, set into the rounded bumper corners (plane follows the skin there).
  for (const s of [1, -1]) {
    const cx = (B.INTAKE_CORNER.x[0] + B.INTAKE_CORNER.x[1]) / 2;
    const cy = (B.INTAKE_CORNER.y[0] + B.INTAKE_CORNER.y[1]) / 2;
    const dzdx = (noseZ(cx + 0.03, cy) - noseZ(cx - 0.03, cy)) / 0.06;
    const nl = Math.hypot(dzdx, 1);
    const n: V3 = [(s * -dzdx) / nl, 0, 1 / nl];
    const corner = plane(
      [s * cx, cy, noseZ(cx, cy) + 0.002],
      [s * n[2], 0, -s * n[0]],
      [0, 1, 0],
      n,
    );
    const c = rrect(
      0,
      0,
      (B.INTAKE_CORNER.x[1] - B.INTAKE_CORNER.x[0]) * nl,
      B.INTAKE_CORNER.y[1] - B.INTAKE_CORNER.y[0],
      0.02,
    );
    frame(trim, corner, c, offsetPoly(c, -0.015), -0.01, 0.006, -0.03);
    face(trim, corner, offsetPoly(c, -0.015), [], -0.03);
  }
  /**
   * Slim lamp unit wrapping the corner: a strip of the skin (x, y from the blueprint, z looked up
   * on the nose / tail panel and the side columns round the corner), lifted `lift` off it.
   */
  const skinLamp = (
    soup: Soup,
    end: 0 | 1,
    inner: readonly [number, number, number],
    outer: readonly [number, number, number],
    h: number,
    s: number,
    lift: number,
    pad = 0,
  ) => {
    const dir = end ? -1 : 1;
    const n = 8;
    const rows = [-h / 2 - pad, h / 2 + pad].map((dy) =>
      Array.from({ length: n + 1 }, (_, k) => {
        const t = -pad / 0.4 + (k / n) * (1 + (2 * pad) / 0.4);
        const x = lerp(inner[1], outer[1], t);
        const y = lerp(inner[2], outer[2], t) + dy;
        const z = skinZ(end, x, y) + dir * lift;
        return vtx(s * x, y, z, [x, y]);
      }),
    );
    soup.grid(rows, [s * 0.5, 0.3, dir]);
  };
  const lightSoup = new Soup();
  const tailSoup = new Soup();
  for (const s of [1, -1]) {
    skinLamp(
      trim,
      0,
      B.HEADLIGHT.inner,
      B.HEADLIGHT.outer,
      B.HEADLIGHT.h,
      s,
      0.008,
      0.012,
    );
    skinLamp(
      lightSoup,
      0,
      B.HEADLIGHT.inner,
      B.HEADLIGHT.outer,
      B.HEADLIGHT.h,
      s,
      0.014,
    );
    skinLamp(
      trim,
      1,
      B.TAIL_LAMP.inner,
      B.TAIL_LAMP.outer,
      B.TAIL_LAMP.h,
      s,
      0.008,
      0.012,
    );
    skinLamp(
      tailSoup,
      1,
      B.TAIL_LAMP.inner,
      B.TAIL_LAMP.outer,
      B.TAIL_LAMP.h,
      s,
      0.014,
    );
  }

  // --- tail: diffuser box, exhaust ---------------------------------------------------------------------
  trimParts.push(
    box(
      B.DIFFUSER.hw * 2,
      0.17,
      B.DIFFUSER.z[1] - B.DIFFUSER.z[0],
      0,
      B.DIFFUSER.y + 0.085,
      (B.DIFFUSER.z[0] + B.DIFFUSER.z[1]) / 2,
    ),
  );
  trimParts.push(cyl(0.035, 0.2, 12, 0, 0.3, B.DIFFUSER.z[0] - 0.02, 'z'));

  // --- cockpit: tub, bulkheads, dash, seats, wheel, roll cage ---------------------------------------------
  const TUB = 0.3;
  const tubZ = [0.75, 0.3, -0.2, -0.7, -1.1, -1.6];
  const wallX = (z: number) => B.halfWidth(z) - B.BELT_TUCK - 0.02;
  for (const s of [1, -1]) {
    cabin.grid(
      tubZ.map((z) => [vtx(0, TUB, z), vtx(s * wallX(z), TUB, z)]),
      [0, 1, 0],
    );
    cabin.grid(
      tubZ.map((z) => [
        vtx(s * wallX(z), TUB, z),
        vtx(s * wallX(z), B.belt(z) - 0.01, z),
      ]),
      [-s, 0, 0],
    );
  }
  cabin.quad(
    vtx(-wallX(0.75), TUB, 0.75),
    vtx(wallX(0.75), TUB, 0.75),
    vtx(wallX(0.75), 0.95, 0.75),
    vtx(-wallX(0.75), 0.95, 0.75),
    [0, 0, -1],
  );
  cabin.quad(
    vtx(-wallX(-1.6), TUB, -1.6),
    vtx(wallX(-1.6), TUB, -1.6),
    vtx(wallX(-1.6), 1.0, -1.6),
    vtx(-wallX(-1.6), 1.0, -1.6),
    [0, 0, 1],
  );
  cabinParts.push(rbox(1.4, 0.2, 0.4, 0.04, 0, 0.84, 0.5));
  cabinParts.push(rbox(0.3, 0.3, 0.9, 0.03, 0, 0.45, -0.1));
  for (const x of [0.35, -0.35])
    cabinParts.push(
      rbox(0.5, 0.14, 0.5, 0.04, x, 0.44, -0.3),
      rbox(0.5, 0.65, 0.14, 0.04, x, 0.78, -0.58, -0.18),
    );
  const wheel = new TorusGeometry(0.17, 0.014, 8, 28);
  wheel.rotateX(0.5);
  wheel.translate(0.35, 0.86, 0.1);
  cabinParts.push(wheel.toNonIndexed());
  wheel.dispose();
  cabinParts.push(box(0.03, 0.03, 0.3, 0.35, 0.8, 0.26, 0.5));
  /** Roll-cage tube from a to b. */
  const tube = (a: V3, b: V3) => {
    const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const len = Math.hypot(...d);
    const g = cyl(0.02, len, 8, 0, 0, 0, 'y');
    const yaw = Math.atan2(d[0], d[2]);
    const pitch = Math.acos(clamp(d[1] / len, -1, 1));
    g.rotateX(pitch);
    g.rotateY(yaw);
    g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    cageParts.push(g);
  };
  const cx = (z: number, y: number) => B.cabinX(z, y) - 0.05;
  for (const s of [1, -1]) {
    // Main hoop at the B pillar, A-pillar bar, rear stay, door bar.
    tube([s * cx(-0.45, 0.95), TUB, -0.45], [s * cx(-0.45, 1.28), 1.28, -0.45]);
    tube([s * cx(-0.45, 1.28), 1.28, -0.45], [s * cx(0.05, 1.28), 1.28, 0.05]);
    tube([s * cx(0.05, 1.28), 1.28, 0.05], [s * cx(0.6, 0.95), 0.92, 0.6]);
    tube([s * cx(-0.45, 1.28), 1.28, -0.45], [s * 0.5, 0.5, -1.55]);
    tube([s * cx(0.5, 0.9), 0.55, 0.5], [s * cx(-0.4, 0.9), 0.9, -0.4]);
  }
  tube([-cx(-0.45, 1.28), 1.28, -0.45], [cx(-0.45, 1.28), 1.28, -0.45]);
  tube([-cx(0.05, 1.28), 1.28, 0.05], [cx(0.05, 1.28), 1.28, 0.05]);

  const empty = emptyGeometry;
  return {
    paint: paint.geometry(35),
    parts: {
      plain: mergeAll([painted.geometry(30), ...paintParts]),
      carbon: mergeAll([carbon.geometry(40), ...carbonParts]),
      trim: mergeAll([trim.geometry(40), ...trimParts]),
      mesh: mergeAll([mesh.geometry(), ...meshParts]),
      glass: glass.geometry(),
      lights: mergeAll([...lightParts, lightSoup.geometry(30)]),
      tail: mergeAll([...tailParts, tailSoup.geometry(30)]),
      amber: empty(),
      interior: mergeAll([cabin.geometry(), ...cabinParts]),
      cage: mergeAll(cageParts),
      lining: lining.geometry(),
    },
  };
}

export { walls };
