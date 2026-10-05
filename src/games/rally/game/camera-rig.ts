import { MathUtils, PerspectiveCamera, Vector3 } from 'three';
import type { Vehicle } from '../physics/vehicle';

/**
 * Chase / hood / bumper cameras. The chase cam follows the car's heading with
 * a spring (so slides are visible), lifts and widens FOV with speed, and is
 * kept above the terrain.
 */
export type CameraMode = 'chase' | 'chase_far' | 'hood' | 'bumper';
export const CAMERA_MODES: CameraMode[] = [
  'chase',
  'chase_far',
  'hood',
  'bumper',
];

const _v = new Vector3();
const _t = new Vector3();

export class CameraRig {
  mode: CameraMode = 'chase';
  private yaw = 0;
  private pos = new Vector3();
  private initialized = false;
  private shake = 0;

  constructor(
    readonly camera: PerspectiveCamera,
    private groundHeight: (x: number, z: number) => number,
  ) {}

  next(): void {
    this.mode =
      CAMERA_MODES[(CAMERA_MODES.indexOf(this.mode) + 1) % CAMERA_MODES.length];
  }

  snap(): void {
    this.initialized = false;
  }

  /** `carPos`/`forward`/`up` should be the interpolated render transform. */
  update(
    dt: number,
    v: Vehicle,
    carPos: Vector3,
    forward: Vector3,
    up: Vector3,
  ): void {
    const cam = this.camera;
    const speed = v.velocity.length();
    this.shake = Math.max(
      this.shake * Math.exp(-dt * 6),
      Math.min(1, v.impact / 9000),
    );

    if (this.mode === 'hood' || this.mode === 'bumper') {
      const local =
        this.mode === 'hood' ? _v.set(0, 0.62, 0.15) : _v.set(0, 0.05, 2.05);
      cam.position.copy(local.applyQuaternion(v.quaternion)).add(carPos);
      cam.up.copy(up);
      cam.lookAt(
        _t
          .copy(cam.position)
          .addScaledVector(forward, 10)
          .addScaledVector(up, this.mode === 'hood' ? -0.3 : 0.1),
      );
      cam.fov = MathUtils.lerp(
        cam.fov,
        68 + speed * 0.12,
        1 - Math.exp(-dt * 3),
      );
      cam.updateProjectionMatrix();
      return;
    }

    const far = this.mode === 'chase_far';
    const targetYaw = Math.atan2(forward.x, forward.z);
    if (!this.initialized) this.yaw = targetYaw;
    let dy = targetYaw - this.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw += dy * (1 - Math.exp(-dt * (far ? 3.5 : 4.5)));

    const dist = (far ? 7.8 : 5.4) + Math.min(speed, 40) * 0.025;
    const height = (far ? 2.6 : 1.75) + Math.min(speed, 40) * 0.008;
    const target = _t.copy(carPos);
    target.y += 0.9;
    const desired = _v.set(
      target.x - Math.sin(this.yaw) * dist,
      target.y + height,
      target.z - Math.cos(this.yaw) * dist,
    );
    if (!this.initialized) {
      this.pos.copy(desired);
      this.initialized = true;
    }
    // Stiff horizontally, softer vertically (soaks up bumps and jumps).
    const kh = 1 - Math.exp(-dt * 14);
    const kv = 1 - Math.exp(-dt * 6);
    this.pos.x += (desired.x - this.pos.x) * kh;
    this.pos.z += (desired.z - this.pos.z) * kh;
    this.pos.y += (desired.y - this.pos.y) * kv;
    const g = this.groundHeight(this.pos.x, this.pos.z) + 0.6;
    if (this.pos.y < g) this.pos.y = g;

    cam.position.copy(this.pos);
    if (this.shake > 0.01) {
      const s = this.shake * 0.15;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
    }
    cam.up.set(0, 1, 0);
    cam.lookAt(target.addScaledVector(forward, 2.5));
    cam.fov = MathUtils.lerp(
      cam.fov,
      60 + Math.min(speed, 45) * 0.22,
      1 - Math.exp(-dt * 3),
    );
    cam.updateProjectionMatrix();
  }
}
