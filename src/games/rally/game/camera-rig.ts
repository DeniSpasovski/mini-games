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

/** Look-around (right stick): how fast the view turns to the stick's direction, and back to the default view on release (1/s). */
const LOOK_FOLLOW = 12;
const LOOK_RETURN = 8;

/** Right stick, dead zone removed: (0, 0) = released. */
export interface LookInput {
  /** + = stick right. */
  x: number;
  /** + = stick down. */
  y: number;
}
const NO_LOOK: LookInput = { x: 0, y: 0 };

const _v = new Vector3();
const _t = new Vector3();
const _up = new Vector3(0, 1, 0);

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
  /** Look-around: view yaw off the car's heading (rad, + = looking right). Eased back when the stick is released. */
  private lookYaw = 0;
  /** Camera position before shake and body bounce: what the tree level choice measures from (trees/draw.ts). */
  readonly steady = new Vector3();

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
    look: LookInput = NO_LOOK,
  ): void {
    const cam = this.camera;
    // Right stick: the stick's direction is the view's direction (up = ahead, right = the right side,
    // down = behind), the shortest way round; released, the view goes back behind the car.
    const held = look.x !== 0 || look.y !== 0;
    let d = held ? Math.atan2(look.x, -look.y) - this.lookYaw : -this.lookYaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.lookYaw +=
      d * (1 - Math.exp(-dt * (held ? LOOK_FOLLOW : LOOK_RETURN)));
    this.lookYaw = Math.atan2(Math.sin(this.lookYaw), Math.cos(this.lookYaw));
    if (!held && Math.abs(this.lookYaw) < 1e-3) this.lookYaw = 0;
    const lookAmount = Math.min(1, Math.abs(this.lookYaw) / 0.6);
    const speed = v.velocity.length();
    this.shake = Math.max(
      this.shake * Math.exp(-dt * 6),
      Math.min(1, v.impact / 9000),
    );

    if (this.mode === 'hood' || this.mode === 'bumper') {
      const local =
        this.mode === 'hood' ? _v.set(0, 0.62, 0.15) : _v.set(0, 0.05, 2.05);
      cam.position.copy(local.applyQuaternion(v.quaternion)).add(carPos);
      // Steady: the same point without the body's pitch / roll.
      if (this.mode === 'hood') this.steady.set(0, 0.62, 0.15);
      else this.steady.set(0, 0.05, 2.05);
      this.steady
        .applyAxisAngle(_up, Math.atan2(forward.x, forward.z))
        .add(carPos);
      cam.up.copy(up);
      // Looking around from the seat: turn the view about the car's up axis.
      _t.copy(forward).applyAxisAngle(up, -this.lookYaw);
      cam.lookAt(
        _t
          .multiplyScalar(10)
          .add(cam.position)
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
    const placeYaw = this.yaw - this.lookYaw;
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
      this.focus.x - Math.sin(placeYaw) * dist,
      this.focus.y + height,
      this.focus.z - Math.cos(placeYaw) * dist,
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
    this.steady.copy(this.pos);
    if (this.shake > 0.01) {
      const s = this.shake * 0.15;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
    }
    cam.up.set(0, 1, 0);
    // Aim along the smoothed heading, not the body's raw pitch / roll.
    cam.lookAt(
      target.set(
        this.focus.x + Math.sin(placeYaw) * 2.5 * (1 - lookAmount),
        this.focus.y,
        this.focus.z + Math.cos(placeYaw) * 2.5 * (1 - lookAmount),
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
