import { Vector2 } from 'three';
import { ORIGIN, type Corner } from './frame';
import { getYards, inside, type Yard } from './layout';

/**
 * The lots' yard surfaces as data (pure, node-safe): the planes the yard paving lies on, shared by the builder
 * (build/lots, which draws them) and the physics (index.ts `groundOverride`, which drives on them), so the wheels
 * meet the surface they see.
 */

/** y = a x + b z + c (world x, z). */
export interface Plane {
  a: number;
  b: number;
  c: number;
}

/** Height of each yard surface over its plane (pads) or over the ground (draped lots), m. */
export const YARD_TOP = {
  pad: 0.04,
  mileks: 0.03,
  patch: 0.07,
  draped: 0.05,
  drapedPatch: 0.08,
  drive: 0.05,
  /** An unpaved track on the ground (`Plot.flushDrive`): just a gravel layer, level with the ground. */
  driveFlush: 0.02,
} as const;

/** How far the drawn terrain is cut under a flush drive (m): the layer's own depth, so the terrain never shows through. */
export const FLUSH_DRIVE_SINK = YARD_TOP.driveFlush;
/** The cut eases in from the drive's edge over this distance (m). */
const FLUSH_RAMP = 0.5;

/** Least-squares plane through world (x, z, y) samples. */
export function fitPlane(samples: [number, number, number][]): Plane {
  // Centre the data for conditioning, then solve the 3x3 normal equations.
  const n = samples.length;
  const mx = samples.reduce((s, p) => s + p[0], 0) / n;
  const mz = samples.reduce((s, p) => s + p[1], 0) / n;
  const my = samples.reduce((s, p) => s + p[2], 0) / n;
  let sxx = 0;
  let sxz = 0;
  let szz = 0;
  let sxy = 0;
  let szy = 0;
  for (const [x, z, y] of samples) {
    const dx = x - mx;
    const dz = z - mz;
    const dy = y - my;
    sxx += dx * dx;
    sxz += dx * dz;
    szz += dz * dz;
    sxy += dx * dy;
    szy += dz * dy;
  }
  const det = sxx * szz - sxz * sxz;
  const a = Math.abs(det) < 1e-9 ? 0 : (sxy * szz - szy * sxz) / det;
  const b = Math.abs(det) < 1e-9 ? 0 : (szy * sxx - sxy * sxz) / det;
  return { a, b, c: my - a * mx - b * mz };
}

/**
 * The plane of a lot's graded pad, fitted through the ground (site x, z -> world y) under `points` (site) and their
 * centre. `cover`: a yard surface must lie on the ground, not under it - the edges and the inside are sampled too
 * and the plane lifted to clear the highest of them.
 */
export function padPlane(
  ground: (x: number, z: number) => number,
  points: Corner[],
  cover = false,
): Plane {
  const cx = points.reduce((s, p) => s + p[0], 0) / points.length;
  const cz = points.reduce((s, p) => s + p[1], 0) / points.length;
  const at = (x: number, z: number): [number, number, number] => [
    x + ORIGIN.x,
    z + ORIGIN.z,
    ground(x, z),
  ];
  const samples = [...points.map(([x, z]) => at(x, z)), at(cx, cz)];
  if (cover)
    points.forEach(([x, z], i) => {
      const [nx, nz] = points[(i + 1) % points.length];
      samples.push(
        at((x + nx) / 2, (z + nz) / 2),
        at((x + cx) / 2, (z + cz) / 2),
        at((x + nx + cx) / 3, (z + nz + cz) / 3),
      );
    });
  const plane = fitPlane(samples);
  if (cover)
    plane.c += Math.max(
      0,
      ...samples.map(([x, z, y]) => y - (plane.a * x + plane.b * z + plane.c)),
    );
  return plane;
}

/** `polygon` clipped to the band `a <= p . dir <= b` (Sutherland-Hodgman against two half-planes). */
export function clipBand(
  polygon: Vector2[],
  dir: Vector2,
  a: number,
  b: number,
): Vector2[] {
  const half = (poly: Vector2[], keep: (p: Vector2) => number): Vector2[] => {
    const out: Vector2[] = [];
    poly.forEach((p, i) => {
      const q = poly[(i + 1) % poly.length];
      const kp = keep(p);
      const kq = keep(q);
      if (kp >= 0) out.push(p);
      if (kp >= 0 !== kq >= 0) out.push(p.clone().lerp(q, kp / (kp - kq)));
    });
    return out;
  };
  const low = half(polygon, (p) => p.dot(dir) - a);
  return low.length ? half(low, (p) => b - p.dot(dir)) : [];
}

