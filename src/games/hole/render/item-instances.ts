import {
  Color,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three';
import { buildItemGeometry } from '../items/builders';
import { getItemMaterials } from './materials';
import { FallState, fallPose } from '../sim/fall';
import { TEETER_MAX } from '../sim/eat';
import type { World } from '../sim/world';

const UP = new Vector3(0, 1, 0);
const ZERO_SCALE = new Matrix4().makeScale(0, 0, 0);
/** Items of one type are split into square cells of this size (m), so the camera and the shadow only draw the cells they see. */
const CELL = 64;
/** Maps with moving items (denser, heavier animals) use smaller cells: finer culling for a few more draw calls. */
const CELL_MOVERS = 32;
/** Added to a cell's bounding radius (m): items slide towards the hole while falling and tall ones tilt. */
const BOUNDS_MARGIN = 14;

/**
 * One InstancedMesh per item type + geometry variant + 64 m map cell (frustum
 * culled: a phone draws the few cells in view, not the whole island). Instance
 * matrices are written once; afterwards only teetering / tipping / falling
 * items are updated.
 */
export class ItemInstances {
  readonly group = new Group();
  private meshes: InstancedMesh[] = [];
  private lists: number[][] = [];
  private mesh: Uint16Array;
  private slot: Uint32Array;
  private dirty = new Set<InstancedMesh>();
  private moverMeshes = new Set<InstancedMesh>();
  private m = new Matrix4();
  private q = new Quaternion();
  private qt = new Quaternion();
  private p = new Vector3();
  private axis = new Vector3();
  private scale = new Vector3(1, 1, 1);

  constructor(private world: World) {
    const n = world.n;
    const CELL_SIZE = world.movers.length ? CELL_MOVERS : CELL;
    this.mesh = new Uint16Array(n);
    this.slot = new Uint32Array(n);
    const groups = new Map<string, number[]>();
    for (let i = 0; i < n; i++) {
      const info = world.types[world.type[i]];
      const key = `${info.id}#${world.variant[i] % info.variants}#${Math.floor(world.x[i] / CELL_SIZE)}#${Math.floor(world.z[i] / CELL_SIZE)}#${world.isMover[i]}`;
      const list = groups.get(key);
      if (list) list.push(i);
      else groups.set(key, [i]);
    }
    const mats = getItemMaterials();
    const tint = new Color();
    for (const [key, list] of groups) {
      const [id, v] = key.split('#');
      const name = `${id}#${v}`;
      const info = world.types[world.type[list[0]]];
      const mesh = new InstancedMesh(
        buildItemGeometry(id, Number(v)),
        mats[info.style],
        list.length,
      );
      mesh.name = name;
      mesh.castShadow = info.size >= 0.5;
      mesh.receiveShadow = false;
      const idx = this.meshes.length;
      this.meshes.push(mesh);
      this.lists.push(list);
      list.forEach((item, k) => {
        this.mesh[item] = idx;
        this.slot[item] = k;
        this.poseMatrix(item, this.m);
        mesh.setMatrixAt(k, this.m);
        if (info.paints?.length) {
          const pi = world.paint[item];
          tint.setHex(
            pi >= 0 ? info.paints[pi % info.paints.length] : 0xffffff,
          );
          mesh.setColorAt(k, tint);
        }
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      // movers: the culling sphere is recomputed from their real positions whenever they moved (`update`)
      if (world.isMover[list[0]]) {
        mesh.instanceMatrix.setUsage(DynamicDrawUsage);
        this.moverMeshes.add(mesh);
      }
      mesh.computeBoundingSphere();
      mesh.boundingSphere!.radius += BOUNDS_MARGIN;
      this.group.add(mesh);
    }
  }

  /** World index of an instance (for picking). */
  itemOf(mesh: InstancedMesh, slot: number): number {
    return this.lists[this.meshes.indexOf(mesh)][slot];
  }

  /** Show only meshes whose item passes `keep` (viewers: tier filter). */
  filter(keep: (itemIndex: number) => boolean): void {
    this.meshes.forEach((m, k) => (m.visible = keep(this.lists[k][0])));
  }

  /** Update the instances of every active (moving) item and hide the ones that fell in. */
  update(): void {
    const w = this.world;
    for (const i of w.active) this.write(i);
    if (w.moving.size) {
      for (const i of w.moving) this.write(i);
      w.moving.clear();
    }
    if (w.gone.length) {
      for (const i of w.gone) this.write(i);
      w.gone.length = 0;
    }
    for (const mesh of this.dirty) {
      mesh.instanceMatrix.needsUpdate = true;
      if (this.moverMeshes.has(mesh)) {
        // asleep movers stand still, so this only runs for meshes with an awake animal: cheap
        mesh.computeBoundingSphere();
        mesh.boundingSphere!.radius += BOUNDS_MARGIN;
      }
    }
    this.dirty.clear();
  }

  /** Re-write one item (used by viewers that edit the world). */
  write(i: number): void {
    this.poseMatrix(i, this.m);
    const mesh = this.meshes[this.mesh[i]];
    mesh.setMatrixAt(this.slot[i], this.m);
    this.dirty.add(mesh);
  }

  /** Make every item visible and upright again. */
  resetAll(): void {
    const w = this.world;
    for (let i = 0; i < w.n; i++) this.write(i);
    this.update();
  }

  private poseMatrix(i: number, out: Matrix4): void {
    const w = this.world;
    const state = w.state[i];
    if (state === FallState.Gone) {
      out.copy(ZERO_SCALE);
      return;
    }
    let x = w.x[i];
    let z = w.z[i];
    let y = w.lift[i];
    let yaw = w.rot[i];
    let tilt = 0;
    const dir = w.dir[i];
    if (state === FallState.Idle) {
      tilt = w.teeter[i] * TEETER_MAX;
    } else {
      const f = w.fall[i];
      if (f) {
        const pose = fallPose(f, w.t[i]);
        const pull = w.pull[i] * pose.slide;
        x += Math.cos(dir) * pull;
        z += Math.sin(dir) * pull;
        y += pose.y;
        yaw += pose.yaw;
        tilt = pose.tilt;
      }
    }
    this.q.setFromAxisAngle(UP, yaw);
    if (tilt !== 0) {
      this.axis.set(Math.sin(dir), 0, -Math.cos(dir));
      this.qt.setFromAxisAngle(this.axis, tilt);
      this.q.premultiply(this.qt);
    }
    this.p.set(x, y, z);
    out.compose(this.p, this.q, this.scale);
  }
}
