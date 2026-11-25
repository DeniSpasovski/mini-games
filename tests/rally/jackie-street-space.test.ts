import { describe, expect, rs, test } from '@rstest/core';
import { appendFileSync, writeFileSync } from 'node:fs';
import type { BufferGeometry, InstancedMesh, Mesh } from 'three';
import { jackie2Map } from '../../src/games/rally/maps/jackie-2/map';
import { inPolygon } from '../../src/games/rally/world/v2/alignment';
import { barrierPlan, netMeshJob } from '../../src/games/rally/world/v2/mesh';
import { newRoadQuery } from '../../src/games/rally/world/road';
import { World } from '../../src/games/rally/world/world';

/**
 * Jackie 2's street space at the Kew end (NYC planimetric roadbed / sidewalk / median, `street-space.json`, and the
 * three survey plazas): what the built road mesh paves there, in 1 m cells. The self-checks run before each review
 * pass; the numbers go in its report (JACKIE_CELLS=<file> also writes the cells for the lidar comparison).
 */
// (the sign and plate textures draw on a canvas: none here, a context that draws nothing)
const noCtx: unknown = new Proxy(
  {},
  {
    get: (_, p) =>
      p === 'measureText'
        ? (t: string) => ({ width: t.length * 10 })
        : p === 'createImageData' || p === 'getImageData'
          ? (w: number, h: number) => ({
              data: new Uint8ClampedArray(w * h * 4),
            })
          : () => noCtx,
    set: () => true,
  },
);
rs.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
  noCtx as never,
);
const T0 = Date.now();
const log = (m: string) =>
  process.env.JACKIE_LOG &&
  appendFileSync(process.env.JACKIE_LOG, `${m} ${Date.now() - T0} ms\n`);
/** A check's numbers: in the test output and, with JACKIE_LOG=<file>, in that file (for the review report). */
const report = (m: string) => {
  console.info(m);
  if (process.env.JACKIE_LOG) appendFileSync(process.env.JACKIE_LOG, `${m}\n`);
};
const world = new World(jackie2Map);
log('world');
const net = world.gen.net!;
const field = world.gen.netField!;
const job = netMeshJob(world);
let res = job.next();
while (!res.done) res = job.next();
const group = res.value!;
log('mesh');
/** The street space's box: only the paving there is looked at. */
const sb = [...net.under, ...net.plazas].reduce(
  (b, u) => [
    Math.min(b[0], u.minX),
    Math.max(b[1], u.maxX),
    Math.min(b[2], u.minZ),
    Math.max(b[3], u.maxZ),
  ],
  [Infinity, -Infinity, Infinity, -Infinity],
);

/** Highest drawn paving per cell (any surface but paint and kerb faces), and the cells of each material. */
const top = new Map<string, number>();
const byMat = new Map<string, Set<string>>();
/** Paint on 0.25 m cells. */
const fine = new Set<string>();
group.updateMatrixWorld(true);
const meshes: Mesh[] = [];
group.traverse((o) => {
  if ((o as Mesh).isMesh && !(o as InstancedMesh).isInstancedMesh)
    meshes.push(o as Mesh);
});
for (const o of meshes) {
  // (the paving by material; the structures - walls, slabs, decks - as 'part')
  const id = o.name.startsWith('net:') ? o.name.slice(4) : 'part';
  const g = (o.geometry as BufferGeometry).clone().applyMatrix4(o.matrixWorld);
  const pos = g.getAttribute('position');
  const idx = g.getIndex();
  const cells = byMat.get(id) ?? new Set<string>();
  byMat.set(id, cells);
  const n = idx ? idx.count : pos.count;
  for (let t = 0; t < n; t += 3) {
    const [a, b, c] = idx
      ? [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)]
      : [t, t + 1, t + 2];
    const ax = pos.getX(a);
    const az = pos.getZ(a);
    const bx = pos.getX(b);
    const bz = pos.getZ(b);
    const cx = pos.getX(c);
    const cz = pos.getZ(c);
    const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(det) < 1e-6) continue; // (a wall or kerb face)
    if (Math.max(ax, bx, cx) < sb[0] || Math.min(ax, bx, cx) > sb[1]) continue;
    if (Math.max(az, bz, cz) < sb[2] || Math.min(az, bz, cz) > sb[3]) continue;
    // (paint: also on 0.25 m cells, a ladder bar is 0.6 m wide)
    if (id === 'paint')
      for (
        let x = Math.floor(Math.min(ax, bx, cx) * 4);
        x <= Math.max(ax, bx, cx) * 4;
        x++
      )
        for (
          let z = Math.floor(Math.min(az, bz, cz) * 4);
          z <= Math.max(az, bz, cz) * 4;
          z++
        ) {
          const px = (x + 0.5) / 4;
          const pz = (z + 0.5) / 4;
          const l1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / det;
          const l2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / det;
          if (l1 >= -1e-6 && l2 >= -1e-6 && 1 - l1 - l2 >= -1e-6)
            fine.add(`${x},${z}`);
        }
    for (
      let x = Math.floor(Math.min(ax, bx, cx));
      x <= Math.max(ax, bx, cx);
      x++
    )
      for (
        let z = Math.floor(Math.min(az, bz, cz));
        z <= Math.max(az, bz, cz);
        z++
      ) {
        const px = x + 0.5;
        const pz = z + 0.5;
        const l1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / det;
        const l2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / det;
        const l3 = 1 - l1 - l2;
        if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
        const k = `${x},${z}`;
        cells.add(k);
        if (id === 'paint' || id === 'kerb' || id === 'part') continue;
        const y = l1 * pos.getY(a) + l2 * pos.getY(b) + l3 * pos.getY(c);
        if (y > (top.get(k) ?? -Infinity)) top.set(k, y);
      }
  }
}
log('raster');
const mat = (id: string) => byMat.get(id) ?? new Set<string>();

