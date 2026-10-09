import {
  BufferGeometry,
  CylinderGeometry,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  BoxGeometry,
  SphereGeometry,
  Object3D,
  Quaternion,
  Vector3,
} from 'three';
import type { CarPhysicsDef, SetupPreset } from '../../physics/types';
import { buildCoilover, SUSPENSION_STYLE_COLORS } from './suspension-mesh';
import type { SuspensionStyle } from './suspension-mesh';

/**
 * How one axle is built (all in the car's root frame, hub = static wheel centre):
 *   strut     - coil-over from a top mount in the strut tower down to the hub, one lower A-arm, a tie rod
 *   wishbone  - upper + lower double wishbones, coil-over leaning from the lower arm to the body
 *   axle      - rigid axle tube between the wheels, trailing arms, upright coil-over beside the wheel
 */
export type AxleLayout = 'strut' | 'wishbone' | 'axle';

export interface CornerSuspensionDef {
  style: SuspensionStyle;
  front: AxleLayout;
  rear: AxleLayout;
  /** Top mount height above the static hub centre (m): the strut tower / shock mount. */
  topY: { front: number; rear: number };
  /** Top mount distance inboard of the hub centre (m). */
  topIn: { front: number; rear: number };
  /** Axles whose wheels are driven: a drive shaft shows from the hub inboard (not on a rigid axle). */
  driven: ('front' | 'rear')[];
}

const Y = new Vector3(0, 1, 0);
const RODS_PER_CORNER = 9;
/** Coil-over thickness vs the setup screen's unit (a car-sized unit is stouter than a bench model). */
const GIRTH = 1.35;

const armMat = new MeshStandardMaterial({
  color: 0x2c2f33,
  roughness: 0.5,
  metalness: 0.6,
});
const chromeMat = new MeshStandardMaterial({
  color: 0xc8ccd0,
  roughness: 0.3,
  metalness: 0.9,
});

/**
 * Visible suspension for the four wheels of an imported car whose model has empty wheel wells: a real coil-over
 * (`buildCoilover`, the setup screen's unit, in the car's hardware style) between a fixed body point and the
 * bouncing hub, plus arms. Everything follows the wheels each frame (`sync`), like the real parts would.
 */
export class CornerSuspension {
  readonly group = new Object3D();
  private rods: InstancedMesh;
  private uprights: InstancedMesh;
  private joints: InstancedMesh;
  private jointCount = 0;
  private front: InstancedMesh[];
  private rear: InstancedMesh[];
  private springs: MeshStandardMaterial[] = [];
  private geoms: BufferGeometry[] = [];
  private unitLength: [number, number];
  private m = new Matrix4();
  private q = new Quaternion();
  private qd = new Quaternion();
  private scale = new Vector3();
  private dir = new Vector3();
  private mid = new Vector3();
  private lower = new Vector3();
  private upper = new Vector3();
  private top = new Vector3();
  private chassis = new Vector3();
  private tmp = new Vector3();
  private rodCount = 0;

  constructor(
    private def: CornerSuspensionDef,
    private p: CarPhysicsDef,
    preset: SetupPreset,
  ) {
    const rod = new CylinderGeometry(1, 1, 1, 6, 1);
    const knuckle = new BoxGeometry(0.045, p.wheelRadius * 0.8, 0.085);
    knuckle.translate(-p.wheelWidth / 2 + 0.015, 0, 0);
    this.geoms.push(rod, knuckle);
    const colors = SUSPENSION_STYLE_COLORS[def.style];
    const unit = (axle: 'front' | 'rear') => {
      const u = buildCoilover(def.style, preset, axle);
      this.geoms.push(u.body, u.chrome, u.spring);
      const body = new MeshStandardMaterial({
        color: colors.body,
        roughness: 0.4,
        metalness: 0.7,
      });
      const spring = new MeshStandardMaterial({
        color: 0xe0a020,
        roughness: 0.45,
        metalness: 0.5,
      });
      this.springs.push(spring);
      return {
        length: u.length,
        meshes: [
          this.mesh(u.body, body, 2),
          this.mesh(u.chrome, chromeMat, 2),
          this.mesh(u.spring, spring, 2),
        ],
      };
    };
    const f = unit('front');
    const r = unit('rear');
    this.front = f.meshes;
    this.rear = r.meshes;
    this.unitLength = [f.length, r.length];
    this.rods = this.mesh(rod, armMat, 4 * RODS_PER_CORNER + 12);
    this.uprights = this.mesh(knuckle, armMat, 4);
    const ball = new SphereGeometry(1, 8, 6);
    this.geoms.push(ball);
    this.joints = this.mesh(ball, chromeMat, 48);
  }

