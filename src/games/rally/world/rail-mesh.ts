import {
  BufferAttribute,
  BufferGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
} from 'three';
import { getTexture } from '../engine/textures';
import { newPathQuery } from './real-data';
import {
  BALLAST_H,
  BED_HALF,
  CONTACT_Y,
  CREST_HALF,
  GAUGE,
  MESSENGER_Y,
  RAIL_H,
  RAIL_HEAD,
  RAIL_KIND,
  STAGGER,
  type CatenaryMast,
} from './railways';
import { DECK_DEPTH } from './terrain-gen';
import type { World } from './world';

/**
 * Railway tracks (MapDef.railways, world/railways.ts): a textured ballast + sleeper strip on the carved bed, the two
 * rails as thin steel profiles, merged per 256 m tile; the catenary (contact wire zig-zagging between the mast
 * arms, messenger wire above with droppers) as one line mesh. The bed is broken where a road crosses at grade (the
 * road ribbon is the surface there); the rails run across.
 */

const STEP = 2; // m between rows
const TILE = 256;
/** Across the bed: offset from the centre (m) and height over the formation. */
const BED: [number, number][] = [
  [-BED_HALF, 0],
  [-CREST_HALF, BALLAST_H],
  [CREST_HALF, BALLAST_H],
  [BED_HALF, 0],
];
/** Metres of track per texture repeat along it (two sleepers). */
const TEX_V = 1.2;
const LIFT = 0.03;
const STEEL_TOP = [0.79, 0.78, 0.75];
const STEEL_SIDE = [0.37, 0.3, 0.26];

interface Soup {
  pos: number[];
  uv: number[];
  col: number[];
  idx: number[];
}
const soup = (): Soup => ({ pos: [], uv: [], col: [], idx: [] });

let bedMat: MeshStandardMaterial | undefined;
let railMat: MeshStandardMaterial | undefined;

function materials(): [MeshStandardMaterial, MeshStandardMaterial] {
  bedMat ??= Object.assign(
    new MeshStandardMaterial({
      map: getTexture('rail_track'),
      bumpMap: getTexture('rail_track'),
      bumpScale: 1.4,
      roughness: 0.92,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    }),
    { defines: { RALLY_GROUND: 1 } },
  );
  railMat ??= new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.42,
    metalness: 0.55,
  });
  return [bedMat, railMat];
}

