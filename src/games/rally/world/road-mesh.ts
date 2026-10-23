import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Vector3,
} from 'three';
import { applyRoadSurface, isRoadSurface } from '../engine/road-surface';
import { getTexture } from '../engine/textures';
import {
  type PathDef,
  roadSurfaceAt,
  type RoadTexture,
} from '../maps/shared/types';
import { barrierMeshJob } from './barrier-mesh';
import { bridgeMeshJob } from './bridge-mesh';
import { cutWallMeshJob } from './cut-wall-mesh';
import { roadMarkingsMesh } from './road-markings';
import { aerialwayMeshJob } from './aerialway-mesh';
import { powerLineMeshJob } from './power-line-mesh';
import { railMeshJob } from './rail-mesh';
import { streetDetailMeshJob } from './street-detail-mesh';
import { newRoadQuery } from './road';
import { gantryMeshJob } from './gantry-mesh';
import { goreMeshJob } from './gore-mesh';
import {
  type Junction,
  type JunctionFillet,
  junctionFillets,
} from './junctions';
import { plazaMeshJob } from './plaza-mesh';
import { stageSignMeshJob } from './stage-sign-mesh';
import { buildingMeshJob } from './building-mesh';
import { waterMeshJob } from './water-mesh';
import type { World } from './world';
import { GroundTerrain } from './heightfield';
import { newPathQuery } from './real-data';

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
    : t === 'road_street' || t === 'road_city'
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
    const baked = isRoadSurface(texture);
    m = new MeshStandardMaterial({
      // Baked asphalt (engine/road-surface.ts) brings its own normal + roughness maps and tone variation.
      ...(baked
        ? {}
        : {
            map: getTexture(texture),
            // Relief from the texture itself: gravel stones / tarmac grain catch a low sun.
            bumpMap: getTexture(texture),
            bumpScale: texture === 'road' ? 2.2 : 1.2,
            roughness: texture === 'road' ? 0.93 : 0.86,
          }),
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: layer === 0 ? -3 : layer === 2 ? -2 : -1,
      polygonOffsetUnits: layer === 0 ? -6 : layer === 2 ? -4 : -2,
    });
    // Canopy shadows beyond the shadow map (engine/world-shading.ts).
    m.defines = { RALLY_GROUND: 1 };
    if (baked) applyRoadSurface(m, texture);
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

/**
 * buildRoadMesh in slices of about `sliceMs` with `pause` awaited between them (the game's load, the map viewer): the
 * loading bar keeps moving and no single task freezes the tab. Same meshes as buildRoadMesh.
 */
export async function buildRoadMeshSliced(
  world: World,
  pause: () => Promise<void>,
  sliceMs = 25,
): Promise<Group> {
  const job = roadMeshJob(world);
  let r = job.next();
  while (!r.done) {
    const until = performance.now() + sliceMs;
    while (!r.done && performance.now() < until) r = job.next();
    if (!r.done) await pause();
  }
  return r.value;
}

/** A junction mouth: the side road, its rounded corners, their dust strips and the pad outline (see `junctionMouths`). */
interface Mouth {
  j: Junction;
  fillets: JunctionFillet[];
  /** Per fillet: its arc moved `band` inside (the inner edge of its dust strip). */
  inners: number[][][];
  /** Width of the dust strip round each curve (m). */
  band: number;
  /** The pad: both corners and the side road's first metres, from one stage edge up the side road and back. */
  outline: number[][];
  /** Bounding box of the outline grown by `BLEND_FADE`. */
  box: [number, number, number, number];
}

/**
 * Metres over which the road surfaces blend from the world-aligned junction asphalt back to their own texture (over
 * two side road rows, PATH_STEP).
 */
const BLEND_FADE = 6;

/**
 * Junction mouths of plain tarmac side roads (`road_tarmac`). City maps (kerbs, sidewalks, plazas, markings) have none.
 *
 * How the mouth is surfaced (the usual answer for spline roads: one surface the crossing roads blend into, as terrain
 * virtual texturing / blend masks do it): every road surface there (stage road edge, side road, corners) fades within
 * `BLEND_FADE` of the pad into the same world-aligned asphalt (`road_tarmac_junction`, sampled by world XZ in the road
 * shader, weight in the `jw` attribute), so where they meet they are one continuous surface with no seams, folds or
 * wheel paths running into the stage road. The gravel dust runs round each curve.
 */
