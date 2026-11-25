import { convexHull, inPolygon, polygonDistance } from './alignment';

/**
 * Junction geometry of the v2 road engine (the Cities: Skylines idea: the node owns the intersection, the ways are cut
 * back to it). An arm is a way leaving a node; the facing kerb lines of neighbouring arms meet at a corner, rounded by
 * a kerb return; each arm stops where its corners need it to (its `cut`); the polygon through the arm ends and the kerb
 * returns is the one paved surface of the junction. Divided roads crossing give several nodes a few metres apart: those
 * are merged into one cluster whose polygon is the hull of its arms' ends. Pure.
 */

export interface ArmGeo {
  /** Node position the arm leaves from. */
  ox: number;
  oz: number;
  /** Unit direction away from the node and its left normal (left = (dz, -dx)). */
  dx: number;
  dz: number;
  /** Pavement half widths left / right of the arm direction (m, to the kerb face). */
  hwL: number;
  hwR: number;
  /** Width of the paved side strip (kerb + lawn + sidewalk) beyond the kerb face, left / right (0 = none). */
  swL: number;
  swR: number;
  /** Kerb return radius at this arm's corners (m). */
  radius: number;
  /** Longest cut allowed (m). */
  maxCut: number;
  /** Result: distance from the node where the arm's own surface stops. */
  cut: number;
}

export interface CornerGeo {
  /** Sidewalk corner outline (flat x, z): the first `kerbN` points are the kerb line (junction side). */
  poly: number[];
  kerbN: number;
  /** The two arms (indices into the junction's arm list) it joins. */
  a: number;
  b: number;
}

const leftX = (a: ArmGeo) => a.dz;
const leftZ = (a: ArmGeo) => -a.dx;

/** Math angle of an arm (ccw, north up): x east, z south. */
export function armAngle(a: { dx: number; dz: number }): number {
  return Math.atan2(-a.dz, a.dx);
}

/** Intersection of p + d t and q + e u: [t, u] or undefined when (nearly) parallel. */
function intersect(
  px: number,
  pz: number,
  dx: number,
  dz: number,
  qx: number,
  qz: number,
  ex: number,
  ez: number,
): [number, number] | undefined {
  const det = dx * -ez - dz * -ex;
  if (Math.abs(det) < 1e-6) return undefined;
  const rx = qx - px;
  const rz = qz - pz;
  const t = (rx * -ez - rz * -ex) / det;
  const u = (dx * rz - dz * rx) / det;
  return [t, u];
}

/** A point on an arm's left (+1) / right (-1) kerb line `c` m from its node. */
function edgePt(
  a: ArmGeo,
  side: 1 | -1,
  c: number,
  extra = 0,
): [number, number] {
  const hw = (side > 0 ? a.hwL : a.hwR) + extra;
  return [
    a.ox + a.dx * c + side * leftX(a) * hw,
    a.oz + a.dz * c + side * leftZ(a) * hw,
  ];
}

interface Gap {
  /** ccw gap between arm i and the next arm j (rad). */
  gap: number;
  /** Kerb corner on arm i's left / arm j's right line: distances along each arm, or undefined. */
  t?: number;
  u?: number;
  /** Fillet tangent length. */
  tl: number;
  kind: 'inner' | 'straight' | 'outer' | 'merge';
}

