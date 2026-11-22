import {
  BufferGeometry,
  Frustum,
  Group,
  IndirectStorageBufferAttribute,
  Matrix4,
  Mesh,
  StorageBufferAttribute,
  Vector4,
  type Camera,
  type ComputeNode,
  type Material,
  type WebGPURenderer,
} from 'three/webgpu';
import {
  atomicAdd,
  atomicLoad,
  atomicStore,
  Fn,
  If,
  instanceIndex,
  mat3,
  mat4,
  normalLocal,
  positionLocal,
  storage,
  uint,
  uniform,
  vec4,
} from 'three/tsl';
import { nodeMaterial } from './materials';
import type { TrialSlice } from './slice';

/**
 * The trial's GPU path (WebGPU only): every instance of the slice sits in GPU buffers once, and each frame a compute
 * pass picks its level by distance, drops it outside the view (shadow-casting levels stay whole, as in cpu-draw.ts)
 * and appends it to its level's list; a second pass writes each draw's instance count into the indirect draw
 * arguments. The CPU uploads nothing per frame but the camera, and never reads anything back.
 */

/** Levels per asset the cull pass handles (the catalog's most). */
const MAX_LODS = 4;

export class GpuDraw {
  readonly group = new Group();
  readonly instances: number;
  private reset: ComputeNode;
  private cull: ComputeNode;
  private finish: ComputeNode;
  private camPos = uniform(new Vector4());
  private planes = Array.from({ length: 6 }, () => uniform(new Vector4()));
  private frustum = new Frustum();
  private vp = new Matrix4();

