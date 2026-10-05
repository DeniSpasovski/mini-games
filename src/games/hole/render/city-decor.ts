import {
  Color,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
} from 'three';
import { Rng } from '../../../shared/rng';
import { getItem } from '../items/catalog';
import { COLORS } from '../map/generate';
import { CANAL_Y, ROAD_Y } from '../map/spawn';
import { coastRadius, type GroundRect, type MapData } from '../map/types';
import { createGroundMaterial } from './materials';
import { Soup } from './soup';
import { WATER_Y } from './water';

/**
 * Non-edible City Island dressing, derived from the map data only (rects, blocks, placements, coast)
 * with its own seeded RNG, so it never changes item placement, points or scores:
 * the canal's deep centre stripe and foam edges plus the bridge parapets, curbs round every block,
 * roundabouts at the middle crossings, road decals (stop lines, lane arrows,
 * manholes, parking-bay ticks around the cars parked at the kerb), rocks at the waterline and a pier
 * at the harbour. Decals and curbs are stencil-cut ground (the hole opens through them) in 96 m
 * chunks, so the camera only draws the cells it sees.
 */
const CHUNK = 96;
const DECAL_Y = 0.026;

const DECAL = {
  white: COLORS.mark,
  manhole: 0x2e3136,
  manholeRim: 0x3a3e44,
  curbTop: 0xdedacd,
  curbSide: 0xa9a496,
  islandRing: 0xdad5c6,
  islandGrass: 0x6bbd5a,
};

/** Cars that park at the kerb (see `sidewalkFurniture` in map/generate.ts). */
const PARKED = new Set([
  'car_sedan',
  'taxi',
  'car_compact',
  'police_car',
  'pickup',
  'van',
]);

interface Arm {
  /** Axis the road runs along. */
  axis: 'x' | 'z';
  /** Centre line across the road (x for a z road, z for an x road). */
  mid: number;
  /** Extent along the axis. */
  t0: number;
  t1: number;
}