function gapsOf(arms: ArmGeo[]): Gap[] {
  const n = arms.length;
  const out: Gap[] = [];
  for (let i = 0; i < n; i++) {
    const a = arms[i];
    const b = arms[(i + 1) % n];
    let gap = armAngle(b) - armAngle(a);
    while (gap <= 1e-6) gap += Math.PI * 2;
    if (n === 1) gap = Math.PI * 2;
    const deg = (gap * 180) / Math.PI;
    if (deg > 165 && deg < 195) {
      out.push({ gap, kind: 'straight', tl: 0 });
      continue;
    }
    // Two arms leaving almost side by side (a ramp splitting off, a divided road's carriageways): their kerb lines
    // meet far out - no corner, the junction closes with a chord and the arms run on side by side.
    if (deg < 28) {
      out.push({ gap, kind: 'merge', tl: 0 });
      continue;
    }
    const [lx, lz] = edgePt(a, 1, 0);
    const [rx, rz] = edgePt(b, -1, 0);
    const hit = intersect(lx, lz, a.dx, a.dz, rx, rz, b.dx, b.dz);
    if (deg <= 165) {
      const r = Math.min(a.radius, b.radius);
      const tl = r / Math.tan(gap / 2);
      if (!hit) {
        out.push({ gap, kind: 'inner', t: a.maxCut, u: b.maxCut, tl: 0 });
        continue;
      }
      out.push({
        gap,
        kind: 'inner',
        t: Math.max(0, hit[0]),
        u: Math.max(0, hit[1]),
        tl: Math.min(tl, 12),
      });
    } else {
      // outer (reflex) corner: the facing lines meet behind the node
      const ok =
        hit &&
        hit[0] <= 0.5 &&
        hit[1] <= 0.5 &&
        hit[0] > -3 * Math.max(a.hwL, b.hwR) - 4 &&
        hit[1] > -3 * Math.max(a.hwL, b.hwR) - 4;
      out.push({
        gap,
        kind: 'outer',
        t: ok ? hit![0] : undefined,
        u: ok ? hit![1] : undefined,
        tl: 0,
      });
    }
  }
  return out;
}

/** Sort arms ccw. */
export function sortArms<T extends { dx: number; dz: number }>(arms: T[]): T[] {
  return [...arms].sort((p, q) => armAngle(p) - armAngle(q));
}

/**
 * Cuts of a single-node junction's arms (ccw-sorted `arms`, all leaving the same node): each arm stops past its kerb
 * corners + the kerb returns. Writes `cut`.
 */
export function junctionCuts(arms: ArmGeo[]): void {
  const n = arms.length;
  const gaps = gapsOf(arms);
  for (const a of arms) a.cut = 1;
  for (let i = 0; i < n; i++) {
    const g = gaps[i];
    const a = arms[i];
    const b = arms[(i + 1) % n];
    if (g.kind === 'inner') {
      a.cut = Math.max(a.cut, (g.t ?? 0) + g.tl + 0.5);
      b.cut = Math.max(b.cut, (g.u ?? 0) + g.tl + 0.5);
    }
  }
  for (let i = 0; i < n; i++) {
    const g = gaps[i];
    if (g.kind !== 'merge') continue;
    // the pair must at least clear each other's half width before they part
    const a = arms[i];
    const b = arms[(i + 1) % n];
    const need = Math.min(8, Math.max(a.hwL, b.hwR) + 1);
    a.cut = Math.max(a.cut, need);
    b.cut = Math.max(b.cut, need);
  }
  for (const a of arms) a.cut = Math.min(a.cut, a.maxCut, 30);
}

function bezier(
  p: [number, number],
  c: [number, number],
  q: [number, number],
  steps: number,
): [number, number][] {
  const out: [number, number][] = [];
  for (let k = 1; k < steps; k++) {
    const t = k / steps;
    const a = (1 - t) * (1 - t);
    const b = 2 * (1 - t) * t;
    const d = t * t;
    out.push([a * p[0] + b * c[0] + d * q[0], a * p[1] + b * c[1] + d * q[1]]);
  }
  return out;
}

/**
 * Outline of a single-node junction (arms ccw-sorted, `cut` set): for each arm its right / left kerb points at the cut,
 * then the kerb return to the next arm. Also the sidewalk corners between arms that both have a side strip there.
 */
