import type { InstancedMesh, Line, Mesh, Object3D, Vector3 } from 'three';
import { Sphere } from 'three';

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
  private items: { obj: Object3D; x: number; z: number; r: number }[] = [];
  private lastX = Infinity;
  private lastZ = Infinity;

  constructor(
    root: Object3D,
    private maxDistance: number,
    private step = 10,
  ) {
    root.updateMatrixWorld(true);
    const s = new Sphere();
    root.traverse((o) => {
      const m = o as Mesh & Partial<InstancedMesh> & Partial<Line>;
      if (!m.isMesh && !m.isLine) return;
      if (m.isInstancedMesh) {
        // All instances (the geometry's own sphere covers only one).
        m.computeBoundingSphere!();
        s.copy(m.boundingSphere!);
      } else {
        if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
        s.copy(m.geometry.boundingSphere!);
      }
      s.applyMatrix4(m.matrixWorld);
      this.items.push({ obj: o, x: s.center.x, z: s.center.z, r: s.radius });
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
      it.obj.visible = show;
      if (!show) hidden++;
    }
    this.hidden = hidden;
  }

  setMaxDistance(d: number): void {
    this.maxDistance = d;
    this.lastX = Infinity;
  }
}