export function buildCityDecor(map: MapData): Group {
  const group = new Group();
  const rng = new Rng(map.seed * 4099 + 71);
  const groundMat = createGroundMaterial();

  // ---- chunked soups ----------------------------------------------------------------------
  const chunks = new Map<number, Soup>();
  const soupAt = (x: number, z: number): Soup => {
    const cx = Math.floor(x / CHUNK);
    const cz = Math.floor(z / CHUNK);
    const k = (cx + 512) * 1024 + (cz + 512);
    let s = chunks.get(k);
    if (!s) chunks.set(k, (s = new Soup()));
    return s;
  };

  // ---- road arms + crossings from the road rects ------------------------------------------
  const roads = map.rects.filter((r) => r.color === COLORS.road);
  const arms: Arm[] = [];
  const crossings: GroundRect[] = [];
  for (const r of roads) {
    const w = r.x1 - r.x0;
    const d = r.z1 - r.z0;
    if (Math.max(w, d) < 20) crossings.push(r);
    else if (d > w)
      arms.push({ axis: 'z', mid: (r.x0 + r.x1) / 2, t0: r.z0, t1: r.z1 });
    else arms.push({ axis: 'x', mid: (r.z0 + r.z1) / 2, t0: r.x0, t1: r.x1 });
  }
  /** World point for an arm: `t` along the road, `s` across it (+ = east for a z road, south for an x road). */
  const pt = (a: Arm, t: number, s: number): [number, number] =>
    a.axis === 'z' ? [a.mid + s, t] : [t, a.mid + s];
  /** Quad along an arm covering t in [ta, tb] and s in [sa, sb]. */
  const strip = (
    a: Arm,
    ta: number,
    tb: number,
    sa: number,
    sb: number,
    color: number,
    y = DECAL_Y,
  ) => {
    const p = [pt(a, ta, sa), pt(a, ta, sb), pt(a, tb, sb), pt(a, tb, sa)];
    soupAt((p[0][0] + p[2][0]) / 2, (p[0][1] + p[2][1]) / 2).quad(p, y, color);
  };

  // ---- curbs: a raised kerb on the road side of every sidewalk ----------------------------
  for (const r of map.rects) {
    if (r.color !== COLORS.sidewalk) continue;
    const s = soupAt((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2);
    const t = 0.4;
    const y0 = r.y;
    const y1 = r.y + 0.11;
    s.box(r.x0, r.z0, r.x1, r.z0 + t, y0, y1, DECAL.curbTop, DECAL.curbSide);
    s.box(r.x0, r.z1 - t, r.x1, r.z1, y0, y1, DECAL.curbTop, DECAL.curbSide);
    s.box(
      r.x0,
      r.z0 + t,
      r.x0 + t,
      r.z1 - t,
      y0,
      y1,
      DECAL.curbTop,
      DECAL.curbSide,
    );
    s.box(
      r.x1 - t,
      r.z0 + t,
      r.x1,
      r.z1 - t,
      y0,
      y1,
      DECAL.curbTop,
      DECAL.curbSide,
    );
  }

  // ---- canal: deeper centre, foam along both banks; bridge parapets where a crossing spans it -----
  const water = map.rects.filter((r) => r.y === CANAL_Y);
  for (const w of water) {
    const alongZ = w.z1 - w.z0 > w.x1 - w.x0;
    const s = soupAt((w.x0 + w.x1) / 2, (w.z0 + w.z1) / 2);
    const f = 0.45;
    const deep = 1.6;
    if (alongZ) {
      s.flat(
        w.x0 + deep,
        w.z0,
        w.x1 - deep,
        w.z1,
        CANAL_Y + 0.002,
        COLORS.waterDeep,
      );
      s.flat(w.x0, w.z0, w.x0 + f, w.z1, CANAL_Y + 0.003, COLORS.foam);
      s.flat(w.x1 - f, w.z0, w.x1, w.z1, CANAL_Y + 0.003, COLORS.foam);
    } else {
      s.flat(
        w.x0,
        w.z0 + deep,
        w.x1,
        w.z1 - deep,
        CANAL_Y + 0.002,
        COLORS.waterDeep,
      );
      s.flat(w.x0, w.z0, w.x1, w.z0 + f, CANAL_Y + 0.003, COLORS.foam);
      s.flat(w.x0, w.z1 - f, w.x1, w.z1, CANAL_Y + 0.003, COLORS.foam);
    }
  }
  const near = (a: number, b: number) => Math.abs(a - b) < 0.6;
  for (const cr of crossings) {
    const s = soupAt((cr.x0 + cr.x1) / 2, (cr.z0 + cr.z1) / 2);
    const t = 0.35;
    const h = ROAD_Y + 0.95;
    const rail = (x0: number, z0: number, x1: number, z1: number) =>
      s.box(x0, z0, x1, z1, ROAD_Y, h, DECAL.curbTop, DECAL.curbSide);
    for (const w of water) {
      // water arm north / south of the crossing: a parapet along that edge (and the other way round)
      if (near(w.z1, cr.z0) && near(w.x0, cr.x0))
        rail(cr.x0, cr.z0, cr.x1, cr.z0 + t);
      if (near(w.z0, cr.z1) && near(w.x0, cr.x0))
        rail(cr.x0, cr.z1 - t, cr.x1, cr.z1);
      if (near(w.x1, cr.x0) && near(w.z0, cr.z0))
        rail(cr.x0, cr.z0, cr.x0 + t, cr.z1);
      if (near(w.x0, cr.x1) && near(w.z0, cr.z0))
        rail(cr.x1 - t, cr.z0, cr.x1, cr.z1);
    }
  }

  // ---- arms: stop lines, lane arrows, manholes --------------------------------------------
  // right-hand traffic: east of a z road drives north (-z), south of an x road drives east (+x)
  const heads = (a: Arm, s: number): 1 | -1 =>
    a.axis === 'z' ? (s > 0 ? -1 : 1) : s > 0 ? 1 : -1;
  for (const a of arms) {
    for (const sign of [1, -1] as const) {
      const dir = heads(a, sign);
      const end = dir > 0 ? a.t1 : a.t0;
      const back = -dir; // from the end back into the arm
      // stop line before the zebra (zebra sits 0.8..3.6 m from the end)
      strip(
        a,
        end + back * 4.2,
        end + back * 4.7,
        sign * 0.5,
        sign * 4.7,
        DECAL.white,
      );
      // straight arrow 10 m from the end, in the middle of the lane
      const ac = end + back * 10;
      const s = sign * 2.5;
      strip(
        a,
        ac + back * 1.6,
        ac - back * 0.4,
        s - 0.25,
        s + 0.25,
        DECAL.white,
      );
      // head: triangle pointing to the end
      const tip = pt(a, ac - back * 1.9, s);
      const l = pt(a, ac - back * 0.4, s - 0.85);
      const r = pt(a, ac - back * 0.4, s + 0.85);
      soupAt(tip[0], tip[1]).triN(
        [tip[0], DECAL_Y, tip[1]],
        [l[0], DECAL_Y, l[1]],
        [r[0], DECAL_Y, r[1]],
        DECAL.white,
        [0, 1, 0],
      );
    }
    // a manhole on some arms
    if (rng.chance(0.4)) {
      const t = a.t0 + (a.t1 - a.t0) * rng.range(0.3, 0.7);
      const s = rng.pick([-1, 1]) * rng.range(1.2, 3.6);
      const [x, z] = pt(a, t, s);
      const so = soupAt(x, z);
      so.disc(x, z, 0.58, DECAL_Y + 0.001, DECAL.manholeRim, 10);
      so.disc(x, z, 0.46, DECAL_Y + 0.002, DECAL.manhole, 10);
    }
  }

  // ---- parking-bay ticks around cars parked at the kerb -----------------------------------
  for (const pl of map.placements) {
    if (!PARKED.has(pl.item)) continue;
    const a = arms.find((m) => {
      const [x, z] = m.axis === 'z' ? [pl.x, pl.z] : [pl.z, pl.x];
      const across = x - m.mid;
      return Math.abs(across) < 5.2 && z > m.t0 && z < m.t1;
    });
    if (!a) continue;
    const across = (a.axis === 'z' ? pl.x : pl.z) - a.mid;
    if (Math.abs(across) < 3.2) continue; // a driving lane, not the kerb
    const [len, wid] = parkedSize(pl.item);
    const hx = Math.cos(pl.rot);
    const hz = -Math.sin(pl.rot);
    const cx = Math.sin(pl.rot);
    const cz = Math.cos(pl.rot);
    for (const e of [-1, 1]) {
      const bx = pl.x + hx * e * (len / 2 + 0.55);
      const bz = pl.z + hz * e * (len / 2 + 0.55);
      const hw = wid / 2 + 0.45;
      const th = 0.06;
      const p: [number, number][] = [
        [bx - cx * hw - hx * th, bz - cz * hw - hz * th],
        [bx + cx * hw - hx * th, bz + cz * hw - hz * th],
        [bx + cx * hw + hx * th, bz + cz * hw + hz * th],
        [bx - cx * hw + hx * th, bz - cz * hw + hz * th],
      ];
      soupAt(bx, bz).quad(p, DECAL_Y, DECAL.white);
    }
  }

  // ---- roundabouts at the crossings nearest the island centre -----------------------------
  const hasArm = (x: number, z: number) =>
    arms.some(
      (m) =>
        (m.axis === 'z'
          ? Math.abs(x - m.mid) < 1 && z > m.t0 && z < m.t1
          : Math.abs(z - m.mid) < 1 && x > m.t0 && x < m.t1) || false,
    );
  // block pitch = arm length + the 10 m crossing
  const pitch = arms.length ? arms[0].t1 - arms[0].t0 + 10 : 50;
  for (const c of crossings) {
    const x = (c.x0 + c.x1) / 2;
    const z = (c.z0 + c.z1) / 2;
    if (Math.hypot(x, z) > pitch * 1.05) continue;
    if (!(
      hasArm(x + 10, z) &&
      hasArm(x - 10, z) &&
      hasArm(x, z + 10) &&
      hasArm(x, z - 10)
    ))
      continue;
    const so = soupAt(x, z);
    so.disc(x, z, 3.7, 0.03, DECAL.islandRing, 20);
    so.disc(x, z, 2.9, 0.034, DECAL.islandGrass, 20);
    // dashed lane ring
    for (let i = 0; i < 18; i++) {
      const a0 = (i / 18) * Math.PI * 2;
      const a1 = a0 + 0.22;
      const ri = 4.15;
      const ro = 4.4;
      so.quad(
        [
          [x + Math.cos(a0) * ri, z + Math.sin(a0) * ri],
          [x + Math.cos(a0) * ro, z + Math.sin(a0) * ro],
          [x + Math.cos(a1) * ro, z + Math.sin(a1) * ro],
          [x + Math.cos(a1) * ri, z + Math.sin(a1) * ri],
        ],
        DECAL_Y,
        DECAL.white,
      );
    }
  }

  for (const so of chunks.values()) {
    if (!so.triangles) continue;
    const m = new Mesh(so.geometry(), groundMat);
    m.receiveShadow = true;
    group.add(m);
  }

  // ---- rocks at the waterline -------------------------------------------------------------
  const harbourAngle = harbourAt(map);
  const rocks: {
    x: number;
    z: number;
    s: number;
    rot: number;
    tint: number;
  }[] = [];
  const n = map.coast.length;
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2 + rng.range(-0.01, 0.01);
    if (harbourAngle !== null) {
      let da = Math.abs(a - harbourAngle);
      da = Math.min(da, Math.PI * 2 - da);
      if (da < 0.6) continue; // keep the bay (quay, slipway, pier) clear
    }
    if (!rng.chance(0.62)) continue;
    const r = coastRadius(map.coast, a) + rng.range(0.6, 3.2);
    const count = rng.chance(0.3) ? 2 : 1;
    for (let k = 0; k < count; k++)
      rocks.push({
        x: Math.cos(a) * r + rng.range(-1.2, 1.2),
        z: Math.sin(a) * r + rng.range(-1.2, 1.2),
        s: rng.range(0.55, 1.7),
        rot: rng.range(0, Math.PI * 2),
        tint: rng.range(0.78, 1.12),
      });
  }
  if (rocks.length) {
    const mesh = new InstancedMesh(
      new IcosahedronGeometry(1, 0),
      new MeshLambertMaterial({ color: 0xffffff, flatShading: true }),
      rocks.length,
    );
    const m = new Matrix4();
    const q = new Quaternion();
    const e = new Vector3(0, 1, 0);
    const col = new Color();
    rocks.forEach((rk, i) => {
      q.setFromAxisAngle(e, rk.rot);
      m.compose(
        new Vector3(rk.x, WATER_Y + rk.s * 0.3, rk.z),
        q,
        new Vector3(rk.s * 1.2, rk.s * 0.8, rk.s),
      );
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, col.setHex(0x8d9298).multiplyScalar(rk.tint));
    });
    mesh.frustumCulled = false;
    group.add(mesh);
  }

  // ---- pier at the harbour ----------------------------------------------------------------
  if (harbourAngle !== null) group.add(buildPier(map, harbourAngle, groundMat));
  return group;
}

