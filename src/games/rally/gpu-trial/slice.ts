import {
  BufferAttribute,
  BufferGeometry,
  Euler,
  Matrix4,
  Mesh,
  Quaternion,
  Sphere,
  Vector3,
  type Group,
  type Material,
} from 'three';
import { getAssetMeta } from '../assets/catalog';
import { getAsset } from '../assets/library';
import { LAZY_PACK_KINDS, loadTreePacks } from '../assets/builders/tree-packs';
import { variantInfo } from '../trees/variants';
import { buildRoadMeshSliced } from '../world/road-mesh';
import type { ScatterInstance } from '../world/scatter';
import type { World } from '../world/world';

/**
 * The GPU trial's scene (pages/gpu-trial.ts): one stretch of a stage as plain data that every renderer of the trial
 * draws the same way. The terrain around it, the road meshes over it and every scatter + detail instance (rocks,
 * plants, grass, props, pack trees) in reach of it, grouped per (asset, variant) with each level's parts.
 * Generated species trees (trees/, their own renderer in the game) are drawn as pack trees of the same height.
 */

export interface TrialPart {
  geometry: BufferGeometry;
  material: Material;
}

export interface TrialLod {
  /** Drawn while the camera is nearer than this (m). */
  maxDistance: number;
  castShadow: boolean;
  parts: TrialPart[];
}

export interface TrialGroup {
  key: string;
  lods: TrialLod[];
  count: number;
  /** Instance world matrices (16 floats each, column-major). */
  matrices: Float32Array;
  /** Instance bounding spheres in world space: x, y, z, radius. */
  spheres: Float32Array;
}

export interface TrialSlice {
  groups: TrialGroup[];
  terrain: Mesh;
  road: Mesh[];
  /** The camera's run: road centre points 1 m apart (x, y, z). */
  path: Float32Array;
  instances: number;
  /** Generated species trees drawn as pack trees (`standIn`). */
  standIns: number;
  /** Instances left out, per reason. */
  skipped: Record<string, number>;
}

/** The furthest any scatter level is drawn: chunks this far from the run are gathered (m). */
const SCATTER_REACH = 450;
/** Detail (grass) chunks this far from the run are gathered (m). */
const DETAIL_REACH = 140;
/** Terrain grid spacing (m). */
const TERRAIN_STEP = 2;

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _p = new Vector3();
const _s = new Vector3();
const _c = new Vector3();