function junctionMouths(world: World): Mouth[] {
  if (world.map.cityStreets) return [];
  return (
    world.gen.junctions
      .filter(
        (j) =>
          j.surface === 'tarmac' &&
          pathTexture(j.kind, j.width, false) === 'road_tarmac',
      )
      // Two ways joining at the same spot (a doubled way in the map data): one mouth.
      .filter(
        (j, i, all) =>
          !all
            .slice(0, i)
            .some(
              (o) =>
                o.side === j.side && Math.hypot(o.x - j.x, o.z - j.z) < o.width,
            ),
      )
      .map((j) => {
        const s0 = world.road.at(j.along);
        const edge = (d: number): [number, number] => {
          const s = world.road.at(j.along + d);
          const lat = j.side * s.halfWidth;
          return [s.x + s.tz * lat, s.z - s.tx * lat];
        };
        const fillets = junctionFillets(j, s0.tx, s0.tz, edge);
        const band = 0.18 * j.width;
        const radius = Math.min(8, Math.max(4, j.width * 1.4));
        const nx0 = -j.dz;
        const nz0 = j.dx;
        const inners: number[][][] = [];
        // Each side's pad edge, from the stage road up the side road: the inner edge of its dust strip, or (no fillet)
        // the side road's edge `band` inside, so its own dusty edge still shows.
        const sides = new Map<number, number[][]>();
        for (const f of fillets) {
          const n = f.arc.length;
          const [mx, mz] = [
            (f.arc[0][0] + f.arc[n - 1][0]) / 2,
            (f.arc[0][1] + f.arc[n - 1][1]) / 2,
          ];
          const inner = f.arc.map(([x, z], k) => {
            const [ax, az] = f.arc[Math.max(0, k - 1)];
            const [bx, bz] = f.arc[Math.min(n - 1, k + 1)];
            const tl = Math.hypot(bx - ax, bz - az) || 1;
            let nx = -(bz - az) / tl;
            let nz = (bx - ax) / tl;
            // Inside = away from the chord's middle (the curve bows from the chord towards the corner).
            if (nx * (mx - x) + nz * (mz - z) > 0) [nx, nz] = [-nx, -nz];
            return [x + nx * band, z + nz * band];
          });
          inners.push(inner);
          const sd = (f.c[0] - j.x) * nx0 + (f.c[1] - j.z) * nz0 >= 0 ? 1 : -1;
          sides.set(sd, inner);
        }
        for (const sd of [1, -1])
          if (!sides.has(sd)) {
            const e = (sd * j.width) / 2 - sd * band;
            const ex = j.x + nx0 * e;
            const ez = j.z + nz0 * e;
            const line: number[][] = [];
            for (let d = -2; d <= radius + 1e-6; d += radius / 4)
              line.push([ex + j.dx * d, ez + j.dz * d]);
            sides.set(sd, line);
          }
        const outline = [...sides.get(1)!, ...[...sides.get(-1)!].reverse()];
        const xs = outline.map((q) => q[0]);
        const zs = outline.map((q) => q[1]);
        const box: Mouth['box'] = [
          Math.min(...xs) - BLEND_FADE,
          Math.min(...zs) - BLEND_FADE,
          Math.max(...xs) + BLEND_FADE,
          Math.max(...zs) + BLEND_FADE,
        ];
        return { j, fillets, inners, band, outline, box };
      })
  );
}

/** Weight of the world-aligned junction asphalt at a point: 1 on a pad, fading to 0 `BLEND_FADE` away from it. */
function junctionBlend(mouths: Mouth[], x: number, z: number): number {
  let w = 0;
  for (const m of mouths) {
    const [x0, z0, x1, z1] = m.box;
    if (x < x0 || x > x1 || z < z0 || z > z1) continue;
    const o = m.outline;
    let inside = false;
    let d2 = Infinity;
    for (let i = 0, k = o.length - 1; i < o.length; k = i++) {
      const [ax, az] = o[k];
      const [bx, bz] = o[i];
      if (az > z !== bz > z && x < ((bx - ax) * (z - az)) / (bz - az) + ax)
        inside = !inside;
      const ex = bx - ax;
      const ez = bz - az;
      const t = Math.max(
        0,
        Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1)),
      );
      d2 = Math.min(d2, (ax + ex * t - x) ** 2 + (az + ez * t - z) ** 2);
    }
    if (inside) return 1;
    const f = Math.max(0, 1 - Math.sqrt(d2) / BLEND_FADE);
    w = Math.max(w, f * f * (3 - 2 * f));
  }
  return w;
}

