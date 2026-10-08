import {
  CylinderGeometry,
  SphereGeometry,
  TorusGeometry,
  type BufferGeometry,
} from 'three';
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
import * as B from './blueprint';
import {
  bulb,
  dish,
  face,
  frame,
  plane,
  rrect,
  skinLens,
  slab,
  walls,
} from './lamps';
import { uvFront, uvRear, uvSide, uvTop } from './paint';

/**
 * Zastava 101 body, built from the blueprint dimensions in blueprint.ts.
 *
 * Painted shell (one mesh, UVs = paint.ts atlas):
 *  - body sides: columns of 16 points (sill / arch edge -> crease -> shoulder) at stations along
 *    the car, dense round the wheel arches (flared lips) and the nose / tail corners;
 *  - top: rows across the car from the bonnet lip to the tail lip (bonnet, windscreen, roof,
 *    rear screen, hatch) whose ends sit on the top of the sides / the pillar + roof-rail edges,
 *    with the two screens left open;
 *  - cabin sides (pillars, door frames): a polygon with the window openings, on the leaning
 *    side-glass plane;
 *  - nose and tail panels.
 * Then: wheel wells + floor, glass and rubbers, cabin, bumpers, lamps, grille, mirrors,
 * handles, wipers, gutters, exhaust.
 */

const TOP = 15;
const LOWER = [0, 0.05, 0.12, 0.22, 0.38, 0.58, 0.8, 1];
/** Rows round a wheel arch sit at these fractions of the lip width outside the opening. */
const LIP_D = [0, 0.4, 0.55, 0.78, 1];
const NOSE_D = [0, 0.006, 0.016, 0.03, 0.048, 0.07, 0.1, 0.13, 0.16];
/** Columns across the top surfaces (fraction of the half width); 0.955 / 0.83 = screen edges. */
const U_HALF = [0, 0.2, 0.4, 0.58, 0.72, 0.83, 0.9, 0.955, 1];
const U = [
  ...U_HALF.slice(1)
    .reverse()
    .map((u) => -u),
  ...U_HALF,
];
const SCREEN_F = [0, 0.06, 0.2, 0.35, 0.5, 0.65, 0.8, 0.94, 1];
const SCREEN_GLASS: P2 = [0.06, 0.94];
const SCREEN_U = 0.955;
const REAR_F = [0, 0.08, 0.25, 0.42, 0.6, 0.78, 0.92, 1];
const REAR_GLASS: P2 = [0.08, 0.92];
const REAR_U = 0.83;
const ROOF_Z = [
  0.11, 0.04, -0.05, -0.17, -0.3, -0.41, -0.52, -0.66, -0.8, -0.93, -1.03,
  -1.11, -1.18,
];
const roofBow = table([
  [-1.247, -0.045],
  [-0.9, -0.01],
  [-0.3, 0],
  [0, 0.008],
  [0.17, 0.02],
]);
const tailBow = table([
  [B.Z_TAIL, 0.012],
  [-1.665, 0.023],
]);

/** Stations (z of the column at the top edge) along the body side, nose -> tail. */
function stations(): number[] {
  const keys = [B.Z_TIP, B.Z_TAIL, B.A_PILLAR[0][0], B.Z_HATCH_BELT];
  const zs = [...keys, -1.9];
  for (const d of NOSE_D) zs.push(B.Z_TIP - d, B.Z_TAIL + d);
  for (const a of [B.ARCH_F, B.ARCH_R]) {
    for (const e of [...LIP_D.slice(1).map((k) => k * a.lipW), a.lipW + 0.03])
      zs.push(a.z + a.r + e, a.z - a.r - e);
    for (let i = 0; i <= 22; i++)
      zs.push(a.z + a.r * Math.cos((i / 22) * Math.PI));
  }
  for (let z = 0.42; z > -1.05; z -= 0.12) zs.push(z);
  zs.sort((a, b) => b - a);
  // Drop near-duplicates, never a key station.
  const out: number[] = [];
  for (const z of zs) {
    const prev = out[out.length - 1];
    if (prev === undefined || prev - z > 0.004) out.push(z);
    else if (keys.includes(z)) out[out.length - 1] = z;
  }
  return out;
}

/**
 * Heights of the 8 rows below the crease. Near a wheel arch the first rows follow circles
 * round the opening, so the flared lip has clean edges; elsewhere they are spread evenly.
 */
function lowerRows(z0: number, low: number, top: number): number[] {
  for (const a of [B.ARCH_F, B.ARCH_R]) {
    const dz = Math.abs(z0 - a.z);
    if (dz > a.r + a.lipW + 1e-6) continue;
    const ys = [low];
    for (const k of LIP_D.slice(1)) {
      const rr = a.r + k * a.lipW;
      const y =
        rr >= dz - 1e-9
          ? B.WHEEL_R + Math.sqrt(Math.max(0, rr * rr - dz * dz))
          : lerp(low, B.WHEEL_R, (k * a.lipW) / (dz - a.r));
      ys.push(Math.max(y, ys[ys.length - 1] + 1e-4));
    }
    const y4 = ys[4];
    return [...ys, ...[0.3, 0.62, 1].map((f) => lerp(y4, top, f))];
  }
  return LOWER.map((g) => lerp(low, top, g));
}