export async function buildSlice(
  world: World,
  from: number,
  length: number,
  trees: boolean,
  progress: (text: string) => Promise<void>,
): Promise<TrialSlice> {
  const road = world.stageRoad;
  const to = Math.min(world.stage.finish, from + length);
  const pts: number[] = [];
  for (let d = from; d <= to; d += 1) {
    const p = road.at(d);
    pts.push(p.x, world.heightAt(p.x, p.z), p.z);
  }
  const path = new Float32Array(pts);

  // Chunks within reach of the run.
  const cs = world.scatter.chunkSize;
  const near = (cx: number, cz: number, reach: number) => {
    const x = (cx + 0.5) * cs;
    const z = (cz + 0.5) * cs;
    const r = reach + cs * 0.71;
    for (let i = 0; i < path.length; i += 3 * 10) {
      const dx = path[i] - x;
      const dz = path[i + 2] - z;
      if (dx * dx + dz * dz < r * r) return true;
    }
    return false;
  };
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (let i = 0; i < path.length; i += 3) {
    x0 = Math.min(x0, path[i]);
    x1 = Math.max(x1, path[i]);
    z0 = Math.min(z0, path[i + 2]);
    z1 = Math.max(z1, path[i + 2]);
  }
  const instances: ScatterInstance[] = [];
  const skipped: Record<string, number> = {};
  const skip = (why: string) => (skipped[why] = (skipped[why] ?? 0) + 1);
  const cx0 = Math.floor((x0 - SCATTER_REACH) / cs);
  const cx1 = Math.floor((x1 + SCATTER_REACH) / cs);
  const cz0 = Math.floor((z0 - SCATTER_REACH) / cs);
  const cz1 = Math.floor((z1 + SCATTER_REACH) / cs);
  let done = 0;
  const total = (cx1 - cx0 + 1) * (cz1 - cz0 + 1);
  for (let cx = cx0; cx <= cx1; cx++)
    for (let cz = cz0; cz <= cz1; cz++) {
      if (++done % 40 === 0)
        await progress(`Scatter ${Math.round((100 * done) / total)} %`);
      if (!near(cx, cz, SCATTER_REACH)) continue;
      instances.push(...world.scatter.chunk(cx, cz).instances);
      if (near(cx, cz, DETAIL_REACH))
        instances.push(
          ...world.scatter.detail(cx, cz),
          ...world.scatter.nearDetail(cx, cz),
        );
    }

  // Group per (asset, variant).
  await progress('Asset models');
  await loadTreePacks(...LAZY_PACK_KINDS);
  const byKey = new Map<string, ScatterInstance[]>();
  let standIns = 0;
  for (let inst of instances) {
    if (inst.tree) {
      const tree = trees ? standIn(inst) : null;
      if (!tree) {
        skip('species trees');
        continue;
      }
      inst = tree;
      standIns++;
    }
    const key = `${inst.asset}:${inst.variant}`;
    let list = byKey.get(key);
    if (!list) byKey.set(key, (list = []));
    list.push(inst);
  }
  const groups: TrialGroup[] = [];
  let n = 0;
  for (const [key, list] of byKey) {
    const [asset, v] = key.split(':');
    const meta = getAssetMeta(asset);
    const lods: TrialLod[] = [];
    const bounds = new Sphere();
    try {
      meta.lods.forEach((spec, lod) => {
        const built = getAsset(asset, Number(v), lod);
        lods.push({
          maxDistance: spec.maxDistance,
          castShadow: spec.castShadow,
          parts: built.parts.map((p) => ({
            geometry: p.geometry,
            material: p.material,
          })),
        });
        if (lod === 0)
          for (const p of built.parts) {
            p.geometry.computeBoundingSphere();
            const s = p.geometry.boundingSphere!;
            if (bounds.isEmpty()) bounds.copy(s);
            else bounds.union(s);
          }
      });
    } catch {
      skipped[`no model (${asset})`] = list.length;
      continue;
    }
    if (!lods.length || bounds.isEmpty()) continue;
    const matrices = new Float32Array(list.length * 16);
    const spheres = new Float32Array(list.length * 4);
    list.forEach((inst, i) => {
      _e.set(inst.tiltX, inst.rotY, inst.tiltZ, 'YXZ');
      _q.setFromEuler(_e);
      _s.set(
        inst.scale * (inst.sx ?? 1),
        inst.scale * (inst.sy ?? 1),
        inst.scale * (inst.sz ?? 1),
      );
      _m.compose(_p.set(inst.x, inst.y, inst.z), _q, _s);
      _m.toArray(matrices, i * 16);
      _c.copy(bounds.center).applyMatrix4(_m);
      spheres.set(
        [_c.x, _c.y, _c.z, bounds.radius * Math.max(_s.x, _s.y, _s.z)],
        i * 4,
      );
    });
    groups.push({ key, lods, count: list.length, matrices, spheres });
    n += list.length;
  }

  await progress('Terrain');
  const terrain = terrainMesh(
    world,
    x0 - SCATTER_REACH,
    z0 - SCATTER_REACH,
    x1 + SCATTER_REACH,
    z1 + SCATTER_REACH,
  );

  await progress('Road');
  const roadGroup: Group = await buildRoadMeshSliced(
    world,
    () => new Promise((r) => setTimeout(r)),
  );
  const roadMeshes: Mesh[] = [];
  roadGroup.updateMatrixWorld(true);
  const box = {
    x0: x0 - SCATTER_REACH,
    z0: z0 - SCATTER_REACH,
    x1: x1 + SCATTER_REACH,
    z1: z1 + SCATTER_REACH,
  };
  roadGroup.traverse((o) => {
    if (!(o as Mesh).isMesh) return;
    const mesh = o as Mesh;
    const g = mesh.geometry;
    g.computeBoundingSphere();
    const c = g.boundingSphere!.center.clone().applyMatrix4(mesh.matrixWorld);
    if (c.x < box.x0 || c.x > box.x1 || c.z < box.z0 || c.z > box.z1) return;
    roadMeshes.push(mesh);
  });

  return {
    groups,
    terrain,
    road: roadMeshes,
    path,
    instances: n,
    standIns,
    skipped,
  };
}