export function junctionOutline(arms: ArmGeo[]): {
  poly: number[];
  corners: CornerGeo[];
} {
  const n = arms.length;
  const gaps = gapsOf(arms);
  const poly: number[] = [];
  const corners: CornerGeo[] = [];
  for (let i = 0; i < n; i++) {
    const a = arms[i];
    const b = arms[(i + 1) % n];
    const g = gaps[i];
    const aR = edgePt(a, -1, a.cut);
    const aL = edgePt(a, 1, a.cut);
    poly.push(aR[0], aR[1], aL[0], aL[1]);
    // kerb path from a's left end to b's right end (exclusive)
    const path: [number, number][] = [];
    if (g.kind === 'inner' && g.t !== undefined && g.u !== undefined) {
      const ts = Math.min(a.cut, g.t + g.tl);
      const us = Math.min(b.cut, g.u + g.tl);
      const p0 = edgePt(a, 1, ts);
      const p1 = edgePt(b, -1, us);
      const c = edgePt(a, 1, g.t);
      if (ts < a.cut - 0.05) path.push(p0);
      path.push(...bezier(p0, c, p1, 7));
      if (us < b.cut - 0.05) path.push(p1);
    } else if (g.kind === 'outer' && g.t !== undefined) {
      path.push(edgePt(a, 1, g.t));
    }
    for (const p of path) poly.push(p[0], p[1]);
    // sidewalk corner
    if (a.swL > 0 && b.swR > 0 && (g.kind === 'inner' || g.kind === 'outer')) {
      const aLo = edgePt(a, 1, a.cut, a.swL);
      const bRo = edgePt(b, -1, b.cut, b.swR);
      const [ox, oz] = edgePt(a, 1, 0, a.swL);
      const [qx, qz] = edgePt(b, -1, 0, b.swR);
      const hit = intersect(ox, oz, a.dx, a.dz, qx, qz, b.dx, b.dz);
      const cp: number[] = [aL[0], aL[1]];
      for (const p of path) cp.push(p[0], p[1]);
      const bR = edgePt(b, -1, b.cut);
      cp.push(bR[0], bR[1], bRo[0], bRo[1]);
      if (
        hit &&
        hit[0] > -6 &&
        hit[0] < a.cut + 2 &&
        hit[1] > -6 &&
        hit[1] < b.cut + 2
      )
        cp.push(ox + a.dx * hit[0], oz + a.dz * hit[0]);
      cp.push(aLo[0], aLo[1]);
      if (simple(cp) && Math.abs(area(cp)) > 0.3)
        corners.push({
          poly: cp,
          a: i,
          b: (i + 1) % n,
          kerbN: path.length + 2,
        });
    } else if (a.swL > 0 && b.swR > 0 && g.kind === 'straight') {
      // a straight continuation (a class / width change): bridge the two sidewalks
      const aLo = edgePt(a, 1, a.cut, a.swL);
      const bR = edgePt(b, -1, b.cut);
      const bRo = edgePt(b, -1, b.cut, b.swR);
      const cp = [aL[0], aL[1], bR[0], bR[1], bRo[0], bRo[1], aLo[0], aLo[1]];
      if (simple(cp) && Math.abs(area(cp)) > 0.3)
        corners.push({ poly: cp, a: i, b: (i + 1) % n, kerbN: 2 });
    }
  }
  return { poly, corners };
}

/** Signed area (math ccw > 0 with x east, z south flipped). */
export function area(p: number[]): number {
  let a = 0;
  const n = p.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++)
    a += p[j * 2] * p[i * 2 + 1] - p[i * 2] * p[j * 2 + 1];
  return a / 2;
}

/** No two non-adjacent edges cross. */
export function simple(p: number[]): boolean {
  const n = p.length / 2;
  if (n < 3) return false;
  const seg = (i: number) => [
    p[i * 2],
    p[i * 2 + 1],
    p[((i + 1) % n) * 2],
    p[((i + 1) % n) * 2 + 1],
  ];
  const cross = (
    ax: number,
    az: number,
    bx: number,
    bz: number,
    cx: number,
    cz: number,
  ) => (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  for (let i = 0; i < n; i++) {
    const [a1, a2, b1, b2] = seg(i);
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const [c1, c2, d1, d2] = seg(j);
      const d1x = cross(a1, a2, b1, b2, c1, c2);
      const d2x = cross(a1, a2, b1, b2, d1, d2);
      const d3x = cross(c1, c2, d1, d2, a1, a2);
      const d4x = cross(c1, c2, d1, d2, b1, b2);
      if (d1x * d2x < -1e-9 && d3x * d4x < -1e-9) return false;
    }
  }
  return true;
}

/**
 * Cluster of nodes (a divided road crossing another): arms leave from different nodes. The polygon is the hull of every
 * arm's kerb ends; an arm whose end still lies inside the hull is cut further back until it leaves it (else its own
 * surface would lie under the junction's). Corners: chords between neighbouring arms (sorted round the centroid).
 */
