import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  ShapeUtils,
  Vector2,
} from 'three';
import { getTexture } from '../engine/textures';
import { ISLAND_KERB } from './plazas';
import { newPathQuery } from './real-data';
import { STREET_KINDS } from './street-detail';
import type { World } from './world';

/** Longest triangle edge of the plaza surface (m): it follows the slab top's slope. */
const MAX_EDGE = 3;
/** Metres per texture repeat. */
const TILE = 8;

/** Junction plazas (plazas.ts): one plain asphalt surface per outline at the slab top, under the street ribbons at its edge. */
export function* plazaMeshJob(
  world: World,
): Generator<void, Group | undefined> {
  const plazas = world.gen.plazas;
  if (plazas.empty) return undefined;
  const pos: number[] = [];
  const uv: number[] = [];
  const add = (x: number, z: number) => {
    const y = plazas.height(x, z) ?? world.gen.height(x, z);
    pos.push(x, y + 0.03, z);
    uv.push(x / TILE, z / TILE);
  };
  const tri = (a: number[], b: number[], c: number[]): void => {
    const e = Math.max(
      Math.hypot(a[0] - b[0], a[1] - b[1]),
      Math.hypot(b[0] - c[0], b[1] - c[1]),
      Math.hypot(c[0] - a[0], c[1] - a[1]),
    );
    if (e > MAX_EDGE) {
      const ab = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const bc = [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2];
      const ca = [(c[0] + a[0]) / 2, (c[1] + a[1]) / 2];
      tri(a, ab, ca);
      tri(ab, b, bc);
      tri(ca, bc, c);
      tri(ab, bc, ca);
      return;
    }
    // Never over the open trench beyond the slab.
    if (!plazas.inside((a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, 0.5))
      return;
    // Wound to face up (+Y): y of (b - a) x (c - a) > 0.
    const up =
      (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]) > 0;
    add(a[0], a[1]);
    if (up) {
      add(b[0], b[1]);
      add(c[0], c[1]);
    } else {
      add(c[0], c[1]);
      add(b[0], b[1]);
    }
  };
  for (const p of plazas.polys) {
    const ring: Vector2[] = [];
    for (let i = 0; i < p.pts.length; i += 2)
      ring.push(new Vector2(p.pts[i], p.pts[i + 1]));
    for (const [i, j, k] of ShapeUtils.triangulateShape(ring, []))
      tri(
        [ring[i].x, ring[i].y],
        [ring[j].x, ring[j].y],
        [ring[k].x, ring[k].y],
      );
    yield;
  }
  if (!pos.length) return undefined;
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  const m = new Mesh(
    g,
    new MeshStandardMaterial({
      map: getTexture('junction_asphalt'),
      bumpMap: getTexture('junction_asphalt'),
      bumpScale: 1.2,
      roughness: 0.86,
      // Under the street ribbons (road materials use -1 and lower) that reach in at its edge, over the terrain.
      polygonOffset: true,
      polygonOffsetFactor: -0.5,
      polygonOffsetUnits: -1,
    }),
  );
  m.material.defines = { RALLY_GROUND: 1 };
  m.receiveShadow = true;
  m.matrixAutoUpdate = false;
  const group = new Group();
  group.name = 'plazas';
  group.add(m);
  yield;
  for (const mesh of islandMeshes(world)) group.add(mesh);
  const cw = crosswalkMesh(world);
  if (cw) group.add(cw);
  yield;
  for (const mesh of laneMarkings(world)) group.add(mesh);
  return group;
}

/** Lane line width, dash / gap length (m): NYC-like 10 ft dashes on 30 ft gaps. */
const LINE_W = 0.12;
const DASH = 3;
const GAP = 9;
/** Lines stop this far beyond a crosswalk's edge (m). */
const CROSS_MARGIN = 1.2;
/** Assumed lane width when a way has no `lanes` tag (m). */
const LANE_W = 3.3;

/**
 * Lane markings on the junction areas, from the OSM ways that run there: dashed white lines between the lanes of a
 * direction, a double yellow centre line on a two-way street. None in the intersection core (where another street's
 * ribbon crosses), none across a crosswalk; raised islands / sidewalks hide what runs under them.
 */