/** Footprint of a parked car type (length along its heading, width); vehicles run along x. */
function parkedSize(id: string): [number, number] {
  const i = getItem(id);
  return [i.w, i.d];
}

/** Direction of the harbour: the centroid angle of the quay planks (null when the map has none). */
function harbourAt(map: MapData): number | null {
  let sx = 0;
  let sz = 0;
  let n = 0;
  for (const r of map.rects)
    if (r.color === COLORS.quay) {
      sx += (r.x0 + r.x1) / 2;
      sz += (r.z0 + r.z1) / 2;
      n++;
    }
  return n ? Math.atan2(sz / n, sx / n) : null;
}

function buildPier(
  map: MapData,
  angle: number,
  groundMat: MeshLambertMaterial,
): Group {
  const g = new Group();
  const R = coastRadius(map.coast, angle);
  const dx = Math.cos(angle);
  const dz = Math.sin(angle);
  const px = -dz;
  const pz = dx;
  const start = R - 1.2; // overlaps the quay a little
  const length = 30;
  const half = 1.7;
  const deck = new Soup();
  const planks = Math.round(length / 0.55);
  for (let i = 0; i < planks; i++) {
    const t0 = start + i * 0.55;
    const t1 = t0 + 0.5;
    const c = i % 2 ? 0xa97c50 : 0xb98c5c;
    const p: [number, number][] = [
      [dx * t0 - px * half, dz * t0 - pz * half],
      [dx * t0 + px * half, dz * t0 + pz * half],
      [dx * t1 + px * half, dz * t1 + pz * half],
      [dx * t1 - px * half, dz * t1 - pz * half],
    ];
    deck.quad(p, 0.06, c);
  }
  // deck sides and posts as one lit mesh
  const post = new Soup();
  const side = (sgn: number) => {
    const a: [number, number, number] = [
      dx * start + px * half * sgn,
      0.06,
      dz * start + pz * half * sgn,
    ];
    const b: [number, number, number] = [
      dx * (start + length) + px * half * sgn,
      0.06,
      dz * (start + length) + pz * half * sgn,
    ];
    const a2: [number, number, number] = [a[0], -0.35, a[2]];
    const b2: [number, number, number] = [b[0], -0.35, b[2]];
    const n: [number, number, number] = [px * sgn, 0, pz * sgn];
    post.triN(a, b, b2, 0x6f5238, n);
    post.triN(a, b2, a2, 0x6f5238, n);
  };
  side(1);
  side(-1);
  for (let t = start + 2; t <= start + length; t += 4)
    for (const sgn of [-1, 1]) {
      const cx = dx * t + px * (half - 0.2) * sgn;
      const cz = dz * t + pz * (half - 0.2) * sgn;
      post.box(
        cx - 0.18,
        cz - 0.18,
        cx + 0.18,
        cz + 0.18,
        WATER_Y - 1.2,
        0.2,
        0x4e3a28,
        0x4e3a28,
      );
    }
  const deckMesh = new Mesh(deck.geometry(), groundMat);
  deckMesh.receiveShadow = true;
  g.add(deckMesh);
  g.add(
    new Mesh(post.geometry(), new MeshLambertMaterial({ vertexColors: true })),
  );
  return g;
}