/** `subject` clipped to the convex polygon `clip` (Sutherland-Hodgman, either winding). */
export function clipConvex(subject: Vector2[], clip: Vector2[]): Vector2[] {
  const area = clip.reduce(
    (sum, p, i) => sum + p.cross(clip[(i + 1) % clip.length]),
    0,
  );
  const sign = area >= 0 ? 1 : -1;
  let out = subject;
  clip.forEach((a, i) => {
    const c = clip[(i + 1) % clip.length];
    const side = (p: Vector2) =>
      sign * ((c.x - a.x) * (p.y - a.y) - (c.y - a.y) * (p.x - a.x));
    const input = out;
    out = [];
    input.forEach((p, k) => {
      const q = input[(k + 1) % input.length];
      const sp = side(p);
      const sq = side(q);
      if (sp >= 0) out.push(p);
      if (sp >= 0 !== sq >= 0) out.push(p.clone().lerp(q, sp / (sp - sq)));
    });
  });
  return out;
}

/** The yard cut every ~18 m along the street into polygons (a lot on a long frontage becomes several). */
export function stripsOf(yard: Yard): Vector2[][] {
  const { polygon, plot } = yard;
  // Along the frontage; a lot off the street is cut along x (the street runs roughly east).
  const last = polygon.length - plot.yard.back.length - 1;
  const dir = plot.yard.street
    ? polygon[last].clone().sub(polygon[0]).normalize()
    : new Vector2(1, 0);
  return strips(polygon, dir);
}

/** `polygon` cut every ~18 m along `dir` into polygons, each fit for its own plane. */
function strips(polygon: Vector2[], dir: Vector2): Vector2[][] {
  const ts = polygon.map((p) => p.dot(dir));
  const t0 = Math.min(...ts);
  const t1 = Math.max(...ts);
  const n = Math.max(1, Math.round((t1 - t0) / 18));
  const out: Vector2[][] = [];
  for (let k = 0; k < n; k++) {
    const strip = clipBand(
      polygon,
      dir,
      t0 + ((t1 - t0) * k) / n - 1e-3,
      t0 + ((t1 - t0) * (k + 1)) / n + 1e-3,
    );
    if (strip.length >= 3) out.push(strip);
  }
  return out;
}