function laneMarkings(world: World): Mesh[] {
  const plazas = world.gen.plazas;
  const net = world.gen.paths;
  const areas = plazas.polys.filter((p) => p.area);
  if (!net || !areas.length) return [];
  const minX = Math.min(...areas.map((p) => p.minX));
  const maxX = Math.max(...areas.map((p) => p.maxX));
  const minZ = Math.min(...areas.map((p) => p.minZ));
  const maxZ = Math.max(...areas.map((p) => p.maxZ));
  const crossings = world.map.plazaCrosswalks ?? [];
  const CROSS_CLEAR = CROSSWALK_W / 2 + CROSS_MARGIN;
  const nearCrossing = (x: number, z: number): boolean => {
    for (const c of crossings)
      for (let i = 0; i + 3 < c.length; i += 2) {
        const ax = c[i];
        const az = c[i + 1];
        const ex = c[i + 2] - ax;
        const ez = c[i + 3] - az;
        const l2 = ex * ex + ez * ez || 1e-9;
        const t = Math.max(
          0,
          Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2),
        );
        if (Math.hypot(ax + ex * t - x, az + ez * t - z) < CROSS_CLEAR)
          return true;
      }
    return false;
  };
  const pq = newPathQuery();
  const white: number[] = [];
  const yellow: number[] = [];
  const pt = { x: 0, z: 0 };
  const nx = { x: 0, z: 0 };
  net.paths.forEach((p, pi) => {
    if (
      p.surface !== 'tarmac' ||
      !STREET_KINDS.has(p.kind) ||
      world.gen.isCarriageway(pi)
    )
      return;
    const L = net.lengths[pi];
    // A quick reject: no sample of the way near the areas.
    net.pointAt(pi, L / 2, pt);
    if (
      pt.x < minX - L ||
      pt.x > maxX + L ||
      pt.z < minZ - L ||
      pt.z > maxZ + L
    )
      return;
    const hw = p.width / 2;
    const twoWay = !p.oneway;
    const lanes = Math.max(1, p.lanes ?? Math.round(p.width / LANE_W));
    // Lateral offsets (+ = left of the way's direction) of the lines and their colour / dash.
    const lines: { off: number; yellow: boolean; dashed: boolean }[] = [];
    if (twoWay) {
      lines.push({ off: 0.1, yellow: true, dashed: false });
      lines.push({ off: -0.1, yellow: true, dashed: false });
      const per = Math.max(1, Math.floor(lanes / 2));
      for (let k = 1; k < per; k++)
        for (const s of [1, -1])
          lines.push({ off: (s * hw * k) / per, yellow: false, dashed: true });
    } else
      for (let k = 1; k < lanes; k++)
        lines.push({
          off: -hw + (2 * hw * k) / lanes,
          yellow: false,
          dashed: true,
        });
    if (!lines.length) return;
    const ok = (x: number, z: number, a: number): boolean => {
      if (
        !plazas.inside(x, z) ||
        plazas.keepsRibbons(x, z) ||
        nearCrossing(x, z)
      )
        return false;
      // The intersection core: another street's ribbon crosses here.
      net.query(
        x,
        z,
        pq,
        'tarmac',
        (qi) =>
          qi !== pi &&
          STREET_KINDS.has(net.paths[qi].kind) &&
          !world.gen.isCarriageway(qi),
      );
      if (pq.found && pq.distance < pq.halfWidth) {
        net.pointAt(pi, Math.max(0, a - 1), pt);
        net.pointAt(pi, Math.min(L, a + 1), nx);
        const dx = nx.x - pt.x;
        const dz = nx.z - pt.z;
        const q0 = { x: 0, z: 0 };
        const q1 = { x: 0, z: 0 };
        net.pointAt(pq.path, Math.max(0, pq.along - 1), q0);
        net.pointAt(pq.path, Math.min(net.lengths[pq.path], pq.along + 1), q1);
        const ex = q1.x - q0.x;
        const ez = q1.z - q0.z;
        const cos =
          Math.abs(dx * ex + dz * ez) /
          ((Math.hypot(dx, dz) || 1) * (Math.hypot(ex, ez) || 1));
        if (cos < 0.8) return false;
      }
      return true;
    };
    for (const ln of lines) {
      const out = ln.yellow ? yellow : white;
      const period = ln.dashed ? DASH + GAP : 1;
      for (let a = 0; a + 0.5 <= L; a += 0.5) {
        if (ln.dashed && a % period >= DASH) continue;
        const b = a + 0.5;
        net.pointAt(pi, Math.max(0, a - 1), pt);
        net.pointAt(pi, Math.min(L, a + 1), nx);
        const tl = Math.hypot(nx.x - pt.x, nx.z - pt.z) || 1;
        const tx = (nx.x - pt.x) / tl;
        const tz = (nx.z - pt.z) / tl;
        const lat = ln.off;
        net.pointAt(pi, a, pt);
        const x0 = pt.x + tz * lat;
        const z0 = pt.z - tx * lat;
        net.pointAt(pi, b, nx);
        const x1 = nx.x + tz * lat;
        const z1 = nx.z - tx * lat;
        if (!ok((x0 + x1) / 2, (z0 + z1) / 2, a + 0.25)) continue;
        const w = LINE_W / 2;
        const quad = [
          [x0 + tz * w, z0 - tx * w],
          [x1 + tz * w, z1 - tx * w],
          [x1 - tz * w, z1 + tx * w],
          [x0 - tz * w, z0 + tx * w],
        ];
        for (const k of [0, 2, 1, 0, 3, 2]) {
          const [x, z] = quad[k];
          out.push(x, (plazas.height(x, z) ?? 0) + 0.05, z);
        }
      }
    }
  });
  const meshes: Mesh[] = [];
  for (const [pos, color] of [
    [white, 0xe6e6e0],
    [yellow, 0xe0b830],
  ] as const) {
    if (!pos.length) continue;
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const m = new Mesh(
      g,
      new MeshStandardMaterial({
        color,
        roughness: 0.75,
        side: 2,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -6,
      }),
    );
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    meshes.push(m);
  }
  return meshes;
}