  private mesh(
    g: BufferGeometry,
    mat: MeshStandardMaterial,
    n: number,
  ): InstancedMesh {
    const im = new InstancedMesh(g, mat, n);
    im.castShadow = true;
    im.frustumCulled = false;
    this.group.add(im);
    return im;
  }

  /** Spring colour of the set-up (yellow / orange / red). */
  setSpringColor(hex: number): void {
    for (const s of this.springs) s.color.set(hex);
  }

  private rod(a: Vector3, b: Vector3, r: number): void {
    const len = a.distanceTo(b) || 1e-4;
    this.dir.copy(b).sub(a).divideScalar(len);
    this.q.setFromUnitVectors(Y, this.dir);
    this.m.compose(
      this.mid.copy(a).add(b).multiplyScalar(0.5),
      this.q,
      this.scale.set(r, len, r),
    );
    this.rods.setMatrixAt(this.rodCount++, this.m);
  }

  /** Ball joint / bushing / strut-top dome: a small sphere. */
  private joint(at: Vector3, r: number): void {
    this.m.compose(at, this.q.identity(), this.scale.set(r, r, r));
    this.joints.setMatrixAt(this.jointCount++, this.m);
  }

  /** One coil-over from `low` (hub / arm) to `top` (body); the spring squashes and stretches with the travel. */
  private damper(idx: number, low: Vector3, top: Vector3, rear: boolean): void {
    const len = low.distanceTo(top) || 1e-4;
    this.dir.copy(top).sub(low).divideScalar(len);
    this.q.setFromUnitVectors(Y, this.dir);
    // Reservoir to the car's outside whatever the lean: spin about the unit axis (left / right).
    this.qd.setFromAxisAngle(Y, idx % 2 === 0 ? 0 : Math.PI);
    this.q.multiply(this.qd);
    this.m.compose(
      low,
      this.q,
      this.scale.set(GIRTH, len / this.unitLength[rear ? 1 : 0], GIRTH),
    );
    const k = idx % 2;
    for (const im of rear ? this.rear : this.front) im.setMatrixAt(k, this.m);
  }