/** The street space cells: kind, raised median, stage metres (viewer). */
interface Cell {
  x: number;
  z: number;
  kind: 'road' | 'walk';
  median: boolean;
  along: number;
}
const medians = [
  ...net.underMedians,
  ...net.plazas.flatMap((pl) =>
    pl.islands.filter((il) => il.kind !== 'painted').map((il) => il.pts),
  ),
];
const space = new Map<string, Cell>();
const q = newRoadQuery();
const addCell = (x: number, z: number, kind: Cell['kind']) => {
  const k = `${x},${z}`;
  if (space.has(k)) return;
  world.road.query(x + 0.5, z + 0.5, q);
  space.set(k, {
    x: x + 0.5,
    z: z + 0.5,
    kind,
    median: medians.some((m) => inPolygon(m, x + 0.5, z + 0.5)),
    along: q.along,
  });
};
for (const u of net.under)
  for (let x = Math.floor(u.minX); x <= u.maxX; x++)
    for (let z = Math.floor(u.minZ); z <= u.maxZ; z++)
      if (
        inPolygon(u.area, x + 0.5, z + 0.5) &&
        !u.holes.some((h) => inPolygon(h, x + 0.5, z + 0.5))
      )
        addCell(x, z, u.kind);
for (const pl of net.plazas)
  for (let x = Math.floor(pl.minX); x <= pl.maxX; x++)
    for (let z = Math.floor(pl.minZ); z <= pl.maxZ; z++)
      if (inPolygon(pl.area, x + 0.5, z + 0.5)) addCell(x, z, 'road');
/** Over the open cut (between the trench walls): the trench road and walls stand for the street space there. */
const overCut = (c: Cell) => field.openCut(c.x, c.z);
/** The Queens Blvd junction over the hall (the review's top plaza window). */
const topPlaza = (c: Cell) =>
  c.x >= 2593 && c.x <= 2817 && c.z >= -1869 && c.z <= -1743;

