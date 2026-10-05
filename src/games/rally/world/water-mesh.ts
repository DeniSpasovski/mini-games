import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
  ShapeUtils,
  Vector2,
  type Scene,
} from 'three';
import { getTexture } from '../engine/textures';
import type { World } from './world';

/**
 * Water in the carved canals / drains / rivers (`paths` with surface `water`): one flat
 * ribbon per channel at its water level (`TerrainGenerator.channelWaterLevel`, level
 * across, falling downstream), a little wider than the water so its edges tuck under the
 * banks - the terrain draws the shoreline. Where a road crosses (bridge / culvert) the
 * road embankment is above the water and hides it. Lakes / ponds / reservoirs are their
 * OSM polygon at the lake's level (`Lakes.levels`). Merged per 256 m tile.
 */
const STEP = 4; // m between rows
const TILE = 256;
/** Ribbon half width relative to the water half width (edges hidden by the banks). */
const OVERLAP = 1.18;
/** Ripple texture size (m) and drift speed (m/s). */
const RIPPLE = 9;
const DRIFT = 0.12;

let material: MeshStandardMaterial | undefined;

/** Shared murky-green water material; reflects the sky (scene environment) at full strength. */
export function getWaterMaterial(): MeshStandardMaterial {
  if (!material) {
    const normalMap = getTexture('water_normal').clone();
    normalMap.needsUpdate = true;
    material = new MeshStandardMaterial({
      color: new Color(0x26382c),
      roughness: 0.14,
      metalness: 0,
      normalMap,
      envMapIntensity: 0.4,
    });
    material.normalScale.set(0.18, 0.18);
    material.name = 'water';
  }
  return material;
}

/** Ripples drift and the sky is reflected: run before each water mesh draw. */
function animate(scene: Scene, mat: MeshStandardMaterial): void {
  if (scene.environment && mat.envMap !== scene.environment) {
    // Own env map so envMapIntensity is not the (low) scene environment intensity.
    mat.envMap = scene.environment;
    mat.needsUpdate = true;
  }
  const t = performance.now() / 1000;
  mat.normalMap!.offset.set((t * DRIFT) / RIPPLE, (t * DRIFT * 0.6) / RIPPLE);
}

export function* waterMeshJob(
  world: World,
): Generator<void, Group | undefined> {
  const gen = world.gen;
  const net = gen.channels;
  const lakes = gen.lakes;
  if (!net && !lakes) return undefined;
  const tiles = new Map<
    string,
    { pos: number[]; uv: number[]; idx: number[] }
  >();
  const pt = { x: 0, z: 0 };
  const pt2 = { x: 0, z: 0 };
  net?.paths.forEach((_, ci) => {
    const L = net.lengths[ci];
    const n = Math.max(2, Math.ceil(L / STEP) + 1);
    const step = L / (n - 1);
    const hw = gen.channelWaterHalfWidth(ci) * OVERLAP;
    net.pointAt(ci, L / 2, pt);
    const key = `${Math.floor(pt.x / TILE)},${Math.floor(pt.z / TILE)}`;
    let tile = tiles.get(key);
    if (!tile) tiles.set(key, (tile = { pos: [], uv: [], idx: [] }));
    const v0 = tile.pos.length / 3;
    for (let i = 0; i < n; i++) {
      const a = i * step;
      net.pointAt(ci, Math.max(0, a - 2), pt);
      net.pointAt(ci, Math.min(L, a + 2), pt2);
      const tl = Math.hypot(pt2.x - pt.x, pt2.z - pt.z) || 1;
      const tx = (pt2.x - pt.x) / tl;
      const tz = (pt2.z - pt.z) / tl;
      net.pointAt(ci, a, pt);
      const y = gen.channelWaterLevel(ci, a);
      for (const side of [-1, 1]) {
        const x = pt.x + tz * hw * side;
        const z = pt.z - tx * hw * side;
        tile.pos.push(x, y, z);
        // World-space UVs: ripples continue across channels and tiles.
        tile.uv.push(x / RIPPLE, z / RIPPLE);
      }
    }
    for (let i = 0; i < n - 1; i++) {
      const a = v0 + i * 2;
      tile.idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  });
  // Lakes: the polygon, flat at the water level (its rim strip lies under the shore).
  lakes?.polys.forEach((p, li) => {
    const contour: Vector2[] = [];
    let cx = 0;
    let cz = 0;
    for (let k = 0; k < p.length; k += 2) {
      contour.push(new Vector2(p[k], p[k + 1]));
      cx += p[k];
      cz += p[k + 1];
    }
    const n = contour.length;
    const key = `${Math.floor(cx / n / TILE)},${Math.floor(cz / n / TILE)}`;
    let tile = tiles.get(key);
    if (!tile) tiles.set(key, (tile = { pos: [], uv: [], idx: [] }));
    const v0 = tile.pos.length / 3;
    const y = lakes.levels[li];
    for (const c of contour) {
      tile.pos.push(c.x, y, c.y);
      tile.uv.push(c.x / RIPPLE, c.y / RIPPLE);
    }
    for (const [a, b, c] of ShapeUtils.triangulateShape(contour, [])) {
      // Face up (+Y): (b - a) x (c - a) must have a positive y.
      const A = contour[a];
      const B = contour[b];
      const C = contour[c];
      const up = (C.x - A.x) * (B.y - A.y) - (B.x - A.x) * (C.y - A.y);
      if (up >= 0) tile.idx.push(v0 + a, v0 + b, v0 + c);
      else tile.idx.push(v0 + a, v0 + c, v0 + b);
    }
  });
  yield;
  const group = new Group();
  group.name = 'water';
  const mat = getWaterMaterial();
  for (const t of tiles.values()) {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(t.pos), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(t.uv), 2));
    const nor = new Float32Array(t.pos.length);
    for (let i = 1; i < nor.length; i += 3) nor[i] = 1;
    g.setAttribute('normal', new BufferAttribute(nor, 3));
    g.setIndex(t.idx);
    g.computeBoundingSphere();
    const mesh = new Mesh(g, mat);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.onBeforeRender = (_r, scene) => animate(scene, mat);
    group.add(mesh);
    yield;
  }
  return group;
}