/** Width of a zebra crosswalk across its centre line (along the traffic) (m). */
const CROSSWALK_W = 3.4;
/** Metres of crossing per repeat of the zebra texture (eight bars, 0.5 m each). */
const ZEBRA_TILE = 4;

/**
 * Zebra crosswalks (MapDef.plazaCrosswalks): a band CROSSWALK_W wide along each centre line, on the plaza paving or the
 * street ground beside it. A raised island it crosses hides it (the island top is above the paint).
 */
function crosswalkMesh(world: World): Mesh | undefined {
  const lines = world.map.plazaCrosswalks;
  if (!lines?.length) return undefined;
  const plazas = world.gen.plazas;
  const y = (x: number, z: number) =>
    (plazas.inside(x, z) ? plazas.height(x, z) : undefined) ??
    world.gen.height(x, z);
  const pos: number[] = [];
  const uv: number[] = [];
  for (const pts of lines) {
    let along = 0;
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const [ax, az, bx, bz] = pts.slice(i, i + 4);
      const l = Math.hypot(bx - ax, bz - az);
      if (l < 0.2) continue;
      const nx = (-(bz - az) / l) * (CROSSWALK_W / 2);
      const nz = ((bx - ax) / l) * (CROSSWALK_W / 2);
      const n = Math.max(1, Math.ceil(l));
      for (let k = 0; k < n; k++) {
        const t0 = k / n;
        const t1 = (k + 1) / n;
        const q = [
          [ax + (bx - ax) * t0, az + (bz - az) * t0, along + l * t0],
          [ax + (bx - ax) * t1, az + (bz - az) * t1, along + l * t1],
        ];
        // Not over the open cut (a crossing reaching past a skewed slab edge hung down into the trench).
        const [mx, mz] = [(q[0][0] + q[1][0]) / 2, (q[0][1] + q[1][1]) / 2];
        if (
          world.gen.inOpenCut(mx + nx, mz + nz) ||
          world.gen.inOpenCut(mx - nx, mz - nz) ||
          world.gen.inOpenCut(mx, mz)
        )
          continue;
        const corner = (j: number, s: number) => {
          const [x, z, d] = q[j];
          const cx = x + nx * s;
          const cz = z + nz * s;
          pos.push(cx, y(cx, cz) + 0.045, cz);
          uv.push(d / ZEBRA_TILE, (s + 1) / 2);
        };
        for (const [j, s] of [
          [0, -1],
          [1, -1],
          [1, 1],
          [0, -1],
          [1, 1],
          [0, 1],
        ] as const)
          corner(j, s);
      }
      along += l;
    }
  }
  if (!pos.length) return undefined;
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  const m = new Mesh(
    g,
    new MeshStandardMaterial({
      map: getTexture('crosswalk'),
      alphaTest: 0.5,
      roughness: 0.8,
      side: 2,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -8,
    }),
  );
  m.receiveShadow = true;
  m.matrixAutoUpdate = false;
  return m;
}

