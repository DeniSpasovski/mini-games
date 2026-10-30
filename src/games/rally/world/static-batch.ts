import { BatchedMesh, Mesh, type Material, type Object3D } from 'three';

/**
 * The static meshes directly under `group` that share a material, shadow flags, layers and vertex layout -> one `BatchedMesh`
 * each: one multi-draw call per pass (WEBGL_multi_draw) instead of one draw per tile, still frustum-culled per tile
 * (three's per-object culling) and distance-culled per tile (world/distance-cull.ts `setVisibleAt`). Draw calls are
 * the main-thread cost (DETAILS.md "Performance rules"); a whole-map tile set (paths, buildings) was ~160 of them.
 * Transparent, multi-material, non-indexed and hooked meshes stay as they are. Returns the batches made.
 */
export function batchStatic(group: Object3D): BatchedMesh[] {
  group.updateMatrixWorld(true);
  const sets = new Map<string, Mesh[]>();
  for (const o of group.children) {
    const m = o as Mesh;
    if (
      !m.isMesh ||
      (m as Partial<BatchedMesh>).isBatchedMesh ||
      'isInstancedMesh' in m ||
      Array.isArray(m.material) ||
      (m.material as Material).transparent ||
      !m.geometry.index ||
      m.children.length ||
      m.onBeforeRender !== Mesh.prototype.onBeforeRender
    )
      continue;
    const layout = Object.entries(m.geometry.attributes)
      .map(([n, a]) => `${n}:${a.itemSize}:${a.normalized}`)
      .sort()
      .join(',');
    const key = `${(m.material as Material).uuid}|${m.castShadow}|${m.receiveShadow}|${m.renderOrder}|${m.layers.mask}|${layout}`;
    let set = sets.get(key);
    if (!set) sets.set(key, (set = []));
    set.push(m);
  }
  const out: BatchedMesh[] = [];
  for (const set of sets.values()) {
    if (set.length < 2) continue;
    let vertices = 0;
    let indices = 0;
    for (const m of set) {
      vertices += m.geometry.attributes.position.count;
      indices += m.geometry.index!.count;
    }
    const first = set[0];
    const b = new BatchedMesh(
      set.length,
      vertices,
      indices,
      first.material as Material,
    );
    b.name = `${group.name} batch`;
    b.castShadow = first.castShadow;
    b.receiveShadow = first.receiveShadow;
    b.renderOrder = first.renderOrder;
    // The far shadow pass picks its casters by layer (world/far-shadow.ts `farShadowCaster`).
    b.layers.mask = first.layers.mask;
    // Per-tile culling does it; the batch's own sphere would cover the map. No per-frame sort (opaque, spread out).
    b.frustumCulled = false;
    b.sortObjects = false;
    b.matrixAutoUpdate = false;
    for (const m of set) {
      const id = b.addInstance(b.addGeometry(m.geometry));
      b.setMatrixAt(id, m.matrix);
      group.remove(m);
      m.geometry.dispose();
    }
    group.add(b);
    out.push(b);
  }
  return out;
}
