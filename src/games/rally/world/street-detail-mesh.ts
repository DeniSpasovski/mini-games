import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
} from 'three';
import { getTexture } from '../engine/textures';
import { CROSS_LEN, KERB_H, KERB_W } from './street-detail';
import type { World } from './world';

/**
 * Kerbs + sidewalks along the streets near the stage road and zebra crosswalks at their junctions
 * (MapDef.cityStreets). Sidewalk runs / crossings come from street-detail.ts; each run is swept along its
 * street as a kerb face, kerb top, sidewalk and a buried outer face, merged per 256 m tile.
 */

const TILE = 256;
const STEP = 4;

class Acc {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  idx: number[] = [];
}

const KERB: [number, number, number] = [0.82, 0.8, 0.77];
const WALK: [number, number, number] = [0.9, 0.89, 0.86];
const EARTH: [number, number, number] = [0.32, 0.29, 0.25];

export function* streetDetailMeshJob(
  world: World,
): Generator<void, Group | undefined> {
  const cfg = world.map.cityStreets;
  const net = world.gen.paths;
  const detail = world.streetDetail;
  if (!cfg || !net || !detail) return undefined;
  const W = cfg.sidewalk ?? 1.5;
  const hf = world.analytic;
  const tiles = new Map<string, Acc>();
  const tileOf = (x: number, z: number): Acc => {
    const k = `${Math.floor(x / TILE)},${Math.floor(z / TILE)}`;
    let a = tiles.get(k);
    if (!a) tiles.set(k, (a = new Acc()));
    return a;
  };
  const pt = { x: 0, z: 0 };
  const nx = { x: 0, z: 0 };
  let n = 0;
  for (const run of detail.runs) {
    const rows: {
      x: number;
      z: number;
      y: number;
      tx: number;
      tz: number;
      d: number;
    }[] = [];
    for (let a = run.from; ; a += STEP) {
      const d = Math.min(a, run.to);
      net.pointAt(run.path, Math.max(0, d - 1.5), pt);
      net.pointAt(run.path, Math.min(net.lengths[run.path], d + 1.5), nx);
      const tl = Math.hypot(nx.x - pt.x, nx.z - pt.z) || 1;
      const tx = (nx.x - pt.x) / tl;
      const tz = (nx.z - pt.z) / tl;
      net.pointAt(run.path, d, pt);
      const hw = net.halfWidthAt(run.path, d);
      const lat = run.side * hw;
      const x = pt.x + tz * lat;
      const z = pt.z - tx * lat;
      // Street surface height at the edge (the ribbon sits 3 cm above the ground).
      rows.push({ x, z, y: hf.height(x, z) + 0.03, tx, tz, d });
      if (d >= run.to) break;
    }
    if (rows.length < 2) continue;
    const acc = tileOf(rows[0].x, rows[0].z);
    // Profile: (outward offset from the street edge, height above it); outward = away from the street centre.
    const prof: [number, number][] = [
      [0, 0],
      [0, KERB_H],
      [KERB_W, KERB_H],
      [KERB_W + W, KERB_H],
      [KERB_W + W, -0.3],
    ];
    const cols = [KERB, KERB, WALK, EARTH];
    const nors: [number, number][] = [
      [-1, 0],
      [0, 1],
      [0, 1],
      [1, 0],
    ];
    for (let s = 0; s < prof.length - 1; s++) {
      const v0 = acc.pos.length / 3;
      const [o0, y0] = prof[s];
      const [o1, y1] = prof[s + 1];
      for (const r of rows) {
        // left = (tz, -tx); outward for the left side is +left.
        const ox = r.tz * run.side;
        const oz = -r.tx * run.side;
        for (const [o, dy] of [
          [o0, y0],
          [o1, y1],
        ]) {
          acc.pos.push(r.x + ox * o, r.y + dy, r.z + oz * o);
          // The kerb face looks at the street (-outward), the tops up, the buried face outward.
          const [no, ny] = nors[s];
          acc.nor.push(ox * no, ny, oz * no);
          acc.col.push(...cols[s]);
          acc.uv.push(r.d / 3, o / 3);
        }
      }
      for (let i = 0; i < rows.length - 1; i++) {
        const q = v0 + i * 2;
        acc.idx.push(q, q + 2, q + 3, q, q + 3, q + 1);
      }
    }
    if (++n % 40 === 0) yield;
  }
  const group = new Group();
  group.name = 'street-detail';
  const mat = new MeshStandardMaterial({
    map: getTexture('sidewalk'),
    vertexColors: true,
    roughness: 0.95,
    metalness: 0,
    side: 2,
  });
  for (const acc of tiles.values()) {
    const g = new BufferGeometry();
    g.setAttribute(
      'position',
      new BufferAttribute(new Float32Array(acc.pos), 3),
    );
    g.setAttribute('normal', new BufferAttribute(new Float32Array(acc.nor), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(acc.col), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(acc.uv), 2));
    g.setIndex(acc.idx);
    g.computeBoundingSphere();
    const m = new Mesh(g, mat);
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    group.add(m);
    yield;
  }
  // Crosswalks: an alpha-tested zebra quad over the street surface; stop lines across the arriving half of the street.
  const cw = new Acc();
  const sl = new Acc();
  for (const c of detail.crossings) {
    const p = net.paths[c.path];
    const hw = p.width / 2;
    net.pointAt(c.path, c.at - 1.5, pt);
    net.pointAt(c.path, c.at + 1.5, nx);
    const tl = Math.hypot(nx.x - pt.x, nx.z - pt.z) || 1;
    const tx = (nx.x - pt.x) / tl;
    const tz = (nx.z - pt.z) / tl;
    net.pointAt(c.path, c.at, pt);
    const v0 = cw.pos.length / 3;
    for (const [dl, dla] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      // dl: across the street (left = (tz, -tx)), dla: along it.
      const x = pt.x + tz * hw * dl + tx * (CROSS_LEN / 2) * dla;
      const z = pt.z - tx * hw * dl + tz * (CROSS_LEN / 2) * dla;
      cw.pos.push(x, hf.height(x, z) + 0.05, z);
      cw.nor.push(0, 1, 0);
      cw.col.push(1, 1, 1);
      cw.uv.push((dl * hw + hw) / 4, dla > 0 ? 1 : 0);
    }
    cw.idx.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3);
    // Stop line 0.9 m short of the crosswalk, 0.45 m deep, on the right-hand half of the arriving traffic: that is the
    // +left half of a street whose junction is at its start, the -left half at its end.
    if (!p.oneway) {
      const half = c.atEnd ? -1 : 1;
      const out = c.atEnd ? -1 : 1;
      const s0 = CROSS_LEN / 2 + 0.9;
      const k0 = sl.pos.length / 3;
      for (const [dl, dla] of [
        [0.15, s0],
        [hw - 0.15, s0],
        [hw - 0.15, s0 + 0.45],
        [0.15, s0 + 0.45],
      ]) {
        const x = pt.x + tz * dl * half + tx * dla * out;
        const z = pt.z - tx * dl * half + tz * dla * out;
        sl.pos.push(x, hf.height(x, z) + 0.05, z);
        sl.nor.push(0, 1, 0);
        sl.col.push(0.92, 0.92, 0.88);
        sl.uv.push(0, 0);
      }
      sl.idx.push(k0, k0 + 1, k0 + 2, k0, k0 + 2, k0 + 3);
    }
  }
  if (sl.idx.length) {
    const g = new BufferGeometry();
    g.setAttribute(
      'position',
      new BufferAttribute(new Float32Array(sl.pos), 3),
    );
    g.setAttribute('normal', new BufferAttribute(new Float32Array(sl.nor), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(sl.col), 3));
    g.setIndex(sl.idx);
    g.computeBoundingSphere();
    const m = new Mesh(
      g,
      new MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.8,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -8,
        side: 2,
      }),
    );
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    group.add(m);
  }
  if (cw.idx.length) {
    const g = new BufferGeometry();
    g.setAttribute(
      'position',
      new BufferAttribute(new Float32Array(cw.pos), 3),
    );
    g.setAttribute('normal', new BufferAttribute(new Float32Array(cw.nor), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(cw.col), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(cw.uv), 2));
    g.setIndex(cw.idx);
    g.computeBoundingSphere();
    const m = new Mesh(
      g,
      new MeshStandardMaterial({
        map: getTexture('crosswalk'),
        vertexColors: true,
        alphaTest: 0.5,
        roughness: 0.8,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -8,
        side: 2,
      }),
    );
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    group.add(m);
  }
  return group.children.length ? group : undefined;
}
