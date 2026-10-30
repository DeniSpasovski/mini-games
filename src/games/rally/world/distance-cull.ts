import type {
  BatchedMesh,
  InstancedMesh,
  Line,
  Mesh,
  Object3D,
  Vector3,
} from 'three';
import { Matrix4, Sphere } from 'three';

/**
 * Hides the whole-map meshes of a group (the road group: stage road, other roads, barriers, bridges, water,
 * landmarks, cables) whose nearest point is further than `maxDistance` from the camera. They are built once for
 * the whole map and three.js only frustum-culls them, so a map with a wide free-drive background (ajvatovci:
 * Ilinden, Marino, the A2) drew roads and barriers out to the camera's far plane - beyond the streamed terrain,
 * floating over nothing. Use the terrain view distance (`quality.viewDistance`).
 *
 * Checks run only after the camera has moved `step` metres (a few hundred bounding-sphere tests).
 */
export class DistanceCull {
  /** `id` >= 0: an instance of a BatchedMesh (world/static-batch.ts), shown / hidden with `setVisibleAt`. */
  private items: {
    obj: Object3D;
    id: number;
    x: number;
    z: number;
    r: number;
  }[] = [];
  private lastX = Infinity;
  private lastZ = Infinity;

  constructor(
    root: Object3D,
    private maxDistance: number,
    private step = 10,
  ) {
    root.updateMatrixWorld(true);
    const s = new Sphere();
    const at = new Matrix4();
    root.traverse((o) => {
      const m = o as Mesh & Partial<InstancedMesh> & Partial<Line>;
      if (!m.isMesh && !m.isLine) return;
      const b = o as Partial<BatchedMesh>;
      if (b.isBatchedMesh) {
        // Per instance (a tile), not the batch.
        for (let i = 0; i < b.instanceCount!; i++) {
          b.getBoundingSphereAt!(b.getGeometryIdAt!(i), s);
          s.applyMatrix4(b.getMatrixAt!(i, at)).applyMatrix4(o.matrixWorld);
          this.items.push({
            obj: o,
            id: i,
            x: s.center.x,
            z: s.center.z,
            r: s.radius,
          });
        }
        return;
      }
      if (m.isInstancedMesh) {
        // All instances (the geometry's own sphere covers only one).
        m.computeBoundingSphere!();
        s.copy(m.boundingSphere!);
      } else {
        if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
        s.copy(m.geometry.boundingSphere!);
      }
      s.applyMatrix4(m.matrixWorld);
      this.items.push({
        obj: o,
        id: -1,
        x: s.center.x,
        z: s.center.z,
        r: s.radius,
      });
    });
  }

  /** Number of objects currently hidden (diagnostics). */
  hidden = 0;

  /** Show / hide by horizontal distance from `pos`. */
  update(pos: Vector3, force = false): void {
    if (
      !force &&
      Math.hypot(pos.x - this.lastX, pos.z - this.lastZ) < this.step
    )
      return;
    this.lastX = pos.x;
    this.lastZ = pos.z;
    let hidden = 0;
    for (const it of this.items) {
      const show =
        Math.hypot(it.x - pos.x, it.z - pos.z) - it.r <= this.maxDistance;
      if (it.id >= 0) (it.obj as BatchedMesh).setVisibleAt(it.id, show);
      else it.obj.visible = show;
      if (!show) hidden++;
    }
    this.hidden = hidden;
  }

  setMaxDistance(d: number): void {
    this.maxDistance = d;
    this.lastX = Infinity;
  }
}