export function clusterOutline(
  arms: ArmGeo[],
  grow = true,
): {
  poly: number[];
  corners: CornerGeo[];
} {
  let hull: [number, number][] = [];
  for (let round = 0; round < (grow ? 3 : 1); round++) {
    const pts: [number, number][] = [];
    for (const a of arms) {
      pts.push(edgePt(a, 1, a.cut), edgePt(a, -1, a.cut));
      pts.push([a.ox, a.oz]);
    }
    hull = convexHull(pts);
    if (!grow) break;
    const flat = hull.flat();
    let moved = false;
    for (const a of arms) {
      for (let k = 0; k < 40 && a.cut < a.maxCut; k++) {
        const l = edgePt(a, 1, a.cut);
        const r = edgePt(a, -1, a.cut);
        const inside = (q: [number, number]) =>
          inPolygon(flat, q[0], q[1]) &&
          polygonDistance(flat, q[0], q[1]) > 0.4;
        if (!inside(l) && !inside(r)) break;
        a.cut += 0.5;
        moved = true;
      }
    }
    if (!moved) break;
  }
  const poly = hull.flat();
  // corners between arms sorted round the centroid
  let cx = 0;
  let cz = 0;
  for (const a of arms) {
    cx += a.ox;
    cz += a.oz;
  }
  cx /= arms.length;
  cz /= arms.length;
  const ang = (a: ArmGeo) => {
    const [x, z] = [a.ox + a.dx * a.cut, a.oz + a.dz * a.cut];
    return Math.atan2(-(z - cz), x - cx);
  };
  const order = arms
    .map((_, i) => i)
    .sort((p, q) => ang(arms[p]) - ang(arms[q]));
  const corners: CornerGeo[] = [];
  for (let k = 0; k < order.length; k++) {
    const i = order[k];
    const j = order[(k + 1) % order.length];
    const a = arms[i];
    const b = arms[j];
    if (a.swL <= 0 || b.swR <= 0) continue;
    const aL = edgePt(a, 1, a.cut);
    const aLo = edgePt(a, 1, a.cut, a.swL);
    const bR = edgePt(b, -1, b.cut);
    const bRo = edgePt(b, -1, b.cut, b.swR);
    const [ox, oz] = edgePt(a, 1, 0, a.swL);
    const [qx, qz] = edgePt(b, -1, 0, b.swR);
    const hit = intersect(ox, oz, a.dx, a.dz, qx, qz, b.dx, b.dz);
    const cp = [aL[0], aL[1], bR[0], bR[1], bRo[0], bRo[1]];
    if (
      hit &&
      hit[0] > -6 &&
      hit[0] < a.cut + 2 &&
      hit[1] > -6 &&
      hit[1] < b.cut + 2
    )
      cp.push(ox + a.dx * hit[0], oz + a.dz * hit[0]);
    cp.push(aLo[0], aLo[1]);
    // only between arms that face each other across open ground (a short chord)
    if (Math.hypot(bR[0] - aL[0], bR[1] - aL[1]) > 40) continue;
    if (simple(cp) && Math.abs(area(cp)) > 0.3)
      corners.push({ poly: cp, a: i, b: j, kerbN: 2 });
  }
  return { poly, corners };
}

/**
 * Outline of the union of several polygons (a cluster: its nodes' own junction polygons, the short ways between them and
 * a lip into each arm): rasterised at `cell` m, the outer boundary traced (Moore neighbourhood) and simplified. Holes are
 * filled. Robust for any arrangement of overlapping polygons.
 */