/** One column of the body side (left, x > 0): 16 points from the lower edge up to the shoulder. */
function sideColumn(z0: number): V3[] {
  const dF = B.Z_TIP - z0;
  const dT = z0 - B.Z_TAIL;
  // Near the ends the columns lean with the nose / tail panels.
  const wF = 1 - smoothstep(0.05, 0.16, dF);
  const wT = 1 - smoothstep(0.05, 0.2, dT);
  const top = B.shoulder(z0);
  const low = B.lowerEdge(z0);
  const yC = Math.min(B.crease(z0), top - 0.055);
  const hw = B.halfWidth(z0) - B.cornerF(dF) - B.cornerT(dT);
  const ys = top - 0.03;
  const pts: V3[] = [];
  const add = (x: number, y: number) =>
    pts.push([
      x + B.archLip(z0, y),
      y,
      z0 - B.noseSetback(y) * wF + B.tailSetback(y) * wT,
    ]);
  // Door skin: near vertical below the crease, tucking under towards the sill.
  for (const y of lowerRows(z0, low, yC - 0.01))
    add(hw - 0.045 * clamp((yC - y) / (yC - 0.255), 0, 1.1) ** 2.5, y);
  add(hw, yC);
  // Leaning facet above the crease, then the rounded shoulder.
  for (const h of [0, 0.3, 0.65, 1]) {
    const y = lerp(yC + 0.01, ys, h);
    add(hw - (0.02 * (y - yC)) / (ys - yC), y);
  }
  for (const a of [0.33, 0.66, 1]) {
    const t = (a * Math.PI) / 2;
    add(hw - 0.02 - 0.025 * (1 - Math.cos(t)), ys + 0.03 * Math.sin(t));
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
/** Half width of the body side at (z, y) below the shoulder (for parts mounted on it). */
const sideX = (z: number, y: number) => colAt(sideColumn(z), y)[0];

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
  const [a0, a1] = B.A_PILLAR;
  const [s0, s1] = B.SCREEN;
  const z = lerp(a0[0], a1[0], f);
  const y = lerp(a0[1], a1[1], f);
  return {
    e: [B.cabinX(z, y), y, z],
    c: [0, lerp(s0[1], s1[1], f), lerp(s0[0], s1[0], f)],
    pow: 2,
  };
}
function rearRow(f: number): TopRow {
  const [a0, a1] = B.C_EDGE;
  const [s0, s1] = B.REAR_SCREEN;
  const z = lerp(a0[0], a1[0], f);
  const y = lerp(a0[1], a1[1], f);
  return {
    e: [B.cabinX(z, y), y, z],
    c: [0, lerp(s0[1], s1[1], f), lerp(s0[0], s1[0], f)],
    pow: 2,
  };
}
function roofRow(z: number): TopRow {
  const y = B.rail(z);
  const zc = z + roofBow(z);
  return { e: [B.cabinX(z, y), y, z], c: [0, B.centre(zc), zc], pow: 2.4 };
}

/** Height of the bonnet surface at (x, z). */
function bonnetY(x: number, z: number): number {
  let ze = z;
  let u = 0;
  for (let i = 0; i < 4; i++) {
    u = clamp(Math.abs(x) / B.xTop(ze), 0, 1);
    ze = z - B.bonnetBow(ze) * (1 - u * u);
  }
  const ye = B.shoulder(ze);
  return ye + (B.centre(ze + B.bonnetBow(ze)) - ye) * (1 - u ** 2.2);
}

const addV = (p: V3, d: V3, k: number): V3 => [
  p[0] + d[0] * k,
  p[1] + d[1] * k,
  p[2] + d[2] * k,
];

export function buildZastavaBody(): {
  paint: BufferGeometry;
  parts: CarPartGeometry;
} {
  const paint = new Soup();
  const trim = new Soup();
  const glass = new Soup();
  const lining = new Soup();
  const cabin = new Soup();
  const mesh = new Soup();
  const trimParts: BufferGeometry[] = [];
  const glassParts: BufferGeometry[] = [];
  const lightParts: BufferGeometry[] = [];
  const chromeParts: BufferGeometry[] = [];
  const meshParts: BufferGeometry[] = [];
  const painted = new Soup();
  const chrome = new Soup();
  const lens = new Soup();
  const amberSoup = new Soup();
  const lightSoup = new Soup();
  const cabinParts: BufferGeometry[] = [];
  const bright: BufferGeometry[] = [];
  const lights: BufferGeometry[] = [];
  const tail: BufferGeometry[] = [];
  const amber: BufferGeometry[] = [];

  const zs = stations();
  const cols = zs.map(sideColumn);
  const iA = zs.indexOf(B.A_PILLAR[0][0]);
  const iH = zs.indexOf(B.Z_HATCH_BELT);
  const last = cols.length - 1;

  // --- body sides + wheel wells / floor -------------------------------------------------------
  for (const s of [1, -1]) {
    paint.grid(
      cols.map((col) =>
        col.map(([x, y, z]) => vtx(s * x, y, z, uvSide(s, z, y))),
      ),
      [s, 0.2, 0],
    );
    // Wheel-well roof + inner wall, then the floor to the centreline.
    trim.grid(
      cols.map((col) => {
        const [x, y, z] = col[0];
        // Front wells reach far in (engine bay) so the steered wheels clear the inner wall.
        const deep = 0.53 - 0.17 * smoothstep(0.5, 0.62, z);
        const xin = Math.min(deep, x - 0.03);
        return [
          vtx(s * x, y, z),
          vtx(s * xin, y, z),
          vtx(s * xin, 0.24, z),
          vtx(0, 0.24, z),
        ];
      }),
    );
  }

  // --- top surfaces ---------------------------------------------------------------------------------
  const rows: TopRow[] = [];
  for (let i = 0; i < iA; i++) {
    const zc = zs[i] + B.bonnetBow(zs[i]);
    rows.push({ e: cols[i][TOP], c: [0, B.centre(zc), zc], pow: 2.2 });
  }
  const iScreen = rows.length;
  for (const f of SCREEN_F) rows.push(screenRow(f));
  for (const z of ROOF_Z) rows.push(roofRow(z));
  const iRear = rows.length;
  for (const f of REAR_F) rows.push(rearRow(f));
  const iHatch = rows.length;
  const hatchRow = (e: V3): TopRow => {
    const zc = e[2] - tailBow(e[2]);
    return { e, c: [0, B.centre(zc), zc], pow: 2.2 };
  };
  rows.push(
    hatchRow([B.cabinX(-1.71, B.hatchEdge(-1.71)), B.hatchEdge(-1.71), -1.71]),
  );
  for (let i = iH; i <= last; i++) rows.push(hatchRow(cols[i][TOP]));
  // The tail lip is straight across.
  rows[rows.length - 1].c[1] = rows[rows.length - 1].e[1];
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
    rows.slice(iScreen, iHatch + 2).map((r) =>
      U.map((u) => {
        const [x, y, z] = topPoint(r, u * 0.985);
        return vtx(x, y - 0.018, z);
      }),
    ),
    [0, 1, 0],
    (i, j) => isOpen(i + iScreen, j),
  );

  // --- nose + tail panels ----------------------------------------------------------------------------
  // Nose panel with the grille opening cut out (rows also at the opening's top / bottom).
  const noseZ = (y: number) => B.Z_TIP - B.noseSetback(y);
  const noseYs = [...cols[0].map((p) => p[1]), B.GRILLE_Y0, B.GRILLE_Y1]
    .sort((a, b) => a - b)
    .filter((y, i, a) => i === 0 || y - a[i - 1] > 1e-4);
  paint.grid(
    noseYs.map((y) => {
      const [xe, , ze] = colAt(cols[0], y);
      return [
        vtx(-xe, y, ze, uvFront(-xe, y)),
        ...[-B.GRILLE_X, -0.3, 0, 0.3, B.GRILLE_X].map((x) =>
          vtx(x, y, noseZ(y), uvFront(x, y)),
        ),
        vtx(xe, y, ze, uvFront(xe, y)),
      ];
    }),
    [0, 0, 1],
    (i, j) =>
      j >= 1 &&
      j <= 4 &&
      noseYs[i] >= B.GRILLE_Y0 - 1e-6 &&
      noseYs[i + 1] <= B.GRILLE_Y1 + 1e-6,
  );
  const capU = [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1];
  paint.grid(
    cols[last].map(([x, y, z]) =>
      capU.map((u) => vtx(x * u, y, z - 0.012 * (1 - u * u), uvRear(x * u, y))),
    ),
    [0, 0, -1],
  );

  // --- cabin sides: pillars + door frames round the window openings -----------------------------------
  const edge = (r: TopRow): P2 => [r.e[2], r.e[1]];
  const outline: P2[] = [
    // Beltline, A pillar base -> where the hatch edge reaches it.
    ...cols.slice(iA, iH + 1).map((c): P2 => [c[TOP][2], c[TOP][1]]),
    // Up the hatch / rear-screen edge, forward along the roof rail, down the A pillar.
    ...rows
      .slice(iScreen + 1, iHatch + 1)
      .reverse()
      .map(edge),
  ];
  const windows = [B.WINDOW_F, B.WINDOW_R].map((w) => roundedPoly(w, 0.035, 5));
  for (const s of [1, -1]) {
    const on = (dx: number) => (z: number, y: number) =>
      vtx(s * (B.cabinX(z, y) + dx), y, z, uvSide(s, z, y));
    paint.polygon(outline, windows, on(0), [s, 0, 0]);
    lining.polygon(outline, windows, on(-0.02), [s, 0, 0]);
    for (const w of windows) {
      glass.polygon(offsetPoly(w, 0.004), [], on(-0.003), [s, 0, 0]);
      // Rubber round the glass.
      trim.polygon(offsetPoly(w, 0.014), [offsetPoly(w, -0.012)], on(0.0025), [
        s,
        0,
        0,
      ]);
    }
  }

  // --- windscreen + rear screen: glass and rubbers ------------------------------------------------------
  const screens: {
    row: (f: number) => TopRow;
    fs: number[];
    f: P2;
    u: number;
    out: V3;
  }[] = [
    {
      row: screenRow,
      fs: SCREEN_F,
      f: SCREEN_GLASS,
      u: SCREEN_U,
      out: [0, 0.71, 0.7],
    },
    {
      row: rearRow,
      fs: REAR_F,
      f: REAR_GLASS,
      u: REAR_U,
      out: [0, 0.75, -0.66],
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

  // --- gutters along the pillars + roof rail -----------------------------------------------------------
  const railPath = [
    ...[0.3, 0.5, 0.75].map((f) => screenRow(f).e),
    ...rows.slice(iScreen + SCREEN_F.length - 1, iRear + 1).map((r) => r.e),
    ...[0.3, 0.6].map((f) => rearRow(f).e),
  ];
  for (const s of [1, -1])
    trim.sweep(
      railPath.map(([x, y, z]): V3 => [s * x, y, z]),
      () => ({ n: [s, 0, 0], up: [0, 1, 0] }),
      [
        [0.001, -0.006],
        [0.013, -0.006],
        [0.013, 0.006],
        [0.001, 0.006],
      ],
    );

  // --- cabin: tub, dash, seats ---------------------------------------------------------------------------
  const FLOOR = 0.36;
  // Floor + side walls; behind z = -1.13 the walls step in round the rear wheel housings.
  const tubZ = [0.58, 0.3, 0, -0.4, -0.8, -1.12, -1.13, -1.5, -1.72];
  const wallX = (z: number) => B.xTop(z) - 0.004;
  // Floor (carpet), then the side walls: painted metal in the footwells ahead of the doors
  // (ref-16), dark door cards / trim behind them.
  const FOOT = 0.36; // z where the footwell kick panels end and the front door begins
  for (const s of [1, -1]) {
    cabin.grid(
      tubZ.map((z) => {
        const xin = z < -1.125 ? 0.51 : wallX(z);
        return [vtx(0, FLOOR, z), vtx(s * xin, FLOOR, z)];
      }),
      [0, 1, 0],
    );
    const sideRow = (z: number) => {
      const x = wallX(z);
      const xin = z < -1.125 ? 0.51 : x;
      return [
        vtx(s * xin, FLOOR, z),
        vtx(s * xin, 0.64, z),
        vtx(s * x, 0.64, z),
        vtx(s * x, B.belt(z), z),
      ];
    };
    painted.grid([0.58, FOOT].map(sideRow), [-s, 0, 0]);
    cabin.grid([FOOT, ...tubZ.slice(1)].map(sideRow), [-s, 0, 0]);
  }
  // Firewall (painted) behind the dash, rear bulkhead (trim).
  painted.quad(
    vtx(-wallX(0.58), FLOOR, 0.58),
    vtx(wallX(0.58), FLOOR, 0.58),
    vtx(wallX(0.58), 0.9, 0.58),
    vtx(-wallX(0.58), 0.9, 0.58),
    [0, 0, -1],
  );
  cabin.quad(
    vtx(-wallX(-1.72), FLOOR, -1.72),
    vtx(wallX(-1.72), FLOOR, -1.72),
    vtx(wallX(-1.72), 0.9, -1.72),
    vtx(-wallX(-1.72), 0.9, -1.72),
    [0, 0, 1],
  );
  // Parcel shelf under the rear screen.
  cabin.quad(
    vtx(-0.66, 0.89, -1.3),
    vtx(0.66, 0.89, -1.3),
    vtx(0.66, 0.89, -1.72),
    vtx(-0.66, 0.89, -1.72),
    [0, 1, 0],
  );
  // Dash (ref-15 / ref-16): padded dash with a rolled top edge, recessed instrument panel with four
  // round gauges under a visor in front of the driver (left-hand drive, +x), two dome vents on top,
  // centre stack (switches, heater knobs + radio) down to the tunnel, open parcel shelf on the
  // passenger side, pedals.
  const DASH_Z = 0.3; // rear face of the dash
  cabinParts.push(rbox(1.38, 0.17, 0.28, 0.05, 0, 0.815, 0.44));
  const roll = cyl(0.034, 1.36, 14, 0, 0.872, DASH_Z + 0.012, 'x');
  cabinParts.push(roll);
  for (const x of [0.02, -0.19]) {
    const dome = new SphereGeometry(
      0.062,
      16,
      6,
      0,
      Math.PI * 2,
      0,
      Math.PI / 2,
    );
    dome.scale(1, 0.42, 1);
    dome.translate(x, 0.898, 0.43);
    cabinParts.push(dome.toNonIndexed());
    dome.dispose();
    const slot = new TorusGeometry(0.038, 0.004, 4, 18);
    slot.rotateX(Math.PI / 2);
    slot.translate(x, 0.918, 0.43);
    trimParts.push(slot.toNonIndexed());
    slot.dispose();
  }
  // Instrument panel: raised bezel round a recessed face, visor over it, four gauges.
  const ip = plane([0.33, 0.8, DASH_Z], [1, 0, 0], [0, 1, 0], [0, 0, -1]);
  frame(
    cabin,
    ip,
    rrect(0, 0, 0.44, 0.15, 0.035),
    rrect(0, 0, 0.41, 0.12, 0.028),
    0,
    0.03,
    0.004,
  );
  face(cabin, ip, rrect(0, 0, 0.41, 0.12, 0.028), [], 0.004);
  slab(cabin, ip, -0.23, 0.23, 0.06, 0.085, 0, 0.075);
  for (const [a, r] of [
    [-0.15, 0.033],
    [-0.055, 0.045],
    [0.055, 0.045],
    [0.15, 0.033],
  ]) {
    const [x, y, z] = [0.33 + a, 0.8, DASH_Z - 0.006];
    trimParts.push(cyl(r, 0.004, 20, x, y, z, 'z'));
    const bezel = new TorusGeometry(r + 0.003, 0.004, 4, 16);
    bezel.translate(x, y, z - 0.003);
    chromeParts.push(bezel.toNonIndexed());
    bezel.dispose();
    const scale = new TorusGeometry(r * 0.8, 0.0012, 3, 16);
    scale.translate(x, y, z - 0.0025);
    lightParts.push(scale.toNonIndexed());
    scale.dispose();
    lightParts.push(
      box(
        0.003,
        r * 0.75,
        0.002,
        x,
        y + r * 0.3,
        z - 0.004,
        0,
        0,
        a > 0 ? 0.8 : -0.5,
      ),
    );
  }
  // Centre stack: switch panel, then a sloping console with heater knobs + radio down to the tunnel.
  cabinParts.push(rbox(0.3, 0.13, 0.07, 0.012, -0.02, 0.665, DASH_Z + 0.02));
  for (let i = 0; i < 4; i++)
    trimParts.push(
      rbox(0.026, 0.036, 0.012, 0.006, -0.11 + i * 0.045, 0.69, DASH_Z - 0.018),
    );
  trimParts.push(box(0.12, 0.03, 0.01, -0.03, 0.635, DASH_Z - 0.016));
  const LEAN = 0.5;
  const consoleZ = (y: number) =>
    0.255 + (y - 0.505) * Math.tan(LEAN) - 0.025 / Math.cos(LEAN);
  cabinParts.push(box(0.25, 0.25, 0.05, -0.02, 0.505, 0.255, LEAN));
  for (let i = 0; i < 4; i++) {
    const x = -0.1 + i * 0.054;
    trimParts.push(
      cyl(0.014, 0.018, 12, x, 0.575, consoleZ(0.575) - 0.008, 'z'),
    );
  }
  // Radio: dark face, tuning window, two knobs.
  trimParts.push(
    box(0.18, 0.05, 0.012, -0.02, 0.5, consoleZ(0.5) - 0.004, LEAN),
  );
  bright.push(
    box(0.07, 0.012, 0.006, -0.02, 0.505, consoleZ(0.505) - 0.011, LEAN),
  );
  for (const x of [-0.085, 0.045])
    trimParts.push(cyl(0.011, 0.016, 10, x, 0.5, consoleZ(0.5) - 0.014, 'z'));
  // Tunnel, gear lever with its rubber boot.
  cabinParts.push(rbox(0.24, 0.1, 0.72, 0.03, -0.02, 0.4, -0.12));
  const boot = new CylinderGeometry(0.018, 0.05, 0.06, 12);
  boot.translate(-0.02, 0.475, 0.1);
  trimParts.push(boot.toNonIndexed());
  boot.dispose();
  trimParts.push(box(0.012, 0.24, 0.012, -0.02, 0.6, 0.085, -0.25));
  const knob = new SphereGeometry(0.026, 12, 8);
  knob.translate(-0.02, 0.718, 0.055);
  trimParts.push(knob.toNonIndexed());
  knob.dispose();
  // Open parcel shelf under the dash on the passenger side, with a vent grille on its lip.
  cabinParts.push(
    box(0.46, 0.012, 0.2, -0.43, 0.67, DASH_Z + 0.1),
    rbox(0.46, 0.04, 0.016, 0.006, -0.43, 0.665, DASH_Z - 0.002),
  );
  meshParts.push(box(0.22, 0.014, 0.004, -0.36, 0.67, DASH_Z - 0.011));
  // Pedals: clutch, brake (pads on arms from under the dash), accelerator.
  for (const x of [0.43, 0.32]) {
    trimParts.push(
      box(0.07, 0.055, 0.014, x, 0.5, 0.43, -0.45),
      box(0.012, 0.22, 0.012, x, 0.62, 0.47, 0.35),
    );
  }
  trimParts.push(box(0.05, 0.1, 0.012, 0.2, 0.46, 0.45, -0.7));

  // Steering wheel + column. The wheel sits square to the column: both lean the same way
  // (column runs forward and down into the dash, the rim's top leans towards the windscreen).
  const COLUMN = 0.45;
  const wheelAt = (g: BufferGeometry) => {
    g.rotateX(COLUMN);
    g.translate(0.34, 0.9, 0.2);
    return g;
  };
  trimParts.push(box(0.04, 0.04, 0.3, 0.34, 0.84, 0.32, COLUMN));
  // Indicator + wiper stalks.
  for (const sx of [1, -1])
    trimParts.push(
      wheelAt(
        box(0.11, 0.009, 0.009, sx * 0.075, -0.015, 0.075, 0, 0, sx * -0.12),
      ),
    );
  const rim = new TorusGeometry(0.19, 0.011, 8, 32);
  trimParts.push(wheelAt(rim).toNonIndexed());
  rim.dispose();
  // Two spokes dipping slightly below the centre, chrome horn bar + boss.
  for (const sx of [1, -1])
    trimParts.push(
      wheelAt(box(0.16, 0.016, 0.012, sx * 0.1, -0.02, 0.012, 0, 0, sx * 0.22)),
    );
  chromeParts.push(
    wheelAt(rbox(0.17, 0.034, 0.02, 0.012, 0, -0.008, 0.024)),
    wheelAt(cyl(0.028, 0.03, 14, 0, 0, 0.012, 'z')),
  );
  for (const x of [0.34, -0.34])
    cabinParts.push(
      rbox(0.48, 0.14, 0.5, 0.05, x, 0.5, -0.16),
      rbox(0.46, 0.56, 0.12, 0.05, x, 0.8, -0.44, -0.2),
      rbox(0.24, 0.15, 0.09, 0.035, x, 1.16, -0.515, -0.2),
    );
  cabinParts.push(
    rbox(1.26, 0.14, 0.46, 0.05, 0, 0.52, -1.0),
    rbox(1.26, 0.5, 0.12, 0.05, 0, 0.78, -1.27, -0.24),
  );

  // --- nose: grille, headlamps, indicators (ref-09 / ref-13) -----------------------------------------
  const cl = Math.cos(B.NOSE_LEAN);
  const sl = Math.sin(B.NOSE_LEAN);
  // Grille plane: the leaning nose face (linear above y = 0.5); b = metres up the face from y = 0.6.
  const nose = plane(
    [0, 0.6, noseZ(0.6)],
    [1, 0, 0],
    [0, cl, sl],
    [0, -sl, cl],
  );
  const nb = (y: number) => (y - 0.6) / cl;
  const gB0 = nb(B.GRILLE_Y0);
  const gB1 = nb(B.GRILLE_Y1);
  const gC = (gB0 + gB1) / 2;
  const gH = gB1 - gB0;
  const opening = rrect(0, gC, 2 * B.GRILLE_X, gH, 0);
  // Body-coloured lip round the opening, then the black surround and the back of the grille.
  walls(
    paint,
    { ...nose, uv: ([x, y]) => uvFront(x, y) },
    opening,
    -0.012,
    0,
    true,
  );
  const surround = rrect(0, gC, 2 * B.GRILLE_X - 0.032, gH - 0.032, 0.014);
  face(trim, nose, opening, [surround], -0.009);
  walls(trim, nose, surround, -0.009, -0.046, true);
  face(trim, nose, surround, [], -0.046);
  // Slats in front of fine vertical bars, between the headlamps.
  const LAMP_A = 0.47;
  const gIn = LAMP_A - 0.093 - 0.01;
  const sb0 = gC - (gH - 0.032) / 2;
  const sb1 = gC + (gH - 0.032) / 2;
  for (let k = 1; k < 8; k++) {
    const b = lerp(sb0, sb1, k / 8);
    slab(trim, nose, -gIn, gIn, b - 0.0035, b + 0.0035, -0.042, -0.013);
  }
  for (let a = -0.34; a <= 0.3401; a += 0.04)
    slab(trim, nose, a - 0.0025, a + 0.0025, sb0, sb1, -0.045, -0.022);
  // Blank badge on the top slat.
  frame(
    chrome,
    nose,
    rrect(0, sb1 - 0.018, 0.124, 0.028, 0.005),
    rrect(0, sb1 - 0.018, 0.11, 0.016, 0.003),
    -0.016,
    -0.008,
    -0.012,
  );
  face(trim, nose, rrect(0, sb1 - 0.018, 0.11, 0.016, 0.003), [], -0.011);
  for (const s of [1, -1]) {
    // Headlamp: chrome bezel, concave chrome reflector + bulb, fluted clear lens.
    const ca = s * LAMP_A;
    // Black lamp body back to the grille back plate, chrome bezel face + inner lip.
    const bezel = rrect(ca, gC, 0.186, 0.166, 0.026);
    const bezelIn = rrect(ca, gC, 0.162, 0.142, 0.02);
    walls(trim, nose, bezel, -0.046, -0.007);
    walls(chrome, nose, bezel, -0.007, -0.005);
    face(chrome, nose, bezel, [bezelIn], -0.005);
    walls(chrome, nose, bezelIn, -0.005, -0.014, true);
    dish(chrome, nose, ca, gC, 0.162, 0.142, 0.02, -0.014, 0.028);
    lightParts.push(bulb(nose, ca, gC, -0.03, 0.013));
    slab(
      lens,
      nose,
      ca - 0.081,
      ca + 0.081,
      gC - 0.071,
      gC + 0.071,
      -0.012,
      -0.008,
      {
        along: 'b',
        pitch: 0.008,
        amp: 0.0018,
      },
    );
    // Indicator / side light in the bumper: black housing, chrome rim, amber outboard, clear inboard.
    const fb = plane([0, 0.455, B.BUMPER_F], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
    const ia = s * LAMP_A;
    slab(trim, fb, ia - 0.072, ia + 0.072, -0.034, 0.022, -0.004, 0.006);
    frame(
      chrome,
      fb,
      rrect(ia, 0.002, 0.13, 0.042, 0.006),
      rrect(ia, 0.002, 0.118, 0.03, 0.004),
      0.004,
      0.0095,
      0.003,
    );
    const [o0, o1] =
      s > 0 ? [ia + 0.001, ia + 0.059] : [ia - 0.059, ia - 0.001];
    const [i0, i1] =
      s > 0 ? [ia - 0.059, ia - 0.001] : [ia + 0.001, ia + 0.059];
    const ribs = { along: 'b' as const, pitch: 0.007, amp: 0.0008 };
    slab(amberSoup, fb, o0, o1, -0.013, 0.017, 0.002, 0.0075, ribs);
    slab(lightSoup, fb, i0, i1, -0.013, 0.017, 0.001, 0.003);
    slab(lens, fb, i0, i1, -0.013, 0.017, 0.003, 0.0075, ribs);
    // Repeater on the wing, ahead of the arch.
    const zr = 1.39;
    const sr = plane(
      [s * sideX(zr, 0.625), 0.625, zr],
      [0, 0, 1],
      [0, 1, 0],
      [s, 0, 0],
    );
    frame(
      trim,
      sr,
      rrect(0, 0, 0.082, 0.03, 0.012),
      rrect(0, 0, 0.07, 0.02, 0.008),
      -0.003,
      0.004,
      -0.002,
    );
    slab(amberSoup, sr, -0.034, 0.034, -0.009, 0.009, -0.002, 0.0055, ribs);
  }
  /** Bumper bar wrapped round the corners: `zFace` = outer face, sides back / forward to `zEnd`. */
  const bumper = (
    zFace: number,
    zEnd: number,
    y: number,
    hw: number,
    h: number,
  ) => {
    const dir = Math.sign(zFace);
    const r = 0.09;
    const zc = zFace - dir * (0.035 + r);
    const path: V3[] = [[hw, y, zEnd]];
    for (let i = 0; i <= 6; i++) {
      const a = (i / 6) * (Math.PI / 2);
      path.push([hw - r + r * Math.cos(a), y, zc + dir * r * Math.sin(a)]);
    }
    const full = [
      ...path,
      ...path.map(([x, py, z]): V3 => [-x, py, z]).reverse(),
    ];
    trim.sweep(
      full,
      (i) => {
        const a = full[Math.max(0, i - 1)];
        const b = full[Math.min(full.length - 1, i + 1)];
        const tx = b[0] - a[0];
        const tz = b[2] - a[2];
        const l = Math.hypot(tx, tz) || 1;
        return { n: [(dir * tz) / l, 0, (-dir * tx) / l], up: [0, 1, 0] };
      },
      [
        [-0.035, -h / 2],
        [0.022, -h / 2],
        [0.035, -h / 2 + 0.02],
        [0.035, h / 2 - 0.02],
        [0.022, h / 2],
        [-0.035, h / 2],
      ],
    );
  };
  bumper(B.BUMPER_F, 1.335, 0.435, 0.705, 0.13);
  bumper(B.BUMPER_R, -1.93, 0.4, 0.69, 0.125);

  // --- bonnet: vents, wipers -----------------------------------------------------------------------------
  for (const s of [1, -1]) {
    const patch = (soup: Soup, pad: number, lift: number) =>
      soup.grid(
        [0.84 + pad, 0.78, 0.72 - pad].map((z) =>
          [0.14 - pad, 0.265, 0.39 + pad].map((x) =>
            vtx(s * x, bonnetY(x, z) + lift, z, [x, z]),
          ),
        ),
        [0, 1, 0],
      );
    patch(trim, 0.01, 0.002);
    patch(mesh, 0, 0.004);
  }
  /** Thin bar from a to b lying on a surface with normal n. */
  const bar = (a: V3, b: V3, w: number, n: V3) => {
    const d = addV(b, a, -1);
    const side: V3 = [
      d[1] * n[2] - d[2] * n[1],
      d[2] * n[0] - d[0] * n[2],
      d[0] * n[1] - d[1] * n[0],
    ];
    const l = Math.hypot(...side) || 1;
    const up: V3 = [side[0] / l, side[1] / l, side[2] / l];
    trim.sweep([a, b], () => ({ n, up }), [
      [0, -w],
      [w * 1.6, -w],
      [w * 1.6, w],
      [0, w],
    ]);
  };
  const onScreen = (u: number, f: number) =>
    addV(topPoint(screenRow(f), u), [0, 0.71, 0.7], 0.008);
  for (const [pivot, tip] of [
    [0.52, -0.08],
    [-0.12, -0.72],
  ]) {
    const mid = (pivot + tip) / 2;
    bar(onScreen(pivot, 0.015), onScreen(mid, 0.12), 0.006, [0, 0.71, 0.7]);
    bar(
      onScreen(pivot - 0.04, 0.1),
      onScreen(tip, 0.14),
      0.008,
      [0, 0.71, 0.7],
    );
  }

  // --- sides: mirrors, handles, vent, filler ---------------------------------------------------------------
  for (const s of [1, -1]) {
    const mx = B.cabinX(0.37, 0.95);
    trimParts.push(
      rbox(0.14, 0.095, 0.05, 0.02, s * (mx + 0.115), 0.955, 0.375),
      box(0.08, 0.02, 0.03, s * (mx + 0.03), 0.925, 0.385),
    );
    for (const [z, y] of [
      [-0.33, 0.815],
      [-1.168, 0.805],
    ])
      trimParts.push(
        rbox(0.02, 0.036, 0.13, 0.008, s * (sideX(z, y) + 0.006), y, z),
      );
    // Cabin air outlet on the C pillar.
    bright.push(
      cyl(
        0.028,
        0.008,
        14,
        s * (B.cabinX(-1.508, 0.915) + 0.003),
        0.915,
        -1.508,
        'x',
      ),
    );
  }

  // --- tail: lamps, plate, handle, exhaust ------------------------------------------------------------------
  // The lamp clusters follow the body skin round the tail corners.
  const corner = [4, 3, 2, 1, 0].map((k) => {
    const i = last - k;
    const a = colAt(cols[i - 1], 0.6);
    const b = colAt(cols[Math.min(last, i + 1)], 0.6);
    const l = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1;
    // Outward normal in plan; the last column sits on the flat tail panel.
    const n: P2 = k === 0 ? [0, -1] : [-(b[2] - a[2]) / l, (b[0] - a[0]) / l];
    return (y: number, lift: number): V3 => {
      const [x, , z] = colAt(cols[i], y);
      return [x + n[0] * lift, y, z + n[1] * lift];
    };
  });
  const onTail =
    (x: number) =>
    (y: number, lift: number): V3 => {
      const [xe, , ze] = colAt(cols[last], y);
      const xx = Math.min(x, xe);
      return [xx, y, ze - 0.012 * (1 - (xx / xe) ** 2) - lift];
    };
  // Tail clusters = a reflector with fine optic cells seen through a glossy tinted lens, so they
  // read as translucent plastic with depth rather than painted blocks.
  const redRefl = new Soup();
  const redLens = new Soup();
  const amberRefl = new Soup();
  const amberLens = new Soup();
  // Rounded outer end of the clusters (ref-11 / ref-12): the outermost columns are shorter.
  const taper = [0.03, 0.013, 0.004, 0, 0, 0, 0];
  const rb = plane(
    [0, 0.425, B.BUMPER_R],
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, -1],
    ([x, y]) => [x, y],
  );
  /** One lens segment: reflector on the skin, then the clear tinted lens 11 mm in front of it. */
  const lamp = (
    refl: Soup,
    glass: Soup,
    s: number,
    at: ((y: number, lift: number) => V3)[],
    y0: number[],
    y1: number[],
  ) => {
    skinLens(refl, s, at, y0, y1, 0.0026, 0.0045, 2, 0);
    skinLens(glass, s, at, y0, y1, 0.0045, 0.0155, 2, 0);
  };
  for (const s of [1, -1]) {
    const cluster = [...corner, onTail(0.57), onTail(0.522)];
    // Black gasket hugging the lenses, rounded at the outer end like them.
    const gasket = [...cluster, onTail(0.425)];
    const gt = [...taper, 0];
    skinLens(
      trim,
      s,
      gasket,
      gt.map((t) => 0.524 + t * 0.85),
      gt.map((t) => 0.706 - t * 0.85),
      0.0012,
      0.0026,
      1,
      0,
    );
    const low = taper.map((t) => 0.535 + t);
    const high = taper.map((t) => 0.695 - t);
    lamp(
      redRefl,
      redLens,
      s,
      cluster,
      low,
      cluster.map(() => 0.611),
    );
    lamp(
      redRefl,
      redLens,
      s,
      cluster,
      cluster.map(() => 0.619),
      high,
    );
    lamp(
      amberRefl,
      amberLens,
      s,
      [onTail(0.516), onTail(0.436)],
      [0.535, 0.535],
      [0.695, 0.695],
    );
    // Reflector set into the bumper with its black housing (ref-10).
    const ca = s * 0.52;
    slab(trim, rb, ca - 0.06, ca + 0.06, -0.03, 0.016, -0.004, 0.005);
    frame(
      trim,
      rb,
      rrect(ca, 0, 0.104, 0.03, 0.004),
      rrect(ca, 0, 0.094, 0.022, 0.003),
      0.004,
      0.0085,
      0.003,
    );
    slab(amberRefl, rb, ca - 0.047, ca + 0.047, -0.011, 0.011, 0.002, 0.0045);
    slab(amberLens, rb, ca - 0.047, ca + 0.047, -0.011, 0.011, 0.0045, 0.008);
  }
  amber.push(amberSoup.geometry(30));
  const zp = onTail(0)(0.6, 0)[2];
  trimParts.push(box(0.5, 0.135, 0.01, 0, 0.6, zp - 0.003));
  bright.push(box(0.46, 0.105, 0.01, 0, 0.6, zp - 0.008));
  trimParts.push(rbox(0.15, 0.024, 0.02, 0.008, 0, 0.722, zp - 0.006));
  trimParts.push(cyl(0.024, 0.2, 10, 0.42, 0.262, -2.13, 'z'));

  const empty = emptyGeometry;
  return {
    paint: paint.geometry(35),
    parts: {
      plain: painted.geometry(30),
      carbon: empty(),
      trim: mergeAll([trim.geometry(40), ...trimParts]),
      mesh: mergeAll([mesh.geometry(), ...meshParts]),
      glass: mergeAll([glass.geometry(), ...glassParts]),
      lights: mergeAll([...lights, ...lightParts, lightSoup.geometry(30)]),
      tail: mergeAll(tail),
      amber: mergeAll(amber),
      interior: mergeAll([cabin.geometry(), ...cabinParts]),
      cage: mergeAll(bright),
      lining: lining.geometry(),
      chrome: mergeAll([chrome.geometry(30), ...chromeParts]),
      lens: lens.geometry(30),
      redReflector: redRefl.geometry(20),
      redLens: redLens.geometry(30),
      amberReflector: amberRefl.geometry(20),
      amberLens: amberLens.geometry(30),
    },
  };
}
