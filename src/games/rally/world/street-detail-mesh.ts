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
import { GroundTerrain } from './heightfield';

/**
 * Kerbs + sidewalks along the streets near the stage road and zebra crosswalks at their junctions
 * (MapDef.cityStreets). Sidewalk runs / crossings come from street-detail.ts; each run is swept along its
 * street as a kerb face, kerb top, sidewalk and a buried outer face, merged per 256 m tile.
 */

const TILE = 256;
const STEP = 4;
/** Length of a dropped kerb at a sidewalk's free end (m). */
const DROP = 1.5;
/** A run end this close to the end of a link (m) carries on into it; spacing of a link's rows (m). */
const LINK_REACH = 0.3;
const LINK_STEP = 0.5;
const total = (line: [number, number][]): number =>
  line.reduce(
    (s, p, i) =>
      i ? s + Math.hypot(p[0] - line[i - 1][0], p[1] - line[i - 1][1]) : 0,
    0,
  );

class Acc {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  idx: number[] = [];
}

const KERB: [number, number, number] = [0.66, 0.65, 0.62];
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
  type Row = {
    x: number;
    z: number;
    y: number;
    /** Sidewalk top above `y`: the kerb height, more where the land beside the street rises over it. */
    top: number;
    /** Bottom of the outer face below `y`: under the ground beside the sidewalk, however far that falls away. */
    foot: number;
    tx: number;
    tz: number;
    d: number;
  };
  // A bank beside the street (the land blends back up from the edge) buried the flat sidewalk: lift it clear.
  const row = (
    x: number,
    z: number,
    y: number,
    tx: number,
    tz: number,
    d: number,
    side: number,
    deck: boolean,
  ): Row => {
    let land = -Infinity;
    if (!deck)
      for (const o of [KERB_W + W * 0.5, KERB_W + W])
        land = Math.max(land, hf.height(x + tz * side * o, z - tx * side * o));
    const top = KERB_H + Math.min(0.6, Math.max(0, land + 0.02 - y - KERB_H));
    const o = KERB_W + W;
    const foot = deck
      ? -0.3
      : Math.min(
          -0.3,
          hf.height(x + tz * side * o, z - tx * side * o) - y - 0.1,
        );
    return { x, z, y, top, foot, tx, tz, d };
  };
  // Kerb face, kerb top, sidewalk and a buried outer face swept along the rows.
  const sweep = (rows: Row[], side: number) => {
    if (rows.length < 2) return;
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
        const ox = r.tz * side;
        const oz = -r.tx * side;
        for (const [o, dy] of [
          [o0, y0],
          [o1, y1],
        ]) {
          acc.pos.push(
            r.x + ox * o,
            r.y + (dy === KERB_H ? r.top : dy === -0.3 ? r.foot : dy),
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
    // End caps: the sweep is a closed solid (an open end showed the inside of the kerb, see-through).
    for (const [r, dir] of [
      [rows[0], -1],
      [rows[rows.length - 1], 1],
    ] as const) {
      const ox = r.tz * side;
      const oz = -r.tx * side;
      const v0 = acc.pos.length / 3;
      for (const [o, dy] of [
        [0, r.foot],
        [0, r.top],
        [KERB_W + W, r.top],
        [KERB_W + W, r.foot],
      ]) {
        acc.pos.push(r.x + ox * o, r.y + dy, r.z + oz * o);
        acc.nor.push(r.tx * dir, 0, r.tz * dir);
        acc.col.push(...WALK);
        acc.uv.push(o / 3, dy / 3);
      }
      // (foot, top, outer top) winds to face -side x tangent: flipped where that is not `dir`
      if (side * dir < 0) acc.idx.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3);
      else acc.idx.push(v0, v0 + 2, v0 + 1, v0, v0 + 3, v0 + 2);
    }
  };
  let n = 0;
  for (const run of detail.runs) {
    const PL = net.lengths[run.path];
    const c0 = run.from <= 0.01 ? cont(run.path, false) : undefined;
    const c1 = run.to >= PL - 0.01 ? cont(run.path, true) : undefined;
    // A run end that meets no corner return or continuing way is a dropped kerb (a crossing, a driveway): the kerb
    // and the sidewalk slope down to the street over DROP m instead of ending in a cut slab.
    const turns = (atEnd: boolean) =>
      detail.returns.some(
        (c) =>
          c.path === run.path &&
          c.side === run.side &&
          c.atEnd === atEnd &&
          Math.abs(c.along - (atEnd ? run.to : run.from)) < 0.05,
      );
    // ... or one a hand-placed link (`CityStreets.links`) carries on from.
    const linked = (d: number): boolean => {
      net.pointAt(run.path, Math.max(0, d - 1.5), pt);
      net.pointAt(run.path, Math.min(PL, d + 1.5), nx);
      const tl = Math.hypot(nx.x - pt.x, nx.z - pt.z) || 1;
      net.pointAt(run.path, d, pt);
      const lat = run.side * net.halfWidthAt(run.path, d);
      const x = pt.x + ((nx.z - pt.z) / tl) * lat;
      const z = pt.z - ((nx.x - pt.x) / tl) * lat;
      return detail.links.some((l) =>
        [0, l.pts.length - 2].some(
          (k) => Math.hypot(l.pts[k] - x, l.pts[k + 1] - z) < LINK_REACH,
        ),
      );
    };
    const free0 = !c0 && !turns(false) && !linked(run.from);
    const free1 = !c1 && !turns(true) && !linked(run.to);
    const len = run.to - run.from;
    const drop = Math.min(DROP, len / 3);
    const at: number[] = [];
    for (let a = run.from; a < run.to; a += STEP) at.push(a);
    at.push(run.to);
    if (free0) at.push(run.from + drop);
    if (free1) at.push(run.to - drop);
    at.sort((p, q) => p - q);
    const rows: Row[] = [];
    for (const [i, d] of at.entries()) {
      if (i > 0 && d - at[i - 1] < 0.05) continue;
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
      const r = row(x, z, y, tx, tz, d, run.side, onDeck(run.path));
      const f = Math.min(
        1,
        free0 ? (d - run.from) / drop : 1,
        free1 ? (run.to - d) / drop : 1,
      );
      r.top = 0.02 + (r.top - 0.02) * f;
      rows.push(r);
    }
    sweep(rows, run.side);
    if (++n % 40 === 0) yield;
  }
  // Kerb returns: the sidewalk follows each rounded junction corner from the street edge (B) onto the stage road
  // edge (A), its kerb dropping to the road there (no step left standing at the stage road).
  for (const c of detail.returns) {
    const arc = c.arc;
    const [mx, mz] = arc[arc.length >> 1];
    let dist = c.along;
    let total = 0;
    for (let k = 1; k < arc.length; k++)
      total += Math.hypot(arc[k][0] - arc[k - 1][0], arc[k][1] - arc[k - 1][1]);
    let run = 0;
    let side: 1 | -1 = 1;
    const rows: Row[] = [];
    for (let k = 0; k < arc.length; k++) {
      const [x, z] = arc[k];
      const [ax, az] = arc[Math.max(0, k - 1)];
      const [bx, bz] = arc[Math.min(arc.length - 1, k + 1)];
      const tl = Math.hypot(bx - ax, bz - az) || 1;
      const tx = (bx - ax) / tl;
      const tz = (bz - az) / tl;
      // Outward (away from the street) = away from the corner C, which the tarmac fills.
      if (k === 0) side = tz * (mx - c.c[0]) - tx * (mz - c.c[1]) >= 0 ? 1 : -1;
      if (k > 0) {
        const step = Math.hypot(x - arc[k - 1][0], z - arc[k - 1][1]);
        dist += step;
        run += step;
      }
      const r = row(x, z, hf.height(x, z) + 0.03, tx, tz, dist, side, false);
      // The last third drops to a flush kerb at the stage road edge.
      const f = Math.min(1, (total - run) / (total / 3));
      r.top = 0.02 + (r.top - 0.02) * f;
      rows.push(r);
    }
    sweep(rows, side);
  }
  // Hand-placed links: the kerb line resampled, a dropped kerb at an end on a road.
  for (const l of detail.links) {
    const line: [number, number][] = [];
    for (let i = 0; i + 3 < l.pts.length; i += 2) {
      const [ax, az, bx, bz] = l.pts.slice(i, i + 4);
      const k = Math.max(
        1,
        Math.ceil(Math.hypot(bx - ax, bz - az) / LINK_STEP),
      );
      for (let j = 0; j < k; j++)
        line.push([ax + ((bx - ax) * j) / k, az + ((bz - az) * j) / k]);
    }
    line.push([l.pts[l.pts.length - 2], l.pts[l.pts.length - 1]]);
    const rows: Row[] = [];
    let dist = 0;
    for (let i = 0; i < line.length; i++) {
      const [x, z] = line[i];
      const [ax, az] = line[Math.max(0, i - 1)];
      const [bx, bz] = line[Math.min(line.length - 1, i + 1)];
      const tl = Math.hypot(bx - ax, bz - az) || 1;
      if (i > 0) dist += Math.hypot(x - line[i - 1][0], z - line[i - 1][1]);
      const r = row(
        x,
        z,
        hf.height(x, z) + 0.03,
        (bx - ax) / tl,
        (bz - az) / tl,
        dist,
        l.side,
        false,
      );
      const f = Math.min(
        1,
        l.dropStart ? dist / DROP : 1,
        l.dropEnd ? (total(line) - dist) / DROP : 1,
      );
      r.top = 0.02 + (r.top - 0.02) * f;
      rows.push(r);
    }
    sweep(rows, l.side);
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
      cw.pos.push(x, surfaceY(c.path, c.at, x, z) + 0.02, z);
      cw.nor.push(0, 1, 0);
      cw.col.push(1, 1, 1);
      cw.uv.push((dl * hw + hw) / 4, dla > 0 ? 1 : 0);
    }
    // Wound to face up (a back face gets its normal flipped: the zebras were lit from below, dark green-grey).
    cw.idx.push(v0, v0 + 2, v0 + 1, v0, v0 + 3, v0 + 2);
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
