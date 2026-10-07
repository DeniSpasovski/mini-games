import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Vector3,
} from 'three';
import { getTexture } from '../engine/textures';
import {
  type PathDef,
  roadSurfaceAt,
  type RoadTexture,
} from '../maps/shared/types';
import { barrierMeshJob } from './barrier-mesh';
import { bridgeMeshJob } from './bridge-mesh';
import { cutWallMeshJob } from './cut-wall-mesh';
import { powerLineMeshJob } from './power-line-mesh';
import { railMeshJob } from './rail-mesh';
import { streetDetailMeshJob } from './street-detail-mesh';
import { newRoadQuery } from './road';
import { newPathQuery } from './real-data';
import { gantryMeshJob } from './gantry-mesh';
import { goreMeshJob } from './gore-mesh';
import { junctionFillets } from './junctions';
import { plazaMeshJob } from './plaza-mesh';
import { mergePaint } from './merge-paint';
import { junctionGlyphs } from './street-glyphs';
import { baseTexture, hasMarkings, straightJoint } from './street-markings';
import { type MarkRow, MarkingBuilder } from './street-markings-mesh';
import { stageSignMeshJob } from './stage-sign-mesh';
import { buildingMeshJob } from './building-mesh';
import { waterMeshJob } from './water-mesh';
import type { World } from './world';
import { GroundTerrain } from './heightfield';

/**
 * Road surface ribbon. Vertices sample the terrain generator (so the ribbon hugs
 * the carved terrain including the crown) and polygon offset keeps it on top
 * without z-fighting. Split into ~64 m segments so frustum culling works.
 *
 * Texture u runs across the road (0 = right edge, 1 = left edge), v along it.
 */
const ACROSS = [-1.04, -0.66, -0.33, 0, 0.33, 0.66, 1.04];
/** Metres of road per texture repeat (the parkway tile holds one 3 m dash + 9 m gap of the lane line). */
export const texLength = (t: RoadTexture): number =>
  t === 'road_parkway' || t === 'road_street4'
    ? 12
    : t === 'road_street' ||
        t === 'road_city' ||
        t === 'asphalt_street' ||
        t === 'asphalt_highway'
      ? 8
      : 7;
/** City streets (OSM kinds) that get city asphalt on maps with `cityStreets`. */
const CITY_KINDS = new Set([
  'primary',
  'secondary',
  'tertiary',
  'unclassified',
  'residential',
  'living_street',
]);
/**
 * Texture of another road (path / deck) by its OSM class: mainline motorways have lane markings; on city maps
 * the streets get city asphalt (a double yellow centre line from 6.4 m wide, dashed lane lines too from 12 m = 4 lanes).
 */
export const pathTexture = (
  kind: string,
  width: number,
  city = false,
): RoadTexture =>
  (kind === 'motorway' || kind === 'trunk') && width >= 5.5
    ? 'road_parkway'
    : city && CITY_KINDS.has(kind)
      ? width >= 12
        ? 'road_street4'
        : width >= 6.4
          ? 'road_street'
          : 'road_city'
      : city
        ? // a city map has no village tarmac: ramps / narrow carriageways get highway asphalt, service roads city asphalt
          /^(motorway|trunk)/.test(kind) || kind.endsWith('_link')
          ? 'asphalt_highway'
          : 'road_city'
        : 'road_tarmac';
const SEGMENT = 64; // samples per mesh

const roadMaterials = new Map<string, MeshStandardMaterial>();

/**
 * Shared road material per texture. `layer` 0 = stage road, 2 = mainline highway ribbons (lane
 * markings), 1 = other roads: where ribbons overlap (junctions, merging ramps) the lower number wins.
 */