log('cells');
describe('jackie 2: street space self-checks', () => {
  test('a. every street space cell is paved (bare m2 per 100 m of stage)', () => {
    const cells = [...space.entries()].filter(([, c]) => !overCut(c));
    const bare = cells.filter(([k]) => !top.has(k));
    const per = new Map<number, number>();
    for (const [, c] of bare)
      per.set(
        Math.floor(c.along / 100) * 100,
        (per.get(Math.floor(c.along / 100) * 100) ?? 0) + 1,
      );
    const rows = [...per.entries()].sort((a, b) => a[0] - b[0]);
    // (over the open cut: nothing drawn at any height there - no road below, no paving - is bare too)
    const cutBare = [...space.entries()].filter(
      ([k, c]) =>
        overCut(c) &&
        !top.has(k) &&
        !mat('part').has(k) &&
        // (a trench street's verge: the terrain draws it, on purpose)
        field.top(c.x, c.z)?.surface !== 'grass',
    );
    if (process.env.JACKIE_CELLS)
      writeFileSync(
        `${process.env.JACKIE_CELLS}.cut`,
        JSON.stringify(cutBare.map(([, c]) => [c.x, c.z, Math.round(c.along)])),
      );
    const tp = cells.filter(([, c]) => topPlaza(c));
    const tpBare = tp.filter(([k]) => !top.has(k)).length;
    report(
      `[jackie2 street] ${cells.length} m2 city street space (${space.size - cells.length} over the cut): bare ${bare.length} m2` +
        ` (road ${bare.filter(([, c]) => c.kind === 'road').length}, walk ${bare.filter(([, c]) => c.kind === 'walk').length});` +
        ` top plaza ${tp.length} m2, bare ${tpBare}; per 100 m: ${rows.map(([a, n]) => `${a}:${n}`).join(' ')};` +
        ` over the cut nothing drawn on ${cutBare.length} m2 (top plaza ${cutBare.filter(([, c]) => topPlaza(c)).length})`,
    );
    if (process.env.JACKIE_CELLS)
      writeFileSync(
        process.env.JACKIE_CELLS,
        JSON.stringify(
          cells.map(([k, c]) => [
            c.x,
            c.z,
            c.kind === 'road' ? 1 : 0,
            top.get(k) ?? null,
            world.gen.height(c.x, c.z),
          ]),
        ),
      );
    expect(tpBare).toBe(0);
    expect(bare.length).toBeLessThan(cells.length * 0.002);
  });

  test('b. no land above the paving, nothing raised on real roadbed', () => {
    let above = 0;
    let n = 0;
    for (const [k, c] of space) {
      const y = top.get(k);
      if (y === undefined || overCut(c)) continue;
      n++;
      // (within the terrain mesh's own sampling of it: 0.1 m)
      if (world.gen.height(c.x, c.z) > y + 0.1) above++;
    }
    const island = mat('island');
    const walk = mat('sidewalk');
    let raised = 0;
    let walkOnRoad = 0;
    for (const [k, c] of space) {
      if (c.kind !== 'road' || c.median) continue;
      if (island.has(k)) raised++;
      if (walk.has(k)) walkOnRoad++;
    }
    report(
      `[jackie2 street] land above paving: ${above} of ${n} cells; raised island on real roadbed ${raised} m2,` +
        ` sidewalk paving on real roadbed ${walkOnRoad} m2`,
    );
    // (two cells by the stage's cut edge west of the Kew end, 0.3 m: the paving's clip line)
    expect(above).toBeLessThanOrEqual(5);
    expect(raised).toBeLessThan(10);
  });

  test('c. every record crosswalk is drawn, lane paint on the paved plaza junctions', () => {
    const paint = mat('paint');
    let bars = 0;
    let drawn = 0;
    const missed: number[][] = [];
    for (const pl of net.plazas)
      for (const cw of pl.crosswalks)
        for (let k = 0; k + 3 < cw.length; k += 2) {
          const L = Math.hypot(cw[k + 2] - cw[k], cw[k + 3] - cw[k + 1]);
          for (let d = 0.6; d < L; d += 1.2) {
            const x = cw[k] + ((cw[k + 2] - cw[k]) * d) / L;
            const z = cw[k + 1] + ((cw[k + 3] - cw[k + 1]) * d) / L;
            if (medians.some((m) => inPolygon(m, x, z))) continue;
            bars++;
            if (fine.has(`${Math.floor(x * 4)},${Math.floor(z * 4)}`)) drawn++;
            else missed.push([x, z]);
          }
        }
    const junctions = net.junctions.filter((j) => j.plaza);
    const painted = junctions.filter((j) => {
      for (let x = Math.floor(j.minX); x <= j.maxX; x++)
        for (let z = Math.floor(j.minZ); z <= j.maxZ; z++)
          if (paint.has(`${x},${z}`)) return true;
      return false;
    });
    const crosswalks = net.plazas.reduce(
      (n, pl) => n + pl.crosswalks.length,
      0,
    );
    report(
      `[jackie2 street] ${crosswalks} record crosswalks: ${drawn} of ${bars} ladder bars drawn;` +
        ` lane paint at ${painted.length} of ${junctions.length} plaza junctions`,
    );
    if (process.env.JACKIE_CELLS)
      writeFileSync(`${process.env.JACKIE_CELLS}.bars`, JSON.stringify(missed));
    expect(drawn).toBeGreaterThanOrEqual(bars * 0.95);
    expect(painted.length).toBe(junctions.length);
  });

  test('d. the stage barriers at the Kew end: gaps only at the junction mouths', () => {
    const w = net.stage;
    const out: string[] = [];
    let unexpected = 0;
    for (const side of [0, 1] as const) {
      const runs = barrierPlan(net, field, w, side)
        .flatMap((p) => p.runs)
        .filter(([a, b]) => b > 6600 && a < 7570)
        .sort((a, b) => a[0] - b[0]);
      const merged: [number, number][] = [];
      for (const [a, b] of runs) {
        const last = merged[merged.length - 1];
        if (last && a <= last[1] + 0.5) last[1] = Math.max(last[1], b);
        else merged.push([a, b]);
      }
      const gaps = merged
        .slice(1)
        .map((r, i) => [merged[i][1], r[0]] as [number, number]);
      out.push(
        `${side ? 'right' : 'left'} ${merged.map(([a, b]) => `${a.toFixed(0)}-${b.toFixed(0)}`).join(' ')}`,
      );
      // (a gap is fine where a street meets the stage road: a junction there)
      for (const [a, b] of gaps) {
        const mid = (a + b) / 2;
        const lat = (side ? -1 : 1) * 12;
        const r = world.road.at(mid);
        const x = r.x + r.tz * lat;
        const z = r.z - r.tx * lat;
        const mouth = net.junctions.some(
          (j) =>
            x >= j.minX - 15 &&
            x <= j.maxX + 15 &&
            z >= j.minZ - 15 &&
            z <= j.maxZ + 15,
        );
        if (!mouth) unexpected++;
      }
    }
    report(
      `[jackie2 street] stage barriers 6600-7570: ${out.join('; ')}; ${unexpected} gaps away from a junction`,
    );
    expect(unexpected).toBe(0);
  });
});
