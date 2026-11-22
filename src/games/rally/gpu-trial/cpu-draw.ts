import {
  DynamicDrawUsage,
  Frustum,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  type Camera,
  type Material,
} from 'three';
import type { TrialSlice } from './slice';

/**
 * The trial's CPU path (what the game does today, world/instance-streamer.ts, done every frame): one InstancedMesh
 * per (asset, variant, level, part); the CPU picks each instance's level by distance, drops the ones outside the view
 * (shadow-casting levels are kept whole: they throw shadows into it) and uploads the matrices of the rest.
 */

interface Level {
  maxDistance: number;
  keepWhole: boolean;
  matrices: InstancedBufferAttribute;
  meshes: InstancedMesh[];
  n: number;
}

export class CpuDraw {
  readonly group = new Group();
  private levels: { slice: TrialSlice['groups'][number]; lods: Level[] }[] = [];
  private frustum = new Frustum();
  private vp = new Matrix4();
  /** Instances drawn in the last update. */
  drawn = 0;

  constructor(slice: TrialSlice, material: (m: Material) => Material) {
    for (const g of slice.groups) {
      const lods = g.lods.map((lod) => {
        const matrices = new InstancedBufferAttribute(
          new Float32Array(g.count * 16),
          16,
        );
        matrices.setUsage(DynamicDrawUsage);
        const meshes = lod.parts.map((p) => {
          const im = new InstancedMesh(
            p.geometry,
            material(p.material),
            g.count,
          );
          // Every part of a level draws the same instances: one buffer.
          im.instanceMatrix = matrices;
          im.count = 0;
          im.frustumCulled = false;
          im.castShadow = lod.castShadow;
          im.receiveShadow = true;
          this.group.add(im);
          return im;
        });
        return {
          maxDistance: lod.maxDistance,
          keepWhole: lod.castShadow,
          matrices,
          meshes,
          n: 0,
        };
      });
      this.levels.push({ slice: g, lods });
    }
  }

  /** Picks levels and culls for this camera. */
  update(camera: Camera): void {
    this.vp.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    this.frustum.setFromProjectionMatrix(this.vp);
    const planes = this.frustum.planes;
    const cx = camera.position.x;
    const cy = camera.position.y;
    const cz = camera.position.z;
    let drawn = 0;
    for (const { slice, lods } of this.levels) {
      for (const l of lods) l.n = 0;
      const s = slice.spheres;
      const m = slice.matrices;
      const nl = lods.length;
      for (let i = 0; i < slice.count; i++) {
        const x = s[i * 4];
        const y = s[i * 4 + 1];
        const z = s[i * 4 + 2];
        const r = s[i * 4 + 3];
        const dx = x - cx;
        const dy = y - cy;
        const dz = z - cz;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        let k = 0;
        while (k < nl && d >= lods[k].maxDistance) k++;
        if (k === nl) continue;
        const l = lods[k];
        if (!l.keepWhole) {
          let out = false;
          for (let p = 0; p < 6 && !out; p++) {
            const pl = planes[p];
            out =
              pl.normal.x * x +
                pl.normal.y * y +
                pl.normal.z * z +
                pl.constant <
              -r;
          }
          if (out) continue;
        }
        (l.matrices.array as Float32Array).set(
          m.subarray(i * 16, i * 16 + 16),
          l.n * 16,
        );
        l.n++;
      }
      for (const l of lods) {
        for (const im of l.meshes) {
          im.count = l.n;
          im.visible = l.n > 0;
        }
        if (l.n) {
          l.matrices.clearUpdateRanges();
          l.matrices.addUpdateRange(0, l.n * 16);
          l.matrices.needsUpdate = true;
        }
        drawn += l.n;
      }
    }
    this.drawn = drawn;
  }
}
