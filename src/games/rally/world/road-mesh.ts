import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Vector3,
} from 'three';
import { getTexture } from '../engine/textures';
import { roadSurfaceAt, type RoadTexture } from '../maps/shared/types';
import { barrierMeshJob } from './barrier-mesh';
import { bridgeMeshJob } from './bridge-mesh';
import { cutWallMeshJob } from './cut-wall-mesh';
import { powerLineMeshJob } from './power-line-mesh';
import { streetDetailMeshJob } from './street-detail-mesh';
import { newRoadQuery } from './road';
import { gantryMeshJob } from './gantry-mesh';
import { goreMeshJob } from './gore-mesh';
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
  t === 'road_parkway' ? 12 : t === 'road_street' || t === 'road_city' ? 8 : 7;
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
 * the streets get city asphalt (a double yellow centre line from 6.4 m wide).
 */
export const pathTexture = (
  kind: string,
  width: number,
  city = false,
): RoadTexture =>
  (kind === 'motorway' || kind === 'trunk') && width >= 5.5
    ? 'road_parkway'
    : city && CITY_KINDS.has(kind)
      ? width >= 6.4
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
  for (const [si, start] of starts.entries()) {
    const end = starts[si + 1] ?? samples.length - 1;
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
  const paths = yield* timed('paths', pathMeshesJob(world));
  if (paths) group.add(paths);
  const barriers = yield* timed('barriers', barrierMeshJob(world));
  if (barriers) group.add(barriers);
  const streets = yield* timed('streetDetail', streetDetailMeshJob(world));
  if (streets) group.add(streets);
  const gore = yield* timed('gore', goreMeshJob(world));
  if (gore) group.add(gore);
  const power = yield* timed('powerLines', powerLineMeshJob(world));
  if (power) group.add(power);
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

const PATH_ACROSS = [-1, -0.5, 0, 0.5, 1];
const PATH_STEP = 3; // m between ribbon rows
const PATH_TILE = 256; // m, one merged mesh per tile

/**
 * Paved non-stage roads (village streets, motorway, ...) as terrain-hugging ribbons,
 * merged per 256 m tile. Unpaved tracks are only painted into the terrain splat.
 */
function* pathMeshesJob(world: World): Generator<void, Group | undefined> {
  // Bridge decks are drawn by bridge-mesh at their own height.
  const paths = world.gen.paths?.paths.filter(
    (p) => p.surface === 'tarmac' && !p.bridge,
  );
  if (!paths?.length) return undefined;
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
    const tex = pathTexture(p.kind, p.width, !!world.map.cityStreets);
    const key = `${tex}:${Math.floor(mid[0] / PATH_TILE)},${Math.floor(mid[1] / PATH_TILE)}`;
    let tile = tiles.get(key);
    if (!tile)
      tiles.set(key, (tile = { tex, pos: [], nor: [], uv: [], idx: [] }));
    const v0 = tile.pos.length / 3;
    const net = world.gen.paths!;
    const pi = net.paths.indexOf(p);
    for (let r = 0; r < pts.length; r++) {
      // Lane drops / gains taper (the width meets the continuing way's), see PathNetwork.halfWidthAt.
      const hw = net.halfWidthAt(pi, pts[r][2]);
      const a = pts[Math.max(0, r - 1)];
      const b = pts[Math.min(pts.length - 1, r + 1)];
      const tl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const tx = (b[0] - a[0]) / tl;
      const tz = (b[1] - a[1]) / tl;
      hf.normal(pts[r][0], pts[r][1], nTmp);
      for (let c = 0; c < cols; c++) {
        const lat = PATH_ACROSS[c] * hw;
        const x = pts[r][0] + tz * lat;
        const z = pts[r][1] - tx * lat;
        // Same 3 cm lift as the stage ribbon (polygon offset decides who is on top) - but sunk under the
        // stage road where they overlap, so a ramp / side street never paints over its lane markings. Not a street
        // passing under a stage-road bridge (it sank into the trench floor: gravel through the street).
        world.road.query(x, z, rq);
        const y = hf.height(x, z);
        const sink =
          rq.found && Math.abs(world.road.at(rq.along).y - y) < 1
            ? 1 -
              Math.min(1, Math.max(0, (rq.distance - rq.halfWidth + 0.2) / 1.0))
            : 0;
        tile.pos.push(x, y + 0.03 - 0.08 * sink, z);
        // One normal per row (taken at the centre): the ribbons are flat roads, and this saves four height samples per vertex.
        tile.nor.push(nTmp.x, nTmp.y, nTmp.z);
        tile.uv.push(1 - (PATH_ACROSS[c] + 1) / 2, pts[r][2] / texLength(tex));
      }
      if (r % 256 === 255) yield;
    }
    for (let r = 0; r < pts.length - 1; r++)
      for (let c = 0; c < cols - 1; c++) {
        const a = v0 + r * cols + c;
        const d = a + cols;
        tile.idx.push(a, d, d + 1, a, d + 1, a + 1);
      }
    yield;
  }
  const group = new Group();
  group.name = 'paths';
  for (const t of tiles.values()) {
    const mat = getRoadMaterial(t.tex, t.tex === 'road_parkway' ? 2 : 1);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(t.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(t.nor), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(t.uv), 2));
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
