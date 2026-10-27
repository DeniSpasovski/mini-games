import { Bone, Euler, Matrix4, Quaternion, Skeleton, Vector3 } from 'three';
import { BONE_COUNT, BONE_PARENT } from './critters';

/**
 * One critter's skeleton (`BONE` in `critters.ts`), posed by code each frame. The bones are not in the scene graph:
 * `solve` writes their matrices in critter space straight into `matrixWorld`, and the body mesh is bound
 * DETACHED with an identity bind matrix, so the mesh's own transform (waddle, squash, KO) applies on top. `skin[b]`
 * moves a bind-pose point with bone `b`: the hat, vest and boots ride on it. Allocation-free per frame.
 */
export class Rig {
  readonly skeleton: Skeleton;
  /** Local rotation per bone, set by the animation (reset to rest with `rest`). */
  readonly q: Quaternion[] = [];
  /** Per bone: its frame in critter space, and the bind -> posed transform. */
  readonly model: Matrix4[] = [];
  readonly skin: Matrix4[] = [];
  /** A uniform scale per bone (cheeks puffing, a squashed tail); 1 = as built. */
  readonly scale = new Float32Array(BONE_COUNT).fill(1);
  private readonly inv: Matrix4[] = [];
  private readonly e = new Euler();
  private readonly m = new Matrix4();

  constructor(private readonly joints: Float32Array) {
    const bones: Bone[] = [];
    for (let b = 0; b < BONE_COUNT; b++) {
      const bone = new Bone();
      bone.matrixAutoUpdate = false;
      bone.matrixWorldAutoUpdate = false;
      bones.push(bone);
      this.q.push(new Quaternion());
      this.model.push(new Matrix4());
      this.skin.push(new Matrix4());
      this.inv.push(
        new Matrix4().makeTranslation(
          -joints[b * 3],
          -joints[b * 3 + 1],
          -joints[b * 3 + 2],
        ),
      );
    }
    this.skeleton = new Skeleton(bones, this.inv);
    this.solve();
  }

  rest(): void {
    for (const q of this.q) q.identity();
    this.scale.fill(1);
  }

  /** Turn bone `b` by Euler angles (radians, x then y then z), on top of what it has. */
  turn(b: number, x: number, y: number, z: number): void {
    this.q[b].multiply(QT.setFromEuler(this.e.set(x, y, z, 'XYZ')));
  }

  /** Bone frames from the local rotations, parents first (every bone's parent has a lower index). */
  solve(): void {
    const j = this.joints;
    for (let b = 0; b < BONE_COUNT; b++) {
      const p = BONE_PARENT[b];
      const s = this.scale[b];
      this.m.makeRotationFromQuaternion(this.q[b]);
      if (s !== 1) this.m.scale(SC.setScalar(s));
      if (p < 0) this.m.setPosition(j[b * 3], j[b * 3 + 1], j[b * 3 + 2]);
      else
        this.m.setPosition(
          j[b * 3] - j[p * 3],
          j[b * 3 + 1] - j[p * 3 + 1],
          j[b * 3 + 2] - j[p * 3 + 2],
        );
      if (p < 0) this.model[b].copy(this.m);
      else this.model[b].multiplyMatrices(this.model[p], this.m);
      this.skeleton.bones[b].matrixWorld.copy(this.model[b]);
      this.skin[b].multiplyMatrices(this.model[b], this.inv[b]);
    }
  }
}

const QT = new Quaternion();
const SC = new Vector3();