/** Paving colours (vertex colours over the sidewalk texture). */
const ISLAND_TOP: [number, number, number] = [0.86, 0.85, 0.82];
const SIDEWALK_TOP: [number, number, number] = [0.93, 0.92, 0.89];
const KERB_FACE: [number, number, number] = [0.8, 0.79, 0.76];
/** Metres per texture repeat of the island paving / of the painted hatching. */
const PAVE_TILE = 2;
const HATCH_TILE = 4;

/**
 * Islands on the plazas (MapDef.plazaIslands): raised ones (traffic islands, medians, sidewalks) as a paved top
 * ISLAND_KERB over the plaza with a kerb face around the outline; painted medians as a flat pale area.
 */
function islandMeshes(world: World): Mesh[] {
  const plazas = world.gen.plazas;
  if (!plazas.islands.length) return [];
  const raised = {
    pos: [] as number[],
    col: [] as number[],
    uv: [] as number[],
  };
  const paint = { pos: [] as number[], uv: [] as number[] };
  /** Edge lines of the painted medians (flat quads, 0.15 m wide just inside the outline). */
  const lines: number[] = [];
  const base = (x: number, z: number) =>
    (plazas.height(x, z) ?? world.gen.height(x, z)) + 0.03;
  for (const il of plazas.islands) {
    const ring: Vector2[] = [];
    for (let i = 0; i < il.pts.length; i += 2)
      ring.push(new Vector2(il.pts[i], il.pts[i + 1]));
    if (ShapeUtils.isClockWise(ring)) ring.reverse();
    const lift = il.kind === 'painted' ? 0.012 : ISLAND_KERB;
    const top = il.kind === 'sidewalk' ? SIDEWALK_TOP : ISLAND_TOP;
    const put = (
      x: number,
      z: number,
      y: number,
      c: number[],
      u: number,
      v: number,
    ) => {
      if (il.kind === 'painted') {
        paint.pos.push(x, y, z);
        paint.uv.push(x / HATCH_TILE, z / HATCH_TILE);
      } else {
        raised.pos.push(x, y, z);
        raised.col.push(...c);
        raised.uv.push(u, v);
      }
    };
    // Top: wound to face up (+Y) - counter-clockwise in x / z seen from above is clockwise in x / -z. Split to follow
    // the surface, and left out over the open cut (a junction area's islands are clipped to its outline only).
    const topTri = (a: Vector2, b: Vector2, c: Vector2): void => {
      if (Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)) > 2) {
        const ab = a.clone().add(b).multiplyScalar(0.5);
        const bc = b.clone().add(c).multiplyScalar(0.5);
        const ca = c.clone().add(a).multiplyScalar(0.5);
        topTri(a, ab, ca);
        topTri(ab, b, bc);
        topTri(ca, bc, c);
        topTri(ab, bc, ca);
        return;
      }
      if (!plazas.inside((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3, 0.3))
        return;
      for (const q of [a, c, b])
        put(
          q.x,
          q.y,
          base(q.x, q.y) + lift,
          top,
          q.x / PAVE_TILE,
          q.y / PAVE_TILE,
        );
    };
    for (const [i, j, k] of ShapeUtils.triangulateShape(ring, []))
      topTri(ring[i], ring[j], ring[k]);
    if (il.kind === 'painted') {
      // Edge line: a 0.15 m band just inside each edge (the ring is counter-clockwise: inside is to the left).
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        const l = a.distanceTo(b) || 1;
        const nx = -(b.y - a.y) / l;
        const nz = (b.x - a.x) / l;
        const w = 0.15;
        const quad = [
          [a.x, a.y],
          [b.x, b.y],
          [b.x + nx * w, b.y + nz * w],
          [a.x + nx * w, a.y + nz * w],
        ];
        for (const k of [0, 2, 1, 0, 3, 2]) {
          const [x, z] = quad[k];
          lines.push(x, base(x, z) + lift + 0.004, z);
        }
      }
      continue;
    }
    // Kerb face: quads of <= 1.5 m along each edge, from the plaza paving up to the island top.
    const edges: [Vector2, Vector2][] = [];
    for (let i = 0; i < ring.length; i++) {
      const p0 = ring[i];
      const p1 = ring[(i + 1) % ring.length];
      const n = Math.max(1, Math.ceil(p0.distanceTo(p1) / 1.5));
      for (let k = 0; k < n; k++)
        edges.push([
          p0.clone().lerp(p1, k / n),
          p0.clone().lerp(p1, (k + 1) / n),
        ]);
    }
    let along = 0;
    for (const [a, b] of edges) {
      const l = a.distanceTo(b);
      if (!plazas.inside((a.x + b.x) / 2, (a.y + b.y) / 2, 0.3)) {
        along += l;
        continue;
      }
      const ya = base(a.x, a.y);
      const yb = base(b.x, b.y);
      const u0 = along / PAVE_TILE;
      const u1 = (along + l) / PAVE_TILE;
      const h = ISLAND_KERB / PAVE_TILE;
      put(a.x, a.y, ya, KERB_FACE, u0, 0);
      put(b.x, b.y, yb, KERB_FACE, u1, 0);
      put(b.x, b.y, yb + ISLAND_KERB, KERB_FACE, u1, h);
      put(a.x, a.y, ya, KERB_FACE, u0, 0);
      put(b.x, b.y, yb + ISLAND_KERB, KERB_FACE, u1, h);
      put(a.x, a.y, ya + ISLAND_KERB, KERB_FACE, u0, h);
      along += l;
    }
  }
  const out: Mesh[] = [];
  if (raised.pos.length) {
    const g = new BufferGeometry();
    g.setAttribute(
      'position',
      new BufferAttribute(new Float32Array(raised.pos), 3),
    );
    g.setAttribute(
      'color',
      new BufferAttribute(new Float32Array(raised.col), 3),
    );
    g.setAttribute('uv', new BufferAttribute(new Float32Array(raised.uv), 2));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const m = new Mesh(
      g,
      new MeshStandardMaterial({
        map: getTexture('sidewalk'),
        vertexColors: true,
        roughness: 0.95,
        side: 2,
      }),
    );
    m.receiveShadow = true;
    m.castShadow = true;
    m.matrixAutoUpdate = false;
    out.push(m);
  }
  if (paint.pos.length) {
    const g = new BufferGeometry();
    g.setAttribute(
      'position',
      new BufferAttribute(new Float32Array(paint.pos), 3),
    );
    g.setAttribute('uv', new BufferAttribute(new Float32Array(paint.uv), 2));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const m = new Mesh(
      g,
      new MeshStandardMaterial({
        map: getTexture('hatch'),
        alphaTest: 0.5,
        roughness: 0.8,
        side: 2,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -2,
      }),
    );
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    out.push(m);
  }
  if (lines.length) {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(lines), 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const m = new Mesh(
      g,
      new MeshStandardMaterial({
        color: 0xe2e2dc,
        roughness: 0.8,
        side: 2,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -2,
      }),
    );
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    out.push(m);
  }
  return out;
}