export function getRoadMaterial(
  texture: RoadTexture = 'road',
  layer = 0,
): MeshStandardMaterial {
  const key = `${texture}:${layer}`;
  let m = roadMaterials.get(key);
  if (!m) {
    m = new MeshStandardMaterial({
      map: getTexture(texture),
      // Relief from the texture itself: gravel stones / tarmac grain catch a low sun.
      bumpMap: getTexture(texture),
      bumpScale: texture === 'road' ? 2.2 : 1.2,
      roughness: texture === 'road' ? 0.93 : 0.86,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: layer === 0 ? -3 : layer === 2 ? -2 : -1,
      polygonOffsetUnits: layer === 0 ? -6 : layer === 2 ? -4 : -2,
    });
    // Canopy shadows beyond the shadow map (engine/world-shading.ts).
    m.defines = { RALLY_GROUND: 1 };
    roadMaterials.set(key, m);
  }
  return m;
}

/** Milliseconds each road mesh job took (diagnostics, also on `globalThis.__roadJobMs`). */
export const roadJobMs: Record<string, number> = {};
(globalThis as { __roadJobMs?: Record<string, number> }).__roadJobMs =
  roadJobMs;

/** Run a time-sliced job, adding the time spent inside it (not the frames between slices) to `roadJobMs[name]`. */
function* timed<T>(name: string, job: Generator<void, T>): Generator<void, T> {
  for (;;) {
    const t = performance.now();
    const r = job.next();
    roadJobMs[name] = (roadJobMs[name] ?? 0) + performance.now() - t;
    if (r.done) return r.value;
    yield;
  }
}

export function buildRoadMesh(world: World): Group {
  const job = roadMeshJob(world);
  let r = job.next();
  while (!r.done) r = job.next();
  return r.value;
}

export interface RoadMeshOptions {
  /** Build what is near this point first (stage road segments, street tiles): the map viewer opened on a camera link. */
  focus?: { x: number; z: number };
  /** Group to fill (added to the scene up front, so the meshes show up as they are built). */
  group?: Group;
}

/** buildRoadMesh as a time-sliced job: yields after every road segment / side road. */
export function* roadMeshJob(
  world: World,
  opts: RoadMeshOptions = {},
): Generator<void, Group> {
  const group = opts.group ?? new Group();
  group.name = 'road';
  // Side by side, both nearest `focus` first: the streets around a viewer camera link do not wait for the whole stage road.
  yield* interleave(
    timed('stageRoad', stageRoadJob(world, group, opts.focus)),
    timed('paths', pathMeshesJob(world, group, opts.focus)),
  );
  const barriers = yield* timed('barriers', barrierMeshJob(world));
  if (barriers) group.add(barriers);
  const streets = yield* timed('streetDetail', streetDetailMeshJob(world));
  if (streets) group.add(streets);
  const gore = yield* timed('gore', goreMeshJob(world));
  if (gore) group.add(gore);
  const plazas = yield* timed('plazas', plazaMeshJob(world));
  if (plazas) group.add(plazas);
  const power = yield* timed('powerLines', powerLineMeshJob(world));
  if (power) group.add(power);
  const rail = yield* timed('railways', railMeshJob(world));
  if (rail) group.add(rail);
  const cutWalls = yield* timed('cutWalls', cutWallMeshJob(world));
  if (cutWalls) group.add(cutWalls);
  const signs = yield* timed('stageSigns', stageSignMeshJob(world));
  if (signs) group.add(signs);
  const gantries = yield* timed('gantries', gantryMeshJob(world));
  if (gantries) group.add(gantries);
  const bridges = yield* timed('bridges', bridgeMeshJob(world));
  if (bridges) group.add(bridges);
  const buildings = yield* timed('buildings', buildingMeshJob(world));
  if (buildings) group.add(buildings);
  for (const landmark of world.landmarks) {
    const built = yield* timed('landmarks', landmark.build(world));
    if (built) group.add(built);
  }
  const water = yield* timed('water', waterMeshJob(world));
  if (water) group.add(water);
  return group;
}

/** Runs jobs in turns (one step each per yield) until all are done. */
function* interleave(...jobs: Generator<void, unknown>[]): Generator<void> {
  let live = jobs;
  while (live.length) {
    live = live.filter((j) => !j.next().done);
    yield;
  }
}