  /**
   * `firstInstance`: each draw's list offset rides in its indirect arguments (firstInstance, needs the
   * `indirect-first-instance` feature), so the draws share one vertex program with no per-object uniform. Otherwise
   * a per-object uniform carries it.
   */
  constructor(slice: TrialSlice, firstInstance: boolean) {
    const groups = slice.groups;
    const N = groups.reduce((s, g) => s + g.count, 0);
    this.instances = N;
    const rows = new Float32Array(N * 16);
    const spheres = new Float32Array(N * 4);
    const instGroup = new Uint32Array(N);
    const groupLods = new Float32Array(groups.length * 4);
    const groupSlot = new Uint32Array(groups.length);
    const slotBase: number[] = [];
    const slotKeep: number[] = [];
    const draws: {
      slot: number;
      geometry: BufferGeometry;
      material: Material;
      castShadow: boolean;
    }[] = [];
    let at = 0;
    let visible = 0;
    groups.forEach((g, gi) => {
      rows.set(g.matrices, at * 16);
      spheres.set(g.spheres, at * 4);
      instGroup.fill(gi, at, at + g.count);
      at += g.count;
      groupSlot[gi] = slotBase.length;
      g.lods.slice(0, MAX_LODS).forEach((lod, li) => {
        groupLods[gi * 4 + li] = lod.maxDistance;
        const slot = slotBase.length;
        slotBase.push(visible);
        slotKeep.push(lod.castShadow ? 1 : 0);
        visible += g.count;
        for (const p of lod.parts)
          draws.push({
            slot,
            geometry: p.geometry,
            material: p.material,
            castShadow: lod.castShadow,
          });
      });
    });
    const S = slotBase.length;
    const D = draws.length;

    const rowsBuf = storage(
      new StorageBufferAttribute(rows, 4),
      'vec4',
      N * 4,
    ).toReadOnly();
    const sphereBuf = storage(
      new StorageBufferAttribute(spheres, 4),
      'vec4',
      N,
    ).toReadOnly();
    const groupBuf = storage(
      new StorageBufferAttribute(instGroup, 1),
      'uint',
      N,
    ).toReadOnly();
    const lodBuf = storage(
      new StorageBufferAttribute(groupLods, 4),
      'vec4',
      groups.length,
    ).toReadOnly();
    const slotOfGroup = storage(
      new StorageBufferAttribute(groupSlot, 1),
      'uint',
      groups.length,
    ).toReadOnly();
    const baseBuf = storage(
      new StorageBufferAttribute(new Uint32Array(slotBase), 1),
      'uint',
      S,
    ).toReadOnly();
    const keepBuf = storage(
      new StorageBufferAttribute(new Uint32Array(slotKeep), 1),
      'uint',
      S,
    ).toReadOnly();
    const counters = storage(
      new StorageBufferAttribute(new Uint32Array(S), 1),
      'uint',
      S,
    ).toAtomic();
    const visibleAttr = new StorageBufferAttribute(
      new Uint32Array(Math.max(1, visible)),
      1,
    );
    const visibleOut = storage(visibleAttr, 'uint', visible);
    const visibleIn = storage(visibleAttr, 'uint', visible).toReadOnly();
    const args = new Uint32Array(D * 5);
    const drawSlot = new Uint32Array(D);
    draws.forEach((d, i) => {
      const idx = d.geometry.index;
      args[i * 5] = idx ? idx.count : d.geometry.getAttribute('position').count;
      // Indexed: [indexCount, instanceCount, firstIndex, baseVertex, firstInstance]; plain: [vertexCount,
      // instanceCount, firstVertex, firstInstance].
      if (firstInstance) args[i * 5 + (idx ? 4 : 3)] = slotBase[d.slot];
      drawSlot[i] = d.slot;
    });
    const argsAttr = new IndirectStorageBufferAttribute(args, 5);
    const argsBuf = storage(argsAttr, 'uint', D * 5);
    const drawSlotBuf = storage(
      new StorageBufferAttribute(drawSlot, 1),
      'uint',
      D,
    ).toReadOnly();

    this.reset = Fn(() => {
      atomicStore(counters.element(instanceIndex), uint(0));
    })().compute(S);

    const cam = this.camPos;
    const planes = this.planes;
    this.cull = Fn(() => {
      const i = instanceIndex;
      const g = groupBuf.element(i);
      const lods = lodBuf.element(g);
      const s = sphereBuf.element(i);
      const d = s.xyz.sub(cam.xyz).length();
      const k = uint(MAX_LODS).toVar();
      If(d.lessThan(lods.w), () => k.assign(3));
      If(d.lessThan(lods.z), () => k.assign(2));
      If(d.lessThan(lods.y), () => k.assign(1));
      If(d.lessThan(lods.x), () => k.assign(0));
      If(k.lessThan(uint(MAX_LODS)), () => {
        const slot = slotOfGroup.element(g).add(k);
        const seen = keepBuf.element(slot).equal(uint(1)).toVar();
        If(seen.not(), () => {
          const inside = s.w.negate().toVar();
          const p0 = planes[0];
          const p1 = planes[1];
          const p2 = planes[2];
          const p3 = planes[3];
          const p4 = planes[4];
          const p5 = planes[5];
          const m = p0.xyz
            .dot(s.xyz)
            .add(p0.w)
            .min(p1.xyz.dot(s.xyz).add(p1.w))
            .min(p2.xyz.dot(s.xyz).add(p2.w))
            .min(p3.xyz.dot(s.xyz).add(p3.w))
            .min(p4.xyz.dot(s.xyz).add(p4.w))
            .min(p5.xyz.dot(s.xyz).add(p5.w));
          seen.assign(m.greaterThanEqual(inside));
        });
        If(seen, () => {
          const n = atomicAdd(counters.element(slot), uint(1));
          visibleOut.element(baseBuf.element(slot).add(n)).assign(i);
        });
      });
    })().compute(N);

    this.finish = Fn(() => {
      const c = atomicLoad(
        counters.element(drawSlotBuf.element(instanceIndex)),
      );
      argsBuf.element(instanceIndex.mul(5).add(1)).assign(c);
    })().compute(D);

    // Draws: the level's list from this draw's slot base, the instance's matrix from the row buffer.
    const base = uniform(0, 'uint').onObjectUpdate(
      ({ object }) => (object?.userData.base as number) ?? 0,
    );
    const placed = Fn(() => {
      const id = visibleIn.element(
        firstInstance ? instanceIndex : base.add(instanceIndex),
      );
      const r = id.mul(4);
      const m = mat4(
        rowsBuf.element(r),
        rowsBuf.element(r.add(1)),
        rowsBuf.element(r.add(2)),
        rowsBuf.element(r.add(3)),
      );
      normalLocal.assign(mat3(m).mul(normalLocal));
      return m.mul(vec4(positionLocal, 1)).xyz;
    })();
    const materials = new Map<Material, Material>();
    draws.forEach((d, i) => {
      let mat = materials.get(d.material);
      if (!mat) {
        const nm = nodeMaterial(d.material);
        nm.positionNode = placed;
        materials.set(d.material, (mat = nm));
      }
      // Own geometry object (shared attributes) per draw: the indirect offset is per geometry.
      const geo = new BufferGeometry();
      for (const [name, attr] of Object.entries(d.geometry.attributes))
        geo.setAttribute(name, attr);
      geo.setIndex(d.geometry.index);
      geo.setIndirect(argsAttr, i * 5 * 4);
      const mesh = new Mesh(geo, mat);
      mesh.userData.base = slotBase[d.slot];
      mesh.frustumCulled = false;
      mesh.castShadow = d.castShadow;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    });
  }

  /** Runs the cull passes for this camera (before the frame's render). */
  update(renderer: WebGPURenderer, camera: Camera): void {
    this.camPos.value.set(
      camera.position.x,
      camera.position.y,
      camera.position.z,
      0,
    );
    this.vp.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    this.frustum.setFromProjectionMatrix(this.vp);
    this.frustum.planes.forEach((p, i) =>
      this.planes[i].value.set(p.normal.x, p.normal.y, p.normal.z, p.constant),
    );
    renderer.compute([this.reset, this.cull, this.finish]);
  }
}
