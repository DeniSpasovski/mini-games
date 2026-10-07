import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
} from 'three';
import { getTexture } from '../engine/textures';
import { CROSS_LEN, KERB_H, KERB_W } from './street-detail';
import { hasMarkings } from './street-markings';
import type { World } from './world';
import { GroundTerrain } from './heightfield';

/**
 * Kerbs + sidewalks along the streets near the stage road and zebra crosswalks at their junctions
 * (MapDef.cityStreets). Sidewalk runs / crossings come from street-detail.ts; each run is swept along its
 * street as a kerb face, kerb top, sidewalk and a buried outer face, merged per 256 m tile.
 */

const TILE = 256;
const STEP = 4;
/** Driveway kerb cut: the kerb drops to this height (m) across the driveway, over a ramp this long each side (m). */
const CUT_H = 0.025;
const CUT_RAMP = 1;

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
/** Tree lawn between the kerb and the sidewalk (tints the sidewalk texture). */
const LAWN: [number, number, number] = [0.42, 0.54, 0.27];

export function* streetDetailMeshJob(
  world: World,
): Generator<void, Group | undefined> {
  const cfg = world.map.cityStreets;
  const net = world.gen.paths;
  const detail = world.streetDetail;
  if (!cfg || !net || !detail) return undefined;
  // The ground, not the top surface: a street under a stage-road bridge stays down in its underpass.
  const hf = new GroundTerrain(world.gen);
  const tiles = new Map<string, Acc>();
  const tileOf = (x: number, z: number): Acc => {
    const k = `${Math.floor(x / TILE)},${Math.floor(z / TILE)}`;
    let a = tiles.get(k);
    if (!a) tiles.set(k, (a = new Acc()));
    return a;
  };
  const pt = { x: 0, z: 0 };
  const nx = { x: 0, z: 0 };
  // A street deck on a portal slab carries sidewalks too: its surface is the deck profile, not the ground.
  const onDeck = (pi: number) => !!net.paths[pi].bridge;
  const surfaceY = (pi: number, d: number, x: number, z: number) =>
    (onDeck(pi) ? world.gen.pathHeight(pi, d) : hf.height(x, z)) + 0.03;
  // Direction of the way that continues `pi` at its start / end (exactly one other way there), pointing along `pi`:
  // the sidewalk ends are mitred to the mean direction so the two runs meet at a bend (no wedge / step).
  const cont = (pi: number, atEnd: boolean): [number, number] | undefined => {
    const L = net.lengths[pi];
    net.pointAt(pi, atEnd ? L : 0, pt);
    let hit: [number, number] | undefined;
    let count = 0;
    net.paths.forEach((_q, qi) => {
      if (qi === pi) return;
      const QL = net.lengths[qi];
      for (const qEnd of [false, true]) {
        net.pointAt(qi, qEnd ? QL : 0, nx);
        if (Math.abs(nx.x - pt.x) > 0.5 || Math.abs(nx.z - pt.z) > 0.5)
          continue;
        count++;
        const c = { x: 0, z: 0 };
        net.pointAt(qi, qEnd ? Math.max(0, QL - 3) : Math.min(QL, 3), c);
        let dx = c.x - nx.x;
        let dz = c.z - nx.z;
        if (!atEnd) [dx, dz] = [-dx, -dz];
        const l = Math.hypot(dx, dz) || 1;
        hit = [dx / l, dz / l];
      }
    });
    return count === 1 ? hit : undefined;
  };
  interface Row {
    x: number;
    z: number;
    y: number;
    /** Sidewalk top above `y`: the kerb height, more where the land beside the street rises over it. */
    top: number;
    tx: number;
    tz: number;
    d: number;
  }
  /**
   * Kerb face, kerb top, (tree lawn,) sidewalk and a buried outer face swept along `rows` (outward = left of travel when
   * side is +1). `lawn` m of grass between the kerb and the paving (PathDef.lawn).
   */
  const sweep = (rows: Row[], side: number, W: number, lawn = 0) => {
    const acc = tileOf(rows[0].x, rows[0].z);
    // Profile: (outward offset from the street edge, height above it); outward = away from the street centre.
    const L = lawn > 0.2 ? lawn : 0;
    const prof: [number, number][] = [
      [0, 0],
      [0, KERB_H],
      [KERB_W, KERB_H],
      ...(L ? [[KERB_W + L, KERB_H] as [number, number]] : []),
      [KERB_W + L + W, KERB_H],
      [KERB_W + L + W, -0.3],
    ];
    const cols = L
      ? [KERB, KERB, LAWN, WALK, EARTH]
      : [KERB, KERB, WALK, EARTH];
    const nors: [number, number][] = [
      [-1, 0],
      [0, 1],
      ...(L ? [[0, 1] as [number, number]] : []),
      [0, 1],
      [1, 0],
    ];
    for (let s = 0; s < prof.length - 1; s++) {
      const v0 = acc.pos.length / 3;
      const [o0, y0] = prof[s];
      const [o1, y1] = prof[s + 1];
      for (const r of rows) {
        // left = (tz, -tx); outward for the left side is +left.
        const ox = r.tz * side;
        const oz = -r.tx * side;
        for (const [o, dy] of [
          [o0, y0],
          [o1, y1],
        ]) {
          acc.pos.push(
            r.x + ox * o,
            r.y + (dy === KERB_H ? r.top : dy),
            r.z + oz * o,
          );
          // The kerb face looks at the street (-outward), the tops up, the buried face outward.
          const [no, ny] = nors[s];
          acc.nor.push(ox * no, ny, oz * no);
          acc.col.push(...cols[s]);
          acc.uv.push(r.d / 3, o / 3);
        }
      }
      // Front faces up / outward on both sides (the material is double sided: a back face gets its normal flipped
      // and the right-hand sidewalk of every street rendered black).
      for (let i = 0; i < rows.length - 1; i++) {
        const q = v0 + i * 2;
        if (side > 0) acc.idx.push(q, q + 2, q + 3, q, q + 3, q + 1);
        else acc.idx.push(q, q + 3, q + 2, q, q + 1, q + 3);
      }
    }
  };
  let n = 0;
  for (const run of detail.runs) {
    const PL = net.lengths[run.path];
    const c0 = run.from <= 0.01 ? cont(run.path, false) : undefined;
    const c1 = run.to >= PL - 0.01 ? cont(run.path, true) : undefined;
    const rows: {
      x: number;
      z: number;
      y: number;
      /** Sidewalk top above `y`: the kerb height, more where the land beside the street rises over it. */
      top: number;
      tx: number;
      tz: number;
      d: number;
    }[] = [];
    // the samples: every STEP m, plus the edges of the driveway cuts and their ramps
    const at: number[] = [];
    for (let a = run.from; a < run.to; a += STEP) at.push(a);
    at.push(run.to);
    for (const [c0, c1] of run.cuts ?? [])
      for (const a of [c0 - CUT_RAMP, c0, c1, c1 + CUT_RAMP])
        if (a > run.from && a < run.to) at.push(a);
    at.sort((u, v) => u - v);
    /** Kerb drop at `d`: 1 = full kerb, 0 = flush (a driveway). */
    const kerbAt = (d: number): number => {
      let f = 1;
      for (const [c0, c1] of run.cuts ?? []) {
        const out = Math.max(c0 - d, d - c1, 0);
        f = Math.min(f, Math.min(1, out / CUT_RAMP));
      }
      return f;
    };
    for (const a of at) {
      const d = a;
      net.pointAt(run.path, Math.max(0, d - 1.5), pt);
      net.pointAt(run.path, Math.min(net.lengths[run.path], d + 1.5), nx);
      const tl = Math.hypot(nx.x - pt.x, nx.z - pt.z) || 1;
      let tx = (nx.x - pt.x) / tl;
      let tz = (nx.z - pt.z) / tl;
      const j = d <= 0.01 ? c0 : d >= PL - 0.01 ? c1 : undefined;
      if (j) {
        tx = (tx + j[0]) / 2;
        tz = (tz + j[1]) / 2;
        const l = Math.hypot(tx, tz) || 1;
        tx /= l;
        tz /= l;
      }
      net.pointAt(run.path, d, pt);
      const hw = net.halfWidthAt(run.path, d);
      const lat = run.side * hw;
      const x = pt.x + tz * lat;
      const z = pt.z - tx * lat;
      // Street surface height at the edge (the ribbon / deck surface sits 3 cm above its ground / profile).
      const y = surfaceY(run.path, d, x, z);
      // A bank beside the street (the land blends back up from the edge) buried the flat sidewalk: lift it clear.
      let land = -Infinity;
      if (!onDeck(run.path))
        for (const o of [KERB_W + run.width * 0.5, KERB_W + run.width])
          land = Math.max(
            land,
            hf.height(x + tz * run.side * o, z - tx * run.side * o),
          );
      const f = kerbAt(d);
      const top =
        f < 1
          ? CUT_H + (KERB_H - CUT_H) * f
          : KERB_H + Math.min(0.6, Math.max(0, land + 0.02 - y - KERB_H));
      if (rows.length && d - rows[rows.length - 1].d < 0.05) continue;
      rows.push({ x, z, y, top, tx, tz, d });
    }
    if (rows.length < 2) continue;
    const lawn = net.paths[run.path].lawn?.[run.side > 0 ? 0 : 1] ?? 0;
    sweep(rows, run.side, run.width, lawn);
    if (++n % 40 === 0) yield;
  }
  // Rounded kerb corners (street-detail.ts `Corner`): the kerb + sidewalk swept round the fillet arc, and the sliver between
  // the arc and the corner point of the two kerb lines paved (the corner of the block was cut off).
  const fills = new Map<string, Acc>();
  for (const c of detail.corners) {
    const N = Math.max(4, Math.ceil((Math.abs(c.sweep) * c.radius) / 0.8));
    const sgn = Math.sign(c.sweep) || 1;
    const rows: Row[] = [];
    let side = 1;
    for (let k = 0; k <= N; k++) {
      const al = c.a0 + (c.sweep * k) / N;
      const x = c.cx + Math.cos(al) * c.radius;
      const z = c.cz + Math.sin(al) * c.radius;
      const tx = -Math.sin(al) * sgn;
      const tz = Math.cos(al) * sgn;
      // outward (away from the street) is towards the arc's centre: the sidewalk lies inside the block corner
      const ox = (c.cx - x) / c.radius;
      const oz = (c.cz - z) / c.radius;
      if (k === 0) side = tz * ox - tx * oz > 0 ? 1 : -1;
      const y = hf.height(x, z) + 0.03;
      let land = -Infinity;
      for (const o of [KERB_W + c.width * 0.5, KERB_W + c.width])
        land = Math.max(land, hf.height(x + ox * o, z + oz * o));
      const top = KERB_H + Math.min(0.6, Math.max(0, land + 0.02 - y - KERB_H));
      rows.push({ x, z, y, top, tx, tz, d: k });
    }
    sweep(rows, side, c.width);
    // the paved sliver: a fan from the corner point over the arc
    const acc =
      fills.get(`${Math.floor(c.px / TILE)},${Math.floor(c.pz / TILE)}`) ??
      new Acc();
    fills.set(`${Math.floor(c.px / TILE)},${Math.floor(c.pz / TILE)}`, acc);
    const v0 = acc.pos.length / 3;
    const pts: [number, number][] = [[c.px, c.pz]];
    for (let k = 0; k <= N; k++) {
      const al = c.a0 + (c.sweep * k) / N;
      pts.push([
        c.cx + Math.cos(al) * c.radius,
        c.cz + Math.sin(al) * c.radius,
      ]);
    }
    for (const [x, z] of pts) {
      acc.pos.push(x, hf.height(x, z) + 0.03, z);
      acc.nor.push(0, 1, 0);
      acc.col.push(1, 1, 1);
      acc.uv.push(x / 8, z / 8);
    }
    for (let k = 1; k < pts.length - 1; k++) {
      const cross =
        (pts[k][0] - c.px) * (pts[k + 1][1] - c.pz) -
        (pts[k][1] - c.pz) * (pts[k + 1][0] - c.px);
      if (cross < 0) acc.idx.push(v0, v0 + k, v0 + k + 1);
      else acc.idx.push(v0, v0 + k + 1, v0 + k);
    }
  }
  const group = new Group();
  group.name = 'street-detail';
  const mat = new MeshStandardMaterial({
    map: getTexture('sidewalk'),
    bumpMap: getTexture('sidewalk'),
    bumpScale: 1,
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
  if (fills.size) {
    const asphalt = new MeshStandardMaterial({
      map: getTexture('junction_asphalt'),
      bumpMap: getTexture('junction_asphalt'),
      bumpScale: 1.2,
      roughness: 0.86,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2,
      side: 2,
    });
    for (const acc of fills.values()) {
      const g = new BufferGeometry();
      g.setAttribute(
        'position',
        new BufferAttribute(new Float32Array(acc.pos), 3),
      );
      g.setAttribute(
        'normal',
        new BufferAttribute(new Float32Array(acc.nor), 3),
      );
      g.setAttribute('uv', new BufferAttribute(new Float32Array(acc.uv), 2));
      g.setIndex(acc.idx);
      g.computeBoundingSphere();
      const m = new Mesh(g, asphalt);
      m.receiveShadow = true;
      m.matrixAutoUpdate = false;
      group.add(m);
    }
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
      cw.pos.push(x, surfaceY(c.path, c.at, x, z) + 0.02, z);
      cw.nor.push(0, 1, 0);
      cw.col.push(1, 1, 1);
      cw.uv.push((dl * hw + hw) / 4, dla > 0 ? 1 : 0);
    }
    // Wound to face up (a back face gets its normal flipped: the zebras were lit from below, dark green-grey).
    cw.idx.push(v0, v0 + 2, v0 + 1, v0, v0 + 3, v0 + 2);
    // Stop line 0.9 m short of the crosswalk, 0.45 m deep, on the right-hand half of the arriving traffic: that is the
    // +left half of a street whose junction is at its start, the -left half at its end. (A modelled street gets its
    // stop bar from the marking layer, street-glyphs.ts, laid out on its lanes.)
    if (!p.oneway && !hasMarkings(p)) {
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
        sl.pos.push(x, surfaceY(c.path, c.at, x, z) + 0.02, z);
        sl.nor.push(0, 1, 0);
        sl.col.push(0.92, 0.92, 0.88);
        sl.uv.push(0, 0);
      }
      sl.idx.push(k0, k0 + 2, k0 + 1, k0, k0 + 3, k0 + 2);
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