/** The stage road ribbon, one mesh per segment (nearest `focus` first when given). */
function* stageRoadJob(
  world: World,
  group: Group,
  focus?: { x: number; z: number },
): Generator<void> {
  const samples = world.road.samples;
  // Analytic sampling: same values as the heightfield at grid points, without
  // generating the 1 m cache along the whole road at load.
  const hf = world.analytic;
  const nTmp = new Vector3();
  const cols = ACROSS.length;
  // Segments [start, end]: every SEGMENT samples, plus a break where the road surface changes.
  const segs: [number, number][] = [];
  for (let i = 0; i < samples.length - 1;) {
    const tex = roadSurfaceAt(world.map.road, samples[i].dist).texture;
    let end = Math.min(samples.length - 1, i + SEGMENT);
    for (let j = i + 1; j <= end; j++)
      if (roadSurfaceAt(world.map.road, samples[j].dist).texture !== tex) {
        end = j;
        break;
      }
    segs.push([i, end]);
    i = end;
  }
  if (focus) {
    const d = ([a, b]: [number, number]) => {
      const m = samples[(a + b) >> 1];
      return Math.hypot(m.x - focus.x, m.z - focus.z);
    };
    segs.sort((p, q) => d(p) - d(q));
  }
  for (const [start, end] of segs) {
    const rows = end - start + 1;
    const segTex = roadSurfaceAt(world.map.road, samples[start].dist).texture;
    const pos = new Float32Array(rows * cols * 3);
    const nor = new Float32Array(rows * cols * 3);
    const uv = new Float32Array(rows * cols * 2);
    for (let r = 0; r < rows; r++) {
      const s = samples[start + r];
      const onBridge = !!world.road.bridgeAt(s.dist);
      // left = (tz, -tx)
      for (let c = 0; c < cols; c++) {
        const lat = ACROSS[c] * s.halfWidth;
        const x = s.x + s.tz * lat;
        const z = s.z - s.tx * lat;
        const v = r * cols + c;
        pos[v * 3] = x;
        // On a bridge the deck is not the ground: sample it at the road edge for the verge columns.
        const lc = Math.max(-s.halfWidth, Math.min(s.halfWidth, lat));
        const deck = onBridge
          ? world.gen.deckHeightAt(s.x + s.tz * lc, s.z - s.tx * lc)
          : NaN;
        pos[v * 3 + 1] = (Number.isNaN(deck) ? hf.height(x, z) : deck) + 0.02;
        pos[v * 3 + 2] = z;
        hf.normal(x, z, nTmp);
        nor[v * 3] = nTmp.x;
        nor[v * 3 + 1] = nTmp.y;
        nor[v * 3 + 2] = nTmp.z;
        uv[v * 2] = 1 - (ACROSS[c] + 1.04) / 2.08;
        uv[v * 2 + 1] = s.dist / texLength(segTex);
      }
    }
    const idx: number[] = [];
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c;
        const b = a + 1;
        const d = a + cols;
        const e = d + 1;
        // Winding chosen so the face normal points up (+Y) for a road heading +Z.
        idx.push(a, d, e, a, e, b);
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('normal', new BufferAttribute(nor, 3));
    g.setAttribute('uv', new BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const mesh = new Mesh(
      g,
      getRoadMaterial(
        roadSurfaceAt(world.map.road, samples[start].dist).texture,
      ),
    );
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    yield;
  }
}

const PATH_ACROSS = [-1, -0.5, 0, 0.5, 1];
const PATH_STEP = 3; // m between ribbon rows
const PATH_TILE = 256; // m, one merged mesh per tile
/** A street's end lies inside the street it meets for at most this long (m). */
const MEET_REACH = 30;

/**
 * Where the paint of a street starts (`atEnd` false) / ends: past the rows at that end that lie inside another street
 * (`MarkRow.skip`), m along. A stop bar stands before them, not in the cross street.
 */
function freeFrom(rows: readonly MarkRow[], atEnd: boolean): number {
  const n = rows.length;
  const L = rows[n - 1].d;
  for (let k = 0; k < n; k++) {
    const r = rows[atEnd ? n - 1 - k : k];
    if (!r.skip) return r.d;
    if ((atEnd ? L - r.d : r.d) > MEET_REACH) break;
  }
  return atEnd ? L : 0;
}

/**
 * Paved non-stage roads (village streets, motorway, ...) as terrain-hugging ribbons,
 * merged per 256 m tile. Unpaved tracks are only painted into the terrain splat.
 */
function* pathMeshesJob(
  world: World,
  parent: Group,
  focus?: { x: number; z: number },
): Generator<void> {
  // Bridge decks are drawn by bridge-mesh at their own height.
  const paths = world.gen.paths?.paths.filter(
    (p) => p.surface === 'tarmac' && !p.bridge,
  );
  if (!paths?.length) return;
  // The ground, not the top surface: a street under a stage-road bridge stays down in its underpass.
  const hf = new GroundTerrain(world.gen);
  const nTmp = new Vector3();
  const rq = newRoadQuery();
  const tiles = new Map<
    string,
    {
      tex: RoadTexture;
      pos: number[];
      nor: number[];
      uv: number[];
      idx: number[];
    }
  >();
  const cols = PATH_ACROSS.length;
  // The neighbour point beyond an end where exactly one other way of the same kind continues (an OSM joint): the
  // end row is mitred to the mean direction, so a bend at the joint leaves no wedge of bare ground in the street.
  const beyond = (p: PathDef, atEnd: boolean): [number, number] | undefined => {
    const n = p.pts.length;
    const x = atEnd ? p.pts[n - 2] : p.pts[0];
    const z = atEnd ? p.pts[n - 1] : p.pts[1];
    let hit: [number, number] | undefined;
    let count = 0;
    for (const q of paths) {
      if (q === p) continue;
      const m = q.pts.length;
      for (const qEnd of [false, true]) {
        const qx = qEnd ? q.pts[m - 2] : q.pts[0];
        const qz = qEnd ? q.pts[m - 1] : q.pts[1];
        if (Math.abs(qx - x) > 0.5 || Math.abs(qz - z) > 0.5) continue;
        count++;
        if (q.kind === p.kind && q.width === p.width)
          hit = qEnd ? [q.pts[m - 4], q.pts[m - 3]] : [q.pts[2], q.pts[3]];
      }
    }
    return count === 1 ? hit : undefined;
  };
  // Rounded corners at the junction mouths of plain tarmac side roads (junctions.ts `junctionFillets`): the same
  // tiles / material as the ribbons (no extra draws) and the ribbon's height rule (sunk under the stage road's edge).
  // Textured with the dusty edge band of `road_tarmac`. City maps (kerbs, sidewalks, plazas, markings) are left out.
  for (const j of world.map.cityStreets ? [] : world.gen.junctions) {
    if (j.surface !== 'tarmac') continue;
    const tex = pathTexture(j.kind, j.width, !!world.map.cityStreets);
    if (tex !== 'road_tarmac') continue;
    const s0 = world.road.at(j.along);
    const edge = (d: number): [number, number] => {
      const s = world.road.at(j.along + d);
      const lat = j.side * s.halfWidth;
      return [s.x + s.tz * lat, s.z - s.tx * lat];
    };
    for (const f of junctionFillets(j, s0.tx, s0.tz, edge)) {
      const key = `${tex}:${Math.floor(f.c[0] / PATH_TILE)},${Math.floor(f.c[1] / PATH_TILE)}`;
      let tile = tiles.get(key);
      if (!tile)
        tiles.set(key, (tile = { tex, pos: [], nor: [], uv: [], idx: [] }));
      const v0 = tile.pos.length / 3;
      hf.normal(f.c[0], f.c[1], nTmp);
      for (const [k, [x, z]] of [f.c, ...f.arc].entries()) {
        world.road.query(x, z, rq);
        const ground = hf.height(x, z);
        const sink =
          rq.found && Math.abs(world.road.at(rq.along).y - ground) < 1
            ? 1 -
              Math.min(1, Math.max(0, (rq.distance - rq.halfWidth + 0.2) / 1.0))
            : 0;
        tile.pos.push(x, ground + 0.03 - 0.08 * sink, z);
        tile.nor.push(nTmp.x, nTmp.y, nTmp.z);
        // The corner gets the inner edge band, the arc the outer dusty edge.
        tile.uv.push(
          k === 0 ? 0.1 : 0.01,
          ((x - j.x) * j.dx + (z - j.z) * j.dz) / texLength(tex),
        );
      }
      // Fan from the corner; winding so the face points up (+Y) whichever side the arc runs.
      const cross =
        (f.arc[0][0] - f.c[0]) * (f.arc[1][1] - f.c[1]) -
        (f.arc[0][1] - f.c[1]) * (f.arc[1][0] - f.c[0]);
      for (let k = 1; k < f.arc.length; k++)
        if (cross < 0) tile.idx.push(v0, v0 + k, v0 + k + 1);
        else tile.idx.push(v0, v0 + k + 1, v0 + k);
    }
  }
  // Resampled ways by tile, the tiles nearest `focus` first: each tile's mesh is added as soon as its ways are built.
  const byTile = new Map<
    string,
    { p: PathDef; pts: [number, number, number][] }[]
  >();
  for (const p of paths) {
    // Resample the polyline every PATH_STEP metres.
    const pts: [number, number, number][] = [];
    let dist = 0;
    for (let k = 0; k + 3 < p.pts.length; k += 2) {
      const ax = p.pts[k];
      const az = p.pts[k + 1];
      const L = Math.hypot(p.pts[k + 2] - ax, p.pts[k + 3] - az);
      const n = Math.max(1, Math.ceil(L / PATH_STEP));
      for (let i = 0; i < n; i++) {
        const t = i / n;
        pts.push([
          ax + (p.pts[k + 2] - ax) * t,
          az + (p.pts[k + 3] - az) * t,
          dist + L * t,
        ]);
      }
      dist += L;
    }
    const e = p.pts.length;
    pts.push([p.pts[e - 2], p.pts[e - 1], dist]);
    if (pts.length < 2) continue;
    const mid = pts[pts.length >> 1];
    // A lane in the highway's cut (MapDef.parkwayLanes) is a carriageway: lane markings, no centre line.
    const isLane = world.gen.isParkwayLane(world.gen.paths!.paths.indexOf(p));
    // Streets that carry the street model: base asphalt at true scale, the lines come from the marking layer.
    const tex: RoadTexture = isLane
      ? 'road_parkway'
      : world.map.cityStreets && hasMarkings(p)
        ? baseTexture(p)
        : pathTexture(p.kind, p.width, !!world.map.cityStreets);
    const key = `${tex}:${Math.floor(mid[0] / PATH_TILE)},${Math.floor(mid[1] / PATH_TILE)}`;
    let list = byTile.get(key);
    if (!list) {
      byTile.set(key, (list = []));
      if (!tiles.has(key))
        tiles.set(key, { tex, pos: [], nor: [], uv: [], idx: [] });
    }
    list.push({ p, pts });
  }
  const keys = [...tiles.keys()];
  if (focus) {
    const d = (k: string) => {
      const [i, j] = k
        .slice(k.indexOf(':') + 1)
        .split(',')
        .map(Number);
      return Math.hypot(
        (i + 0.5) * PATH_TILE - focus.x,
        (j + 0.5) * PATH_TILE - focus.z,
      );
    };
    keys.sort((a, b) => d(a) - d(b));
  }
  const group = new Group();
  group.name = 'paths';
  parent.add(group);
  const markings = new MarkingBuilder();
  // Lane lines stop where another street's carriageway crosses or meets this one (at its level, not along it): NYC paints
  // no lines inside an intersection, and the ways' paint crossed in a mesh of lines. Driveways / service ways do not
  // break a street's lines (except in a junction box that keeps its ribbons, MapDef.ribbonAreas).
  const xq = newPathQuery();
  const xa = { x: 0, z: 0 };
  const xb = { x: 0, z: 0 };
  const crossed = (
    pi: number,
    x: number,
    z: number,
    tx: number,
    tz: number,
    y: number,
  ): boolean => {
    const net = world.gen.paths!;
    const plazas = world.gen.plazas;
    const box = !plazas.empty && plazas.keepsRibbons(x, z);
    net.query(
      x,
      z,
      xq,
      'tarmac',
      (qi) =>
        qi !== pi &&
        !net.paths[qi].bridge &&
        (box || net.paths[qi].kind !== 'service'),
    );
    if (!xq.found || xq.distance > net.halfWidthAt(xq.path, xq.along))
      return false;
    if (Math.abs(world.gen.pathHeight(xq.path, xq.along) - y) > 1.5)
      return false;
    const L = net.lengths[xq.path];
    net.pointAt(xq.path, Math.max(0, xq.along - 2), xa);
    net.pointAt(xq.path, Math.min(L, xq.along + 2), xb);
    const l = Math.hypot(xb.x - xa.x, xb.z - xa.z) || 1;
    return Math.abs(((xb.x - xa.x) * tx + (xb.z - xa.z) * tz) / l) < 0.9;
  };
  // the crosswalks per street (street-detail.ts): stop bars stand before them
  const crossingsOf = new Map<number, { at: number; atEnd: boolean }[]>();
  for (const c of world.streetDetail?.crossings ?? []) {
    const list = crossingsOf.get(c.path) ?? [];
    list.push(c);
    crossingsOf.set(c.path, list);
  }
  for (const key of keys) {
    const tile = tiles.get(key)!;
    for (const { p, pts } of byTile.get(key) ?? []) {
      const v0 = tile.pos.length / 3;
      const plazas = world.gen.plazas;
      const before = beyond(p, false);
      const after = beyond(p, true);
      const net = world.gen.paths!;
      const pi = net.paths.indexOf(p);
      // (the carriageways / parkway lanes run down in the trench under a plaza: drawn)
      const onTop = !world.gen.isCarriageway(pi);
      const marked =
        !!world.map.cityStreets &&
        hasMarkings(p) &&
        !world.gen.isParkwayLane(pi);
      const markRows: MarkRow[] = [];
      for (let r = 0; r < pts.length; r++) {
        const rowTops: number[] = [];
        // Lane drops / gains taper (the width meets the continuing way's), see PathNetwork.halfWidthAt.
        const hw = net.halfWidthAt(pi, pts[r][2]);
        let a: number[] = pts[Math.max(0, r - 1)];
        let b: number[] = pts[Math.min(pts.length - 1, r + 1)];
        if (r === 0) a = before ?? a;
        if (r === pts.length - 1) b = after ?? b;
        const tl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const tx = (b[0] - a[0]) / tl;
        const tz = (b[1] - a[1]) / tl;
        hf.normal(pts[r][0], pts[r][1], nTmp);
        // The street's own height line: where the land under an edge falls away (the parkway cut beside a service road,
        // a pit at a deck end, the trench under a portal slab) the ribbon stays on it - sagging with the land let the
        // terrain show through the lanes.
        const prof = world.gen.pathHeight(pi, pts[r][2]);
        for (let c = 0; c < cols; c++) {
          const lat = PATH_ACROSS[c] * hw;
          const x = pts[r][0] + tz * lat;
          const z = pts[r][1] - tx * lat;
          // Same 3 cm lift as the stage ribbon (polygon offset decides who is on top) - but sunk under the
          // stage road where they overlap, so a ramp / side street never paints over its lane markings. Not a street
          // passing under a stage-road bridge (it sank into the trench floor: gravel through the street).
          world.road.query(x, z, rq);
          const ground = hf.height(x, z);
          // (Not on / under the stage road: a ramp sinks under its lanes, an underpass street stays on its floor.)
          const free =
            !rq.found ||
            (rq.distance > rq.halfWidth + 1 &&
              !(world.road.bridges.length && world.road.bridgeAt(rq.along)));
          const y =
            free &&
            ground < prof - 0.15 &&
            (ground > prof - 3 || world.gen.portals.inside(x, z))
              ? prof
              : ground;
          const sink =
            rq.found && Math.abs(world.road.at(rq.along).y - y) < 1
              ? 1 -
                Math.min(
                  1,
                  Math.max(0, (rq.distance - rq.halfWidth + 0.2) / 1.0),
                )
              : 0;
          // Inside a junction plaza the plaza is the surface: a ribbon along its edge stays just under it.
          let top = y + 0.03 - 0.08 * sink;
          if (onTop && !plazas.empty && plazas.inside(x, z)) {
            const ph = plazas.height(x, z);
            // (an area that keeps its ribbons: they lie on the paving)
            if (ph !== undefined)
              top = plazas.keepsRibbons(x, z)
                ? ph + 0.02
                : Math.min(top, ph + 0.01);
          }
          tile.pos.push(x, top, z);
          rowTops.push(top);
          // One normal per row (taken at the centre): the ribbons are flat roads, and this saves four height samples per vertex.
          tile.nor.push(nTmp.x, nTmp.y, nTmp.z);
          // (modelled streets: metres across, so the same asphalt at any width)
          tile.uv.push(
            marked ? lat / 8 : 1 - (PATH_ACROSS[c] + 1) / 2,
            pts[r][2] / texLength(tile.tex),
          );
        }
        if (marked)
          markRows.push({
            x: pts[r][0],
            z: pts[r][1],
            tx,
            tz,
            hw,
            d: pts[r][2],
            y: rowTops,
            skip:
              (onTop &&
                !plazas.empty &&
                plazas.inside(pts[r][0], pts[r][1]) &&
                !plazas.keepsRibbons(pts[r][0], pts[r][1])) ||
              crossed(pi, pts[r][0], pts[r][1], tx, tz, prof),
          });
        if (r % 256 === 255) yield;
      }
      for (let r = 0; r < pts.length - 1; r++) {
        // Inside a junction plaza the plaza is the street (no lane lines, no ribbons crossing each other).
        if (
          onTop &&
          !plazas.empty &&
          plazas.inside(pts[r][0], pts[r][1]) &&
          plazas.inside(pts[r + 1][0], pts[r + 1][1]) &&
          !plazas.keepsRibbons(pts[r][0], pts[r][1])
        )
          continue;
        for (let c = 0; c < cols - 1; c++) {
          const a = v0 + r * cols + c;
          const d = a + cols;
          tile.idx.push(a, d, d + 1, a, d + 1, a + 1);
        }
      }
      if (marked) {
        const len = pts[pts.length - 1][2];
        markings.addPath(
          p,
          markRows,
          len,
          straightJoint(paths, p, false),
          straightJoint(paths, p, true),
          mergePaint(paths, p),
        );
        markings.addGlyphs(
          p,
          markRows,
          junctionGlyphs(p, len, crossingsOf.get(pi) ?? [], p.width, [
            freeFrom(markRows, false),
            freeFrom(markRows, true),
          ]),
        );
      }
      yield;
    }
    const mat = getRoadMaterial(
      tile.tex,
      tile.tex === 'road_parkway' || tile.tex === 'asphalt_highway' ? 2 : 1,
    );
    const g = new BufferGeometry();
    g.setAttribute(
      'position',
      new BufferAttribute(new Float32Array(tile.pos), 3),
    );
    g.setAttribute(
      'normal',
      new BufferAttribute(new Float32Array(tile.nor), 3),
    );
    g.setAttribute('uv', new BufferAttribute(new Float32Array(tile.uv), 2));
    g.setIndex(tile.idx);
    g.computeBoundingSphere();
    const mesh = new Mesh(g, mat);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    yield;
  }
  // The paint of the modelled streets.
  const paint = markings.build();
  if (paint) parent.add(paint);
}