export function* railMeshJob(world: World): Generator<void, Group | undefined> {
  const gen = world.gen;
  const net = gen.paths;
  const rails = gen.railPaths();
  if (!net || !rails.length) return undefined;
  const bed = new Map<string, Soup>();
  const steel = new Map<string, Soup>();
  const tileOf = (m: Map<string, Soup>, x: number, z: number): Soup => {
    const k = `${Math.floor(x / TILE)},${Math.floor(z / TILE)}`;
    let s = m.get(k);
    if (!s) m.set(k, (s = soup()));
    return s;
  };
  const p = { x: 0, z: 0 };
  const q = { x: 0, z: 0 };
  const pq = newPathQuery();
  // A road crossing the track at grade (not a deck over it).
  const crossing = (x: number, z: number): boolean =>
    net.query(
      x,
      z,
      pq,
      'tarmac',
      (pi) => net.paths[pi].kind !== RAIL_KIND && !net.paths[pi].bridge,
    ).found && pq.distance <= pq.halfWidth + 0.3;

  for (const pi of rails) {
    const L = net.lengths[pi];
    const n = Math.max(1, Math.ceil(L / STEP));
    // Rows: centre, left normal, formation height, crossing flag.
    const rows: {
      x: number;
      z: number;
      nx: number;
      nz: number;
      y: number;
      a: number;
      cross: boolean;
    }[] = [];
    for (let i = 0; i <= n; i++) {
      const a = (L * i) / n;
      net.pointAt(pi, Math.max(0, a - 1), p);
      net.pointAt(pi, Math.min(L, a + 1), q);
      const tx = q.x - p.x;
      const tz = q.z - p.z;
      const l = Math.hypot(tx, tz) || 1;
      net.pointAt(pi, a, p);
      rows.push({
        x: p.x,
        z: p.z,
        nx: tz / l,
        nz: -tx / l,
        y: gen.pathHeight(pi, a),
        a,
        cross: crossing(p.x, p.z),
      });
    }
    // Runs of rows in one tile (the boundary row is repeated so the strip has no gap).
    let start = 0;
    while (start < rows.length - 1) {
      const t0 = `${Math.floor(rows[start].x / TILE)},${Math.floor(rows[start].z / TILE)}`;
      let end = start + 1;
      while (
        end < rows.length - 1 &&
        `${Math.floor(rows[end].x / TILE)},${Math.floor(rows[end].z / TILE)}` ===
          t0
      )
        end++;
      const run = rows.slice(start, end + 1);
      const r0 = run[0];
      // Ballast strip (skipping the rows on a level crossing).
      const b = tileOf(bed, r0.x, r0.z);
      for (let k = 0; k + 1 < run.length; k++) {
        if (run[k].cross || run[k + 1].cross) continue;
        const base = b.pos.length / 3;
        for (const r of [run[k], run[k + 1]])
          for (const [off, dy] of BED) {
            b.pos.push(r.x + r.nx * off, r.y + dy + LIFT, r.z + r.nz * off);
            b.uv.push((off + BED_HALF) / (2 * BED_HALF), r.a / TEX_V);
          }
        const c = BED.length;
        for (let j = 0; j + 1 < c; j++) {
          const a0 = base + j;
          const a1 = base + j + 1;
          const d0 = base + c + j;
          const d1 = base + c + j + 1;
          // Faces up (column j + 1 lies left of j, as in the road ribbon).
          b.idx.push(a0, d0, d1, a0, d1, a1);
        }
      }
      // Rails: a head profile (top + two sides) at +/- gauge / 2.
      const s = tileOf(steel, r0.x, r0.z);
      const top = BALLAST_H + RAIL_H + LIFT;
      for (const side of [-1, 1]) {
        const lat = (side * (GAUGE + RAIL_HEAD)) / 2;
        // Faces: [offset a, offset b, y a, y b, colour].
        const faces: [number, number, number, number, number[]][] = [
          [lat - RAIL_HEAD / 2, lat + RAIL_HEAD / 2, top, top, STEEL_TOP],
          [
            lat - RAIL_HEAD / 2,
            lat - RAIL_HEAD / 2,
            BALLAST_H,
            top,
            STEEL_SIDE,
          ],
          [
            lat + RAIL_HEAD / 2,
            lat + RAIL_HEAD / 2,
            top,
            BALLAST_H,
            STEEL_SIDE,
          ],
        ];
        for (const [oa, ob, ya, yb, col] of faces) {
          const base = s.pos.length / 3;
          for (const r of run) {
            s.pos.push(r.x + r.nx * oa, r.y + ya, r.z + r.nz * oa);
            s.pos.push(r.x + r.nx * ob, r.y + yb, r.z + r.nz * ob);
            s.col.push(...col, ...col);
          }
          for (let k = 0; k + 1 < run.length; k++) {
            const a0 = base + k * 2;
            const a1 = a0 + 1;
            const d0 = a0 + 2;
            const d1 = a0 + 3;
            s.idx.push(a0, d0, d1, a0, d1, a1);
          }
        }
      }
      start = end;
    }
    yield;
  }

  const [bm, rm] = materials();
  const group = new Group();
  group.name = 'railways';
  const add = (
    m: Map<string, Soup>,
    mat: MeshStandardMaterial,
    rail: boolean,
  ) => {
    for (const s of m.values()) {
      if (!s.idx.length) continue;
      const g = new BufferGeometry();
      g.setAttribute(
        'position',
        new BufferAttribute(new Float32Array(s.pos), 3),
      );
      if (rail)
        g.setAttribute(
          'color',
          new BufferAttribute(new Float32Array(s.col), 3),
        );
      else g.setAttribute('uv', new BufferAttribute(new Float32Array(s.uv), 2));
      g.setIndex(s.idx);
      g.computeVertexNormals();
      g.computeBoundingSphere();
      const mesh = new Mesh(g, mat);
      mesh.receiveShadow = true;
      mesh.castShadow = rail;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
  };
  add(bed, bm, false);
  add(steel, rm, true);
  const wires = catenaryWires(world, world.catenary);
  if (wires) group.add(wires);
  return group;
}

/** Contact + messenger wires between consecutive masts of a track, droppers between them (one line mesh). */
function catenaryWires(
  world: World,
  masts: readonly CatenaryMast[],
): LineSegments | undefined {
  if (!masts.length) return undefined;
  const gen = world.gen;
  const net = gen.paths!;
  const byPath = new Map<number, CatenaryMast[]>();
  for (const m of masts) {
    const arr = byPath.get(m.path) ?? [];
    arr.push(m);
    byPath.set(m.path, arr);
  }
  const out: number[] = [];
  const p = { x: 0, z: 0 };
  for (const [pi, arr] of byPath) {
    arr.sort((a, b) => a.along - b.along);
    for (let i = 0; i + 1 < arr.length; i++) {
      const A = arr[i];
      const B = arr[i + 1];
      const span = B.along - A.along;
      if (span > 150) continue;
      // The contact wire hangs at the arm tips: the track centre at each mast, staggered left / right.
      const tip = (m: CatenaryMast, k: number) => {
        net.pointAt(pi, m.along, p);
        const st = (k % 2 ? 1 : -1) * STAGGER;
        return {
          x: p.x - m.az * st,
          z: p.z + m.ax * st,
          y: gen.pathHeight(pi, m.along),
        };
      };
      const ta = tip(A, i);
      const tb = tip(B, i + 1);
      const n = Math.max(2, Math.round(span / 9));
      let prevC: number[] | undefined;
      let prevM: number[] | undefined;
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        const x = ta.x + (tb.x - ta.x) * t;
        const z = ta.z + (tb.z - ta.z) * t;
        const y0 = ta.y + (tb.y - ta.y) * t;
        // Under a road deck the wires drop to clear its girders.
        const deck = gen.otherDeckAt(x, z, 1.5);
        const roof = Number.isNaN(deck) ? Infinity : deck - DECK_DEPTH - 0.15;
        const c = [x, Math.min(y0 + CONTACT_Y, roof - 0.25), z];
        const sag = 4 * 0.45 * t * (1 - t);
        const m = [x, Math.min(y0 + MESSENGER_Y - sag, roof), z];
        if (prevC) out.push(...prevC, ...c);
        if (prevM) out.push(...prevM, ...m);
        if (k > 0 && k < n && m[1] - c[1] > 0.1) out.push(...c, ...m);
        prevC = c;
        prevM = m;
      }
    }
  }
  if (!out.length) return undefined;
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(out), 3));
  g.computeBoundingSphere();
  const lines = new LineSegments(
    g,
    new LineBasicMaterial({ color: '#3a3a36' }),
  );
  lines.matrixAutoUpdate = false;
  lines.name = 'catenary';
  return lines;
}