export function unionOutline(polys: number[][], cell = 0.4): number[] {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const p of polys)
    for (let k = 0; k < p.length; k += 2) {
      minX = Math.min(minX, p[k]);
      maxX = Math.max(maxX, p[k]);
      minZ = Math.min(minZ, p[k + 1]);
      maxZ = Math.max(maxZ, p[k + 1]);
    }
  if (!Number.isFinite(minX)) return [];
  minX -= cell * 2;
  minZ -= cell * 2;
  const nx = Math.ceil((maxX - minX) / cell) + 4;
  const nz = Math.ceil((maxZ - minZ) / cell) + 4;
  const occ = new Uint8Array(nx * nz);
  for (const p of polys) {
    let a = Infinity;
    let b = -Infinity;
    let c = Infinity;
    let d = -Infinity;
    for (let k = 0; k < p.length; k += 2) {
      a = Math.min(a, p[k]);
      b = Math.max(b, p[k]);
      c = Math.min(c, p[k + 1]);
      d = Math.max(d, p[k + 1]);
    }
    const i0 = Math.max(0, Math.floor((a - minX) / cell));
    const i1 = Math.min(nx - 1, Math.ceil((b - minX) / cell));
    const j0 = Math.max(0, Math.floor((c - minZ) / cell));
    const j1 = Math.min(nz - 1, Math.ceil((d - minZ) / cell));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        if (occ[j * nx + i]) continue;
        if (inPolygon(p, minX + (i + 0.5) * cell, minZ + (j + 0.5) * cell))
          occ[j * nx + i] = 1;
      }
  }
  // largest component only
  const comp = new Int32Array(nx * nz).fill(-1);
  let best = -1;
  let bestSize = 0;
  let id = 0;
  const stack: number[] = [];
  for (let k = 0; k < occ.length; k++) {
    if (!occ[k] || comp[k] >= 0) continue;
    let size = 0;
    stack.push(k);
    comp[k] = id;
    while (stack.length) {
      const q = stack.pop()!;
      size++;
      const i = q % nx;
      const j = (q - i) / nx;
      for (const [di, dj] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const ii = i + di;
        const jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
        const r = jj * nx + ii;
        if (occ[r] && comp[r] < 0) {
          comp[r] = id;
          stack.push(r);
        }
      }
    }
    if (size > bestSize) {
      bestSize = size;
      best = id;
    }
    id++;
  }
  const on = (i: number, j: number) =>
    i >= 0 && j >= 0 && i < nx && j < nz && comp[j * nx + i] === best;
  // start: the first cell of the component scanning rows
  let si = -1;
  let sj = -1;
  for (let k = 0; k < occ.length && si < 0; k++)
    if (comp[k] === best) {
      si = k % nx;
      sj = (k - si) / nx;
    }
  if (si < 0) return [];
  // Moore neighbourhood tracing (clockwise in grid coordinates)
  const dirs = [
    [-1, 0],
    [-1, -1],
    [0, -1],
    [1, -1],
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
  ];
  const pts: [number, number][] = [];
  let ci = si;
  let cj = sj;
  let back = 0; // came from the west
  for (let guard = 0; guard < nx * nz * 4; guard++) {
    pts.push([minX + (ci + 0.5) * cell, minZ + (cj + 0.5) * cell]);
    let found = false;
    for (let k = 0; k < 8; k++) {
      const d = (back + 1 + k) % 8;
      const ii = ci + dirs[d][0];
      const jj = cj + dirs[d][1];
      if (on(ii, jj)) {
        back = (d + 4) % 8;
        ci = ii;
        cj = jj;
        found = true;
        break;
      }
    }
    if (!found || (ci === si && cj === sj)) break;
  }
  if (pts.length < 3) return [];
  return simplifyClosed(pts, cell * 0.6).flat();
}

/** Douglas-Peucker on a closed ring. */
function simplifyClosed(
  pts: [number, number][],
  tol: number,
): [number, number][] {
  const n = pts.length;
  // split at the point farthest from the first
  let far = 0;
  let fd = -1;
  for (let i = 1; i < n; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (d > fd) {
      fd = d;
      far = i;
    }
  }
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[far] = 1;
  const dp = (a: number, b: number) => {
    // chain a..b (indices mod n, b > a in unwrapped terms)
    let best = -1;
    let bi = -1;
    const [ax, az] = pts[a % n];
    const [bx, bz] = pts[b % n];
    const ex = bx - ax;
    const ez = bz - az;
    const l = Math.hypot(ex, ez) || 1e-9;
    for (let k = a + 1; k < b; k++) {
      const [px, pz] = pts[k % n];
      const d = Math.abs((px - ax) * ez - (pz - az) * ex) / l;
      if (d > best) {
        best = d;
        bi = k;
      }
    }
    if (best > tol && bi > 0) {
      keep[bi % n] = 1;
      dp(a, bi);
      dp(bi, b);
    }
  };
  dp(0, far);
  dp(far, n);
  return pts.filter((_, i) => keep[i]);
}