/** buildRoadMesh as a time-sliced job: yields after every road segment / side road. */
export function* roadMeshJob(world: World): Generator<void, Group> {
  const group = new Group();
  group.name = 'road';
  const samples = world.road.samples;
  // Analytic sampling: same values as the heightfield at grid points, without
  // generating the 1 m cache along the whole road at load.
  const hf = world.analytic;
  const nTmp = new Vector3();
  const cols = ACROSS.length;
  // Segment starts: every SEGMENT samples, plus a break where the road surface changes.
  const starts: number[] = [];
  for (let i = 0; i < samples.length - 1;) {
    starts.push(i);
    const tex = roadSurfaceAt(world.map.road, samples[i].dist).texture;
    let end = Math.min(samples.length - 1, i + SEGMENT);
    for (let j = i + 1; j <= end; j++)
      if (roadSurfaceAt(world.map.road, samples[j].dist).texture !== tex) {
        end = j;
        break;
      }
    i = end;
  }
  const mouths = junctionMouths(world);
  for (const [si, start] of starts.entries()) {
    const end = starts[si + 1] ?? samples.length - 1;
    const rows = end - start + 1;
    const segTex = roadSurfaceAt(world.map.road, samples[start].dist).texture;
    const pos = new Float32Array(rows * cols * 3);
    const nor = new Float32Array(rows * cols * 3);
    const uv = new Float32Array(rows * cols * 2);
    const jw = new Float32Array(rows * cols);
    const blends = segTex === 'road_tarmac' || segTex === 'road_tarmac_kerbed';
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
        // Across a junction mouth the edge band fades into the junction asphalt (only the outer columns, out to
        // where the side road's pad dips under: the stage road's own wheel paths run on through the junction).
        if (blends && Math.abs(ACROSS[c]) > 0.5)
          jw[v] = junctionBlend(mouths, x, z);
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
    g.setAttribute('jw', new BufferAttribute(jw, 1));
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
  const paths = yield* timed('paths', pathMeshesJob(world));
  if (paths) group.add(paths);
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
  const aerial = yield* timed('aerialways', aerialwayMeshJob(world));
  if (aerial) group.add(aerial);
  const rail = yield* timed('railways', railMeshJob(world));
  if (rail) group.add(rail);
  const cutWalls = yield* timed('cutWalls', cutWallMeshJob(world));
  if (cutWalls) group.add(cutWalls);
  const markings = roadMarkingsMesh(world);
  if (markings) group.add(markings);
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

const PATH_ACROSS = [-1, -0.5, 0, 0.5, 1];
/**
 * A side road sinks under the stage ribbon over this many metres inside the road's half width (the ribbon reaches 4 %
 * past it): sinking at or outside the edge let the verge show through the side road at the mouth.
 */
const SINK_RAMP = 0.8;
/** Rings of a junction fillet fan from its corner to its arc. */
const FILLET_RINGS = 4;
const PATH_STEP = 3; // m between ribbon rows
const PATH_TILE = 256; // m, one merged mesh per tile

/**
 * Paved non-stage roads (village streets, motorway, ...) as terrain-hugging ribbons,
 * merged per 256 m tile. Unpaved tracks too on maps with `trackRibbons` (gravel texture); elsewhere they are only
 * painted into the terrain splat.
 */
function* pathMeshesJob(world: World): Generator<void, Group | undefined> {
  // Bridge decks are drawn by bridge-mesh at their own height.
  const tracks = !!world.map.trackRibbons;
  const paths = world.gen.paths?.paths.filter(
    (p) =>
      (p.surface === 'tarmac' || (tracks && p.surface === 'dirt')) && !p.bridge,
  );
  if (!paths?.length) return undefined;
  // The ground, not the top surface: a street under a stage-road bridge stays down in its underpass.
  const hf = new GroundTerrain(world.gen);
  const nTmp = new Vector3();
  const rq = newRoadQuery();
  const pqOther = newPathQuery();
  const pqEdge = newPathQuery();
  const hasJoiners = paths.some((q) => q.joinsUnder);
  const tiles = new Map<
    string,
    {
      tex: RoadTexture;
      pos: number[];
      nor: number[];
      uv: number[];
      /** Junction blend weight (see `junctionMouths`). */
      jw: number[];
      idx: number[];
    }
  >();
  const mouths = junctionMouths(world);
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
    // An end that stops short of the stage road (OSM joins the way to the road's raw line; the drawn road is smoothed
    // and can run metres away on a bend, and a slanted way's square end leaves one corner out on the verge) runs on
    // until both corners of its end are well under the stage ribbon, so no verge shows between them.
    const under = (x: number, z: number) => {
      world.road.query(x, z, rq);
      return rq.found && rq.distance < rq.halfWidth - 0.3;
    };
    for (const atEnd of [false, true]) {
      const [ex, ez, ed] = atEnd ? pts[pts.length - 1] : pts[0];
      const [px, pz] = atEnd ? pts[pts.length - 2] : pts[1];
      world.road.query(ex, ez, rq);
      if (!rq.found || rq.distance > rq.halfWidth + 12) continue;
      const l = Math.hypot(ex - px, ez - pz) || 1;
      const dx = (ex - px) / l;
      const dz = (ez - pz) / l;
      const hw = p.width / 2;
      const ok = (d: number) => {
        const x = ex + dx * d;
        const z = ez + dz * d;
        return (
          under(x + dz * hw, z - dx * hw) && under(x - dz * hw, z + dx * hw)
        );
      };
      if (ok(0)) continue;
      let reach = 0;
      for (let d = 0.5; d <= 16; d += 0.5)
        if (ok(d)) {
          reach = d;
          break;
        }
      // Rows every half metre, so the sink follows the stage road's edge across the run.
      for (let d = 0.5; d <= reach; d += 0.5) {
        const row: [number, number, number] = [
          ex + dx * d,
          ez + dz * d,
          atEnd ? ed + d : ed - d,
        ];
        if (atEnd) pts.push(row);
        else pts.unshift(row);
      }
    }
    const mid = pts[pts.length >> 1];
    // A lane in the highway's cut (MapDef.parkwayLanes) is a carriageway: lane markings, no centre line.
    const tex = world.gen.isParkwayLane(world.gen.paths!.paths.indexOf(p))
      ? 'road_parkway'
      : p.surface === 'dirt'
        ? 'road'
        : pathTexture(p.kind, p.width, !!world.map.cityStreets);
    const key = `${tex}:${Math.floor(mid[0] / PATH_TILE)},${Math.floor(mid[1] / PATH_TILE)}`;
    let tile = tiles.get(key);
    if (!tile)
      tiles.set(
        key,
        (tile = { tex, pos: [], nor: [], uv: [], jw: [], idx: [] }),
      );
    const v0 = tile.pos.length / 3;
    const plazas = world.gen.plazas;
    const before = beyond(p, false);
    const after = beyond(p, true);
    const net = world.gen.paths!;
    const pi = net.paths.indexOf(p);
    // (the carriageways / parkway lanes run down in the trench under a plaza: drawn)
    const onTop = !world.gen.isCarriageway(pi);
    // Where a paved way overlaps an earlier one (a fork's shared start, a way doubled in the map data) it lies 1.5 cm
    // under it: two ribbons at one height flickered between their textures.
    for (let r = 0; r < pts.length; r++) {
      // Lane drops / gains taper (the width meets the continuing way's), see PathNetwork.halfWidthAt.
      // (clamped: an end run on under the stage road lies past the way's own length)
      const along = Math.min(net.lengths[pi], Math.max(0, pts[r][2]));
      const hw = net.halfWidthAt(pi, along);
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
      const prof = world.gen.pathHeight(pi, along);
      let near = false;
      if (tex === 'road_tarmac') {
        net.query(pts[r][0], pts[r][1], pqEdge, 'tarmac', (i) => i < pi);
        near = pqEdge.found && pqEdge.distance < pqEdge.halfWidth + hw;
      }
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
                Math.max(
                  0,
                  (rq.distance - rq.halfWidth + SINK_RAMP) / SINK_RAMP,
                ),
              )
            : 0;
        // Inside a junction plaza the plaza is the surface: a ribbon along its edge stays just under it.
        // Within a few metres of the stage road the carved shoulder folds the terrain into creases that a 3 cm lift does
        // not clear (the end of a side road showed the terrain through it): the ribbon rises up to 5 cm more there.
        const crease =
          rq.found && rq.distance > rq.halfWidth
            ? Math.max(0, 1 - (rq.distance - rq.halfWidth) / 8)
            : 0;
        // A way that joins another one (`PathDef.joinsUnder`) lies under that one's ribbon where they overlap; the way it joins rises
        // up to 5 cm near the joining one's edge (the junction's carve folds the terrain into creases, like the stage road's).
        let sinkOther = 0;
        let creaseOther = 0;
        if (p.joinsUnder || hasJoiners) {
          net.query(x, z, pqOther, undefined, (i) => i !== pi);
          if (pqOther.found) {
            // (full under the other ribbon, none a step outside its edge: a ribbon dipping below the terrain there shows it)
            if (p.joinsUnder)
              sinkOther =
                1 -
                Math.min(
                  1,
                  Math.max(0, (pqOther.distance - pqOther.halfWidth) / 0.3),
                );
            else if (net.paths[pqOther.path].joinsUnder)
              creaseOther = Math.max(
                0,
                1 - Math.max(0, pqOther.distance - pqOther.halfWidth) / 6,
              );
          }
        }
        // (where a joining way's carve folds the terrain, the ribbon covers the highest ground round the vertex)
        let yTop = y;
        if (creaseOther > 0)
          yTop = Math.max(
            y,
            hf.height(x + 1.5, z),
            hf.height(x - 1.5, z),
            hf.height(x, z + 1.5),
            hf.height(x, z - 1.5),
          );
        let top =
          y +
          (yTop - y) * creaseOther +
          0.03 +
          0.05 * Math.max(crease, creaseOther) -
          0.08 * sink -
          0.1 * sinkOther;
        if (onTop && !plazas.empty && plazas.inside(x, z)) {
          const ph = plazas.height(x, z);
          // (an area that keeps its ribbons: they lie on the paving)
          if (ph !== undefined)
            top = plazas.keepsRibbons(x, z)
              ? ph + 0.02
              : Math.min(top, ph + 0.01);
        }
        let under = 0;
        if (near) {
          net.query(x, z, pqEdge, 'tarmac', (i) => i < pi);
          if (pqEdge.found && pqEdge.distance < pqEdge.halfWidth + 0.3)
            under = 0.015;
        }
        tile.pos.push(x, top - under, z);
        tile.jw.push(tex === 'road_tarmac' ? junctionBlend(mouths, x, z) : 0);
        // One normal per row (taken at the centre): the ribbons are flat roads, and this saves four height samples per vertex.
        tile.nor.push(nTmp.x, nTmp.y, nTmp.z);
        let u = 1 - (PATH_ACROSS[c] + 1) / 2;
        // An edge lying on another paved way (a fork, a crossing): no dusty edge band in the middle of the paving -
        // mirrored back over the next column instead (plain asphalt, same scale).
        if (tex === 'road_tarmac' && (c === 0 || c === cols - 1)) {
          net.query(x, z, pqEdge, 'tarmac', (i) => i !== pi);
          if (pqEdge.found && pqEdge.distance < pqEdge.halfWidth - 0.2)
            u = 2 * (1 - (PATH_ACROSS[c === 0 ? 1 : c - 1] + 1) / 2) - u;
        }
        tile.uv.push(u, pts[r][2] / texLength(tex));
      }
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
    yield;
  }
  // Junction mouths (`junctionMouths`): the pad (fully the world-aligned junction asphalt) and a dust strip round each
  // curve, in the side road ribbons' tiles / material, on their height rule (sunk under the stage road's edge).
  const tex: RoadTexture = 'road_tarmac';
  const padLen = texLength('road_tarmac_junction');
  for (const { j, fillets, inners, band, outline } of mouths) {
    const key = `${tex}:${Math.floor(j.x / PATH_TILE)},${Math.floor(j.z / PATH_TILE)}`;
    let tile = tiles.get(key);
    if (!tile)
      tiles.set(
        key,
        (tile = { tex, pos: [], nor: [], uv: [], jw: [], idx: [] }),
      );
    const t = tile;
    const put = (x: number, z: number, u: number, v: number, w: number) => {
      world.road.query(x, z, rq);
      const ground = hf.height(x, z);
      const sink =
        rq.found && Math.abs(world.road.at(rq.along).y - ground) < 1
          ? 1 -
            Math.min(
              1,
              Math.max(0, (rq.distance - rq.halfWidth + SINK_RAMP) / SINK_RAMP),
            )
          : 0;
      // The side road ribbon's crease lift near the stage road plus 1.5 cm, and (like a ribbon where another way
      // joins it) over the highest ground round the vertex: the junction's carve folds the terrain into creases.
      const crease =
        rq.found && rq.distance > rq.halfWidth
          ? Math.max(0, 1 - (rq.distance - rq.halfWidth) / 8)
          : 0;
      const top = Math.max(
        ground,
        hf.height(x + 1.5, z),
        hf.height(x - 1.5, z),
        hf.height(x, z + 1.5),
        hf.height(x, z - 1.5),
      );
      t.pos.push(
        x,
        ground + (top - ground) * crease + 0.045 + 0.05 * crease - 0.08 * sink,
        z,
      );
      // (its own ground normal: one for the whole mouth lit the pad unlike the ribbons round it on a slope)
      hf.normal(x, z, nTmp);
      t.nor.push(nTmp.x, nTmp.y, nTmp.z);
      t.uv.push(u, v);
      t.jw.push(w);
    };
    // Dust strip round each curve: from the arc (u 0, the texture's edge) to the pad, blending into it.
    fillets.forEach((f, fi) => {
      const inner = inners[fi];
      let dist = 0;
      for (let k = 0; k < f.arc.length - 1; k++) {
        const [px, pz] = f.arc[k];
        const [qx, qz] = f.arc[k + 1];
        const step = Math.hypot(qx - px, qz - pz) / texLength(tex);
        const v0 = t.pos.length / 3;
        const ub = band / j.width;
        put(px, pz, 0, dist, 0);
        put(qx, qz, 0, dist + step, 0);
        put(inner[k + 1][0], inner[k + 1][1], ub, dist + step, 1);
        put(inner[k][0], inner[k][1], ub, dist, 1);
        const up =
          (qx - px) * (inner[k][1] - pz) - (qz - pz) * (inner[k][0] - px) < 0;
        if (up) t.idx.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3);
        else t.idx.push(v0, v0 + 2, v0 + 1, v0, v0 + 3, v0 + 2);
        dist += step;
      }
    });
    // The pad: fanned from a point in the mouth, with rings so it follows the ground (one flat triangle let the
    // terrain poke through). Face up (+Y).
    const tri = (pa: number[], pb: number[], pc: number[]) => {
      const up =
        (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0]) <
        0;
      const v0 = t.pos.length / 3;
      for (const [x, z] of [pa, pb, pc]) put(x, z, x / padLen, z / padLen, 1);
      if (up) t.idx.push(v0, v0 + 1, v0 + 2);
      else t.idx.push(v0, v0 + 2, v0 + 1);
    };
    const radius = Math.min(8, Math.max(4, j.width * 1.4));
    const centre = [j.x + j.dx * radius * 0.4, j.z + j.dz * radius * 0.4];
    const ring = (f: number) =>
      [...outline, outline[0]].map(([x, z]) => [
        centre[0] + (x - centre[0]) * f,
        centre[1] + (z - centre[1]) * f,
      ]);
    let prev = ring(1 / FILLET_RINGS);
    for (let k = 0; k < prev.length - 1; k++) tri(centre, prev[k], prev[k + 1]);
    for (let r = 2; r <= FILLET_RINGS; r++) {
      const next = ring(r / FILLET_RINGS);
      for (let k = 0; k < next.length - 1; k++) {
        tri(prev[k], next[k], next[k + 1]);
        tri(prev[k], next[k + 1], prev[k + 1]);
      }
      prev = next;
    }
  }
  yield;
  const group = new Group();
  group.name = 'paths';
  for (const t of tiles.values()) {
    const mat = getRoadMaterial(t.tex, t.tex === 'road_parkway' ? 2 : 1);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(t.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(t.nor), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(t.uv), 2));
    g.setAttribute('jw', new BufferAttribute(new Float32Array(t.jw), 1));
    g.setIndex(t.idx);
    g.computeBoundingSphere();
    const mesh = new Mesh(g, mat);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    yield;
  }
  return group;
}
