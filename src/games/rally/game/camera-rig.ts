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
  private focus = new Vector3();
  /** Low-passed horizontal car velocity: carries `focus` / `pos` along between frames. */
  private vel = new Vector3();
  private ground = 0;
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
      this.initialized = false; // back in a chase view: start from the car, not a stale spot
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
    // Low-pass the car position the camera works from: on a rough road edge the
    // body bounces / sways every frame and a rigid follow turns that into jitter.
    // The filtered points are first carried along at the (smoothed) car velocity, so
    // they only filter the deviation from that path: a plain lag would trail the car
    // by about v/rate - v*dt/2, and every frame-time change would jerk the car on
    // screen (worst at top speed).
    const target = _t.copy(carPos);
    target.y += 0.9;
    if (!this.initialized) {
      this.focus.copy(target);
      this.vel.set(v.velocity.x, 0, v.velocity.z);
    }
    const kvel = 1 - Math.exp(-dt * 8);
    this.vel.x += (v.velocity.x - this.vel.x) * kvel;
    this.vel.z += (v.velocity.z - this.vel.z) * kvel;
    const kf = 1 - Math.exp(-dt * 16);
    this.focus.x += this.vel.x * dt;
    this.focus.z += this.vel.z * dt;
    this.focus.x += (target.x - this.focus.x) * kf;
    this.focus.z += (target.z - this.focus.z) * kf;
    this.focus.y += (target.y - this.focus.y) * (1 - Math.exp(-dt * 7));
    const desired = _v.set(
      this.focus.x - Math.sin(this.yaw) * dist,
      this.focus.y + height,
      this.focus.z - Math.cos(this.yaw) * dist,
    );
    if (!this.initialized) {
      this.pos.copy(desired);
      this.ground = this.groundHeight(this.pos.x, this.pos.z);
      this.initialized = true;
    }
    // Stiff horizontally, softer vertically (soaks up bumps and jumps).
    const kh = 1 - Math.exp(-dt * 14);
    const kv = 1 - Math.exp(-dt * 6);
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.x += (desired.x - this.pos.x) * kh;
    this.pos.z += (desired.z - this.pos.z) * kh;
    this.pos.y += (desired.y - this.pos.y) * kv;
    // Filtered terrain height: verges, ditches and berms must not snap the camera up and down.
    this.ground +=
      (this.groundHeight(this.pos.x, this.pos.z) - this.ground) *
      (1 - Math.exp(-dt * 8));
    const g = this.ground + 0.6;
    if (this.pos.y < g)
      this.pos.y += (g - this.pos.y) * (1 - Math.exp(-dt * 20));

    cam.position.copy(this.pos);
    if (this.shake > 0.01) {
      const s = this.shake * 0.15;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
    }
    cam.up.set(0, 1, 0);
    // Aim along the smoothed heading, not the body's raw pitch / roll.
    cam.lookAt(
      target.set(
        this.focus.x + Math.sin(this.yaw) * 2.5,
        this.focus.y,
        this.focus.z + Math.cos(this.yaw) * 2.5,
      ),
    );
    cam.fov = MathUtils.lerp(
      cam.fov,
      60 + Math.min(speed, 45) * 0.22,
      1 - Math.exp(-dt * 3),
    );
    cam.updateProjectionMatrix();
  }
}