/** Pack tree (assets/builders/tree-packs.ts) standing in for a generated species tree. */
function packFor(species: string): string {
  const s = species.toLowerCase();
  if (s.includes('pine') || s.includes('juniper') || s.includes('cypress'))
    return 'pack_pine';
  if (s.includes('fir')) return 'pack_fir';
  if (s.includes('birch') || s.includes('poplar')) return 'pack_birch';
  if (s.includes('willow')) return 'pack_willow';
  if (s.includes('maple') || s.includes('plane')) return 'pack_maple';
  if (s.includes('elm') || s.includes('hornbeam') || s.includes('beech'))
    return 'pack_elm';
  if (/bush|scrub|hazel|thicket|broom|bramble|hedge|sapling/.test(s))
    return 'pack_bush';
  return 'pack_oak';
}

const packHeights = new Map<string, number>();

/**
 * A generated species tree (trees/, drawn by its own renderer in the game) as the nearest pack tree at the same spot,
 * scaled to the same height: the trial draws one instancing path for everything.
 */
function standIn(inst: ScatterInstance): ScatterInstance | null {
  const pack = packFor(inst.tree!.species);
  const meta = getAssetMeta(pack);
  const variant = inst.variant % Math.max(1, meta.variants);
  const key = `${pack}:${variant}`;
  let h = packHeights.get(key);
  if (h === undefined) {
    try {
      let top = 0;
      for (const p of getAsset(pack, variant, 0).parts) {
        p.geometry.computeBoundingBox();
        top = Math.max(top, p.geometry.boundingBox!.max.y);
      }
      h = top;
    } catch {
      h = 0;
    }
    packHeights.set(key, h);
  }
  if (!h) return null;
  const target =
    variantInfo(inst.tree!.species, inst.variant).height * inst.scale;
  return { ...inst, asset: pack, variant, scale: target / h, tree: undefined };
}

/** A height grid over the box, coloured by slope (grass to bare rock). */
function terrainMesh(
  world: World,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
): Mesh {
  const nx = Math.ceil((x1 - x0) / TERRAIN_STEP) + 1;
  const nz = Math.ceil((z1 - z0) / TERRAIN_STEP) + 1;
  const pos = new Float32Array(nx * nz * 3);
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * TERRAIN_STEP;
      const z = z0 + j * TERRAIN_STEP;
      pos.set([x, world.heightAt(x, z), z], (j * nx + i) * 3);
    }
  const index = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let k = 0;
  for (let j = 0; j < nz - 1; j++)
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      index.set([a, c, b, b, c, d], k);
      k += 6;
    }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setIndex(new BufferAttribute(index, 1));
  g.computeVertexNormals();
  const nrm = g.getAttribute('normal');
  const col = new Float32Array(nx * nz * 3);
  for (let v = 0; v < nx * nz; v++) {
    const up = nrm.getY(v);
    const rock = Math.min(1, Math.max(0, (0.85 - up) / 0.2));
    // Linear colours: dry summer grass to grey limestone.
    col.set([0.09 + rock * 0.12, 0.1 + rock * 0.1, 0.04 + rock * 0.13], v * 3);
  }
  g.setAttribute('color', new BufferAttribute(col, 3));
  g.computeBoundingSphere();
  const mesh = new Mesh(g);
  mesh.receiveShadow = true;
  return mesh;
}
