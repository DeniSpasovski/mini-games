import { describe, expect, test } from '@rstest/core';
import { jackieMap } from '../../src/games/rally/maps/jackie/map';
import { TerrainGenerator } from '../../src/games/rally/world/terrain-gen';
import { Plazas } from '../../src/games/rally/world/plazas';

/**
 * The plaza queries look only at the plazas on the candidate grid (plazas.ts): same answers as the plain loop over
 * every plaza, on the real jackie data - edges, vertices, points far from all of them - and on jackie's plazas with
 * exact and shifted copies (overlaps and ties: the first plaza in order wins).
 */

const gen = new TerrainGenerator(jackieMap);
const plazas = gen.plazas;
const shift = (pts: number[], dx: number, dz: number) =>
  pts.map((v, i) => v + (i % 2 ? dz : dx));
const outlines = jackieMap.junctionPlazas ?? [];
const areas = jackieMap.junctionAreas ?? [];
const overlapping = new Plazas(
  [...outlines, ...outlines, ...outlines.map((p) => shift(p, 5, -3))],
  gen.portals,
  [],
  [...areas.map((p) => shift(p, -4, 6)), ...areas],
  jackieMap.ribbonAreas,
  (x, z) => gen.inOpenCut(x, z),
);

type Poly = Plazas['polys'][number];
interface Internals {
  frame(p: Poly, x: number, z: number): { top: number } | undefined;
  overTrench(p: Poly, x: number, z: number): boolean;
  openCut?: (x: number, z: number) => boolean;
  portals: { inside(x: number, z: number): boolean };
}
const inner = (pl: Plazas) => pl as unknown as Internals;

function inPoly(p: number[], x: number, z: number): boolean {
  let c = false;
  const n = p.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = p[i * 2];
    const zi = p[i * 2 + 1];
    const xj = p[j * 2];
    const zj = p[j * 2 + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi)
      c = !c;
  }
  return c;
}

function edgeDistance(p: number[], x: number, z: number): number {
  let best = Infinity;
  const n = p.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ax = p[j * 2];
    const az = p[j * 2 + 1];
    const ex = p[i * 2] - ax;
    const ez = p[i * 2 + 1] - az;
    const l2 = ex * ex + ez * ez || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2));
    best = Math.min(best, Math.hypot(ax + ex * t - x, az + ez * t - z));
  }
  return best;
}

function sampleField(f: NonNullable<Poly['field']>, x: number, z: number) {
  const u = Math.min(f.nx - 1.001, Math.max(0, x - f.x0));
  const v = Math.min(f.nz - 1.001, Math.max(0, z - f.z0));
  const i = Math.floor(u);
  const j = Math.floor(v);
  const a = u - i;
  const b = v - j;
  const k = j * f.nx + i;
  const h = f.h;
  return (
    (h[k] * (1 - a) + h[k + 1] * a) * (1 - b) +
    (h[k + f.nx] * (1 - a) + h[k + f.nx + 1] * a) * b
  );
}