/** One paved piece of a yard: its outline (site) and the height of its top (world y) at a site point. */
export interface YardSurface {
  polygon: Vector2[];
  height: (x: number, z: number) => number;
  /** Bounds (site). */
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

const surface = (
  polygon: Vector2[],
  height: (x: number, z: number) => number,
): YardSurface => ({
  polygon,
  height,
  x0: Math.min(...polygon.map((p) => p.x)),
  x1: Math.max(...polygon.map((p) => p.x)),
  z0: Math.min(...polygon.map((p) => p.y)),
  z1: Math.max(...polygon.map((p) => p.y)),
});

/** Every yard's paving, its patches and its drive, as build/lots draws them. `ground`: site x, z -> world y. */
export const yardSurfaces = (
  ground: (x: number, z: number) => number,
): YardSurface[] => getYards().flatMap((yard) => surfacesOf(yard, ground));

/** One yard's paving (strip by strip), its patches and its drive. */
export function surfacesOf(
  yard: Yard,
  ground: (x: number, z: number) => number,
): YardSurface[] {
  const out: YardSurface[] = [];
  {
    const { plot } = yard;
    const patches = (plot.patches ?? []).map((patch) =>
      patch.polygon.map((c) => new Vector2(c[0], c[1])),
    );
    for (const strip of stripsOf(yard)) {
      if (plot.noPad) {
        out.push(surface(strip, (x, z) => ground(x, z) + YARD_TOP.draped));
        for (const patch of patches) {
          const part = clipConvex(strip, patch);
          if (part.length >= 3)
            out.push(
              surface(part, (x, z) => ground(x, z) + YARD_TOP.drapedPatch),
            );
        }
        continue;
      }
      const plane = padPlane(
        ground,
        strip.map((p): Corner => [p.x, p.y]),
        true,
      );
      const on = (top: number) => (x: number, z: number) =>
        plane.a * (x + ORIGIN.x) + plane.b * (z + ORIGIN.z) + plane.c + top;
      out.push(
        surface(
          strip,
          on(plot.style === 'mileks' ? YARD_TOP.mileks : YARD_TOP.pad),
        ),
      );
      for (const patch of patches) {
        const part = clipConvex(strip, patch);
        if (part.length >= 3) out.push(surface(part, on(YARD_TOP.patch)));
      }
    }
    if (yard.driveIn.length >= 3)
      out.push(
        surface(
          yard.driveIn,
          (x, z) =>
            ground(x, z) +
            (plot.flushDrive ? YARD_TOP.driveFlush : YARD_TOP.drive),
        ),
      );
  }
  return out;
}

/** Grid cell for the yard lookup (m). */
const YARD_CELL = 16;

/**
 * Height of the yards' paving at a site point (world y; the highest piece over it), NaN off every yard: what the
 * wheels ride on (index.ts) and what the driveway aprons climb to (streetwork.ts). `ground`: site x, z -> world y.
 */
export function yardTop(
  ground: (x: number, z: number) => number,
): (x: number, z: number) => number {
  const grid = new Map<number, YardSurface[]>();
  const cell = (cx: number, cz: number) => (cx + 4096) * 8192 + (cz + 4096);
  for (const s of yardSurfaces(ground))
    for (
      let cx = Math.floor(s.x0 / YARD_CELL);
      cx <= Math.floor(s.x1 / YARD_CELL);
      cx++
    )
      for (
        let cz = Math.floor(s.z0 / YARD_CELL);
        cz <= Math.floor(s.z1 / YARD_CELL);
        cz++
      ) {
        const k = cell(cx, cz);
        const l = grid.get(k);
        if (l) l.push(s);
        else grid.set(k, [s]);
      }
  const p = new Vector2();
  return (x, z) => {
    const l = grid.get(
      cell(Math.floor(x / YARD_CELL), Math.floor(z / YARD_CELL)),
    );
    if (!l) return NaN;
    let y = NaN;
    p.set(x, z);
    for (const s of l)
      if (
        x >= s.x0 &&
        x <= s.x1 &&
        z >= s.z0 &&
        z <= s.z1 &&
        inside(p, s.polygon)
      ) {
        const h = s.height(x, z);
        if (!(h <= y)) y = h;
      }
    return y;
  };
}

/**
 * How far the drawn terrain is cut under the flush drives (`Plot.flushDrive`: unpaved tracks laid level with the ground), site x, z -> m:
 * eased in from the drive's edge, 0 off it. Physics keeps the ground; the track's gravel layer lies in the cut.
 */
export function flushDriveSink(): (x: number, z: number) => number {
  const drives = getYards()
    .filter((y) => y.plot.flushDrive && y.driveIn.length >= 3)
    .map((y) => ({
      polygon: y.driveIn,
      x0: Math.min(...y.driveIn.map((p) => p.x)),
      x1: Math.max(...y.driveIn.map((p) => p.x)),
      z0: Math.min(...y.driveIn.map((p) => p.y)),
      z1: Math.max(...y.driveIn.map((p) => p.y)),
    }));
  const p = new Vector2();
  return (x, z) => {
    let sink = 0;
    p.set(x, z);
    for (const d of drives) {
      if (x < d.x0 || x > d.x1 || z < d.z0 || z > d.z1) continue;
      if (!inside(p, d.polygon)) continue;
      let edge = Infinity;
      for (let i = 0, j = d.polygon.length - 1; i < d.polygon.length; j = i++)
        edge = Math.min(edge, segmentDistance(p, d.polygon[j], d.polygon[i]));
      sink = Math.max(sink, Math.min(1, edge / FLUSH_RAMP) * FLUSH_DRIVE_SINK);
    }
    return sink;
  };
}

function segmentDistance(p: Vector2, a: Vector2, b: Vector2): number {
  const dx = b.x - a.x;
  const dz = b.y - a.y;
  const l2 = dx * dx + dz * dz;
  const t = l2
    ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dz) / l2))
    : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dz * t));
}