  /** Move everything to the current hub positions (root frame) and wheel orientations. */
  sync(hub: Vector3[], hubQuat: Quaternion[]): void {
    this.rodCount = 0;
    this.jointCount = 0;
    const p = this.p;
    const restY = p.wheelRadius - p.comHeight;
    const { topY, topIn } = this.def;
    const inner = -p.wheelWidth / 2 + 0.015;
    const { lower, upper, top, chassis, tmp } = this;
    for (let i = 0; i < 4; i++) {
      const isRear = i >= 2;
      const layout = isRear ? this.def.rear : this.def.front;
      const axle = isRear ? 'rear' : 'front';
      const sgn = i % 2 === 0 ? 1 : -1; // +x = left
      const h = hub[i];
      const q = hubQuat[i];
      const axleX = (isRear ? p.rear.track : p.front.track) / 2;
      this.m.compose(h, q, this.one);
      this.uprights.setMatrixAt(i, this.m);
      lower
        .set(inner, -p.wheelRadius * 0.36, 0)
        .applyQuaternion(q)
        .add(h);
      upper
        .set(inner, p.wheelRadius * 0.36, 0)
        .applyQuaternion(q)
        .add(h);
      top.set(sgn * (axleX - topIn[axle]), restY + topY[axle], h.z);
      const cx = sgn * axleX * 0.38;
      if (this.def.driven.includes(axle) && layout !== 'axle') {
        tmp.set(inner, 0, 0).applyQuaternion(q).add(h);
        this.rod(tmp, chassis.set(cx * 0.3, restY + 0.02, h.z + 0.04), 0.024);
      }
      if (layout === 'strut') {
        this.damper(i, upper, top, isRear);
        for (const dz of [0.22, -0.22]) {
          this.rod(lower, chassis.set(cx, restY - 0.11, h.z + dz), 0.02);
          this.joint(chassis, 0.03); // rubber bushing
        }
        this.joint(lower, 0.032); // ball joint
        this.joint(top, 0.055); // strut top mount
        tmp.set(inner, 0, -0.12).applyQuaternion(q).add(h);
        this.rod(tmp, chassis.set(cx, restY + 0.02, h.z - 0.2), 0.014);
        this.swayBar(i, h.z, cx, restY);
      } else if (layout === 'wishbone') {
        for (const dz of [0.2, -0.2]) {
          this.rod(lower, chassis.set(cx, restY - 0.1, h.z + dz), 0.02);
          this.joint(chassis, 0.03);
        }
        for (const dz of [0.16, -0.16]) {
          this.rod(upper, chassis.set(cx, restY + 0.2, h.z + dz), 0.016);
          this.joint(chassis, 0.026);
        }
        this.joint(lower, 0.032);
        this.joint(upper, 0.028);
        this.swayBar(i, h.z, cx, restY);
        chassis.set(cx, restY - 0.1, h.z);
        this.damper(i, tmp.copy(lower).lerp(chassis, 0.35), top, isRear);
      } else {
        // Rigid axle: trailing arm forward to the floor, upper link, coil-over beside the wheel.
        lower
          .set(inner * 0.4, -p.wheelRadius * 0.05, 0)
          .applyQuaternion(q)
          .add(h);
        this.rod(lower, chassis.set(cx, restY + 0.04, h.z + 0.7), 0.02);
        upper
          .set(inner, p.wheelRadius * 0.12, 0)
          .applyQuaternion(q)
          .add(h);
        this.rod(
          upper,
          chassis.set(sgn * axleX * 0.7, restY + 0.12, h.z + 0.5),
          0.012,
        );
        this.damper(i, lower, top, isRear);
      }
    }
    if (this.def.rear === 'axle') this.rod(hub[2], hub[3], 0.04);
    this.rods.count = this.rodCount;
    this.joints.count = this.jointCount;
    for (const im of [
      this.rods,
      this.uprights,
      this.joints,
      ...this.front,
      ...this.rear,
    ])
      im.instanceMatrix.needsUpdate = true;
  }

  private one = new Vector3(1, 1, 1);
  private bar = new Vector3();

  /**
   * Axle crossmember (subframe tube, drawn once per axle) and anti-roll bar with a drop link to this wheel's lower
   * arm. The bar sits at fixed body points; only the link follows the wheel.
   */
  private swayBar(i: number, z: number, cx: number, restY: number): void {
    const { bar, chassis, lower } = this;
    bar.set(cx * 1.1, restY - 0.04, z + 0.36);
    if (i % 2 === 1) {
      chassis.set(-cx * 1.1, restY - 0.04, z + 0.36);
      this.rod(bar, chassis, 0.011); // the bar itself
      this.joint(bar, 0.018);
      this.joint(chassis, 0.018);
      bar.set(cx, restY - 0.11, z + 0.22);
      chassis.set(-cx, restY - 0.11, z + 0.22);
      this.rod(bar, chassis, 0.032); // crossmember
      bar.set(cx, restY - 0.11, z - 0.22);
      chassis.set(-cx, restY - 0.11, z - 0.22);
      this.rod(bar, chassis, 0.032);
    }
    bar.set(cx * 1.1, restY - 0.04, z + 0.36);
    this.rod(bar, chassis.copy(lower).setZ(z + 0.3), 0.008); // drop link
  }

  dispose(): void {
    for (const g of this.geoms) g.dispose();
  }
}