// The plain loops over every plaza (the reference).
const ref = (pl: Plazas) => ({
  indexAt(x: number, z: number, pad = 0): number {
    for (let i = 0; i < pl.polys.length; i++) {
      const p = pl.polys[i];
      if (
        x < p.minX - pad ||
        x > p.maxX + pad ||
        z < p.minZ - pad ||
        z > p.maxZ + pad
      )
        continue;
      if (inPoly(p.pts, x, z) || (pad > 0 && edgeDistance(p.pts, x, z) <= pad))
        return inner(pl).overTrench(p, x, z) ? -1 : i;
    }
    return -1;
  },
  height(x: number, z: number): number | undefined {
    let best: Poly | undefined;
    let bd = Infinity;
    for (const p of pl.polys) {
      const d = inPoly(p.pts, x, z) ? 0 : edgeDistance(p.pts, x, z);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    if (best?.field) return sampleField(best.field, x, z);
    return best && inner(pl).frame(best, x, z)?.top;
  },
  distance(x: number, z: number): number {
    let best = Infinity;
    for (const p of pl.polys) {
      if (
        p.area &&
        inner(pl).openCut &&
        x >= p.minX &&
        x <= p.maxX &&
        z >= p.minZ &&
        z <= p.maxZ &&
        inner(pl).openCut(x, z)
      )
        continue;
      best = Math.min(
        best,
        inPoly(p.pts, x, z) ? 0 : edgeDistance(p.pts, x, z),
      );
    }
    return best;
  },
  level(x: number, z: number, h: number, blend = true): number {
    const B = blend ? 8 : 0;
    for (const p of pl.polys) {
      if (x < p.minX - B || x > p.maxX + B || z < p.minZ - B || z > p.maxZ + B)
        continue;
      const inside = inPoly(p.pts, x, z);
      const d = inside ? 0 : edgeDistance(p.pts, x, z);
      if ((!inside && d >= B) || inner(pl).overTrench(p, x, z)) continue;
      if (p.area && !p.field && !inner(pl).portals.inside(x, z)) continue;
      const top = p.field
        ? sampleField(p.field, x, z)
        : inner(pl).frame(p, x, z)?.top;
      if (top === undefined) continue;
      if (inside) return top;
      const t = Math.min(1, Math.max(0, d / B));
      return h + (top - h) * (1 - t * t * (3 - 2 * t));
    }
    return h;
  },
});

// Every vertex and points along every edge, a sparse grid over and around each plaza, random points far and near.
const pts: [number, number][] = [];
let minX = Infinity;
let maxX = -Infinity;
let minZ = Infinity;
let maxZ = -Infinity;
for (const p of plazas.polys) {
  minX = Math.min(minX, p.minX);
  maxX = Math.max(maxX, p.maxX);
  minZ = Math.min(minZ, p.minZ);
  maxZ = Math.max(maxZ, p.maxZ);
  const n = p.pts.length / 2;
  for (let i = 0; i < n; i++) {
    const ax = p.pts[i * 2];
    const az = p.pts[i * 2 + 1];
    const bx = p.pts[((i + 1) % n) * 2];
    const bz = p.pts[((i + 1) % n) * 2 + 1];
    for (const f of [0, 1 / 3, 0.5])
      pts.push([ax + (bx - ax) * f, az + (bz - az) * f]);
    // Just beyond the pads the queries use (0.3, 0.5, 1 m) and the blend (8 m).
    const l = Math.hypot(bx - ax, bz - az) || 1;
    for (const off of [0.3, 1, 8, 8.01])
      pts.push([
        (ax + bx) / 2 + ((bz - az) / l) * off,
        (az + bz) / 2 - ((bx - ax) / l) * off,
      ]);
  }
  const step = Math.max(3, (p.maxX - p.minX + p.maxZ - p.minZ) / 12);
  for (let x = p.minX - 10; x <= p.maxX + 10; x += step)
    for (let z = p.minZ - 10; z <= p.maxZ + 10; z += step) pts.push([x, z]);
}
let seed = 7;
const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32;
for (let i = 0; i < 3000; i++)
  pts.push([
    minX - 300 + rnd() * (maxX - minX + 600),
    minZ - 300 + rnd() * (maxZ - minZ + 600),
  ]);

describe('plaza candidate grid', () => {
  test('jackie plazas, overlapping copies', () => {
    expect(plazas.polys.length).toBeGreaterThan(1);
    const overlaps = pts.filter(
      ([x, z]) =>
        overlapping.polys.filter((p) => inPoly(p.pts, x, z)).length > 1,
    ).length;
    expect(overlaps).toBeGreaterThan(50);
  });

  test.each([
    ['jackie', plazas],
    ['overlapping', overlapping],
  ])('%s: same answers as the loop over every plaza', (_, pl) => {
    const r = ref(pl);
    const wrong: string[] = [];
    const check = (what: string, a: unknown, b: unknown) => {
      if (!Object.is(a, b) && wrong.length < 20)
        wrong.push(`${what}: ${a} != ${b}`);
    };
    for (const [x, z] of pts) {
      const at = `(${x}, ${z})`;
      for (const pad of [0, 0.3, 0.5, 1])
        check(
          `indexAt ${at} pad ${pad}`,
          pl.indexAt(x, z, pad),
          r.indexAt(x, z, pad),
        );
      check(`height ${at}`, pl.height(x, z), r.height(x, z));
      check(`distance ${at}`, pl.distance(x, z), r.distance(x, z));
      check(`level ${at}`, pl.level(x, z, 3.25), r.level(x, z, 3.25));
      check(
        `level ${at} no blend`,
        pl.level(x, z, 3.25, false),
        r.level(x, z, 3.25, false),
      );
    }
    expect(wrong).toEqual([]);
  });
});
