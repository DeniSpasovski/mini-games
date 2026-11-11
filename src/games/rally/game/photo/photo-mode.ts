import {
  Box3,
  MathUtils,
  Matrix4,
  type Object3D,
  type PerspectiveCamera,
  Ray,
  Vector3,
} from 'three';
import { type PhotoLens, SENSOR_MM } from '../../engine/post-fx';

/** Aperture stops offered (f-number). */
export const F_STOPS = [1.4, 2, 2.8, 4, 5.6, 8, 11, 16, 22];
/** Focal length range (mm, 35 mm full frame). */
export const FOCAL_MIN = 16;
export const FOCAL_MAX = 200;
/** Orbit distance range (m from the orbit point). */
const DIST_MIN = 1.6;
const DIST_MAX = 40;
/** How far the orbit point may be moved off the car (m). */
const PAN_MAX = 15;
/** The camera stays this far above the ground (m). */
const GROUND_CLEARANCE = 0.2;
/** Pitch limits (rad): a little below the orbit point ... nearly straight down. */
const PITCH_MIN = -0.35;
const PITCH_MAX = 1.45;

/** Every setting of the photo camera (the UI's sliders). */
export interface PhotoSettings extends PhotoLens {
  /** Focus on the car (the focus follows the orbit distance); false = `focus` as set. */
  autoFocus: boolean;
  /** Camera roll (degrees, + = clockwise). */
  roll: number;
}

const _v = new Vector3();
const _box = new Box3();
const _ray = new Ray();
const _hit = new Vector3();

/**
 * Photo mode camera (DOM-free; the UI is photo-ui.ts): a free orbit around the car - yaw all the way round, pitch,
 * distance, a panned orbit point - with a real lens: focal length (field of view), aperture and focus for the depth of
 * field (engine/post-fx.ts `PHOTO`), exposure and roll. The game stands still while it is open (paused or a paused
 * replay); closing puts the game's camera back.
 */
export class PhotoMode {
  readonly settings: PhotoSettings = {
    focus: 6,
    focal: 50,
    fStop: 2.8,
    ev: 0,
    autoFocus: true,
    roll: 0,
  };
  yaw = 0;
  pitch = 0.15;
  distance = 6;
  /** The orbit point: the car's middle plus the pan. */
  private readonly centre = new Vector3();
  /** The car's bounds (auto focus: the near side of the car, as a camera's focus point on the body would). */
  private readonly carBox = new Box3();
  private readonly toCar = new Matrix4();
  private readonly pan = new Vector3();
  private readonly saved: {
    pos: Vector3;
    quat: [number, number, number, number];
    fov: number;
  };

  constructor(
    private readonly camera: PerspectiveCamera,
    car: Object3D,
    private readonly groundHeight: (x: number, z: number) => number,
  ) {
    this.saved = {
      pos: camera.position.clone(),
      quat: camera.quaternion.toArray() as [number, number, number, number],
      fov: camera.fov,
    };
    _box.setFromObject(car);
    _box.getCenter(this.centre);
    // The body's own (rotated) box: the car posed at the origin for a moment.
    const pos = car.position.clone();
    const quat = car.quaternion.clone();
    car.position.set(0, 0, 0);
    car.quaternion.identity();
    car.updateMatrixWorld(true);
    this.carBox.setFromObject(car);
    car.position.copy(pos);
    car.quaternion.copy(quat);
    car.updateMatrixWorld(true);
    this.toCar.copy(car.matrixWorld).invert();
    // Start from the game's own view: same side, height and distance, the same field of view.
    _v.copy(camera.position).sub(this.centre);
    this.distance = MathUtils.clamp(_v.length(), DIST_MIN, DIST_MAX);
    this.yaw = Math.atan2(_v.x, _v.z);
    this.pitch = MathUtils.clamp(
      Math.asin(_v.y / Math.max(1e-3, _v.length())),
      PITCH_MIN,
      PITCH_MAX,
    );
    this.settings.focal = MathUtils.clamp(
      Math.round(SENSOR_MM / 2 / Math.tan(MathUtils.degToRad(camera.fov / 2))),
      FOCAL_MIN,
      FOCAL_MAX,
    );
    this.settings.focus = this.distance;
  }

  /** Vertical field of view (degrees) of the focal length. */
  get fov(): number {
    return MathUtils.radToDeg(
      2 * Math.atan(SENSOR_MM / 2 / this.settings.focal),
    );
  }

  orbit(dYaw: number, dPitch: number): void {
    this.yaw += dYaw;
    this.pitch = MathUtils.clamp(this.pitch + dPitch, PITCH_MIN, PITCH_MAX);
  }

  /** Move closer (< 1) or further (> 1). */
  zoom(factor: number): void {
    this.distance = MathUtils.clamp(this.distance * factor, DIST_MIN, DIST_MAX);
  }

  /** Move the orbit point across the view (dx right, dy up, in m). */
  panBy(dx: number, dy: number): void {
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    this.pan.x += cy * dx;
    this.pan.z += -sy * dx;
    this.pan.y += dy;
    if (this.pan.length() > PAN_MAX) this.pan.setLength(PAN_MAX);
  }

  /** Back to the car's middle. */
  recentre(): void {
    this.pan.set(0, 0, 0);
  }

  /** Place the camera for this frame. */
  update(): void {
    const cam = this.camera;
    const s = this.settings;
    const target = _v.copy(this.centre).add(this.pan);
    const cp = Math.cos(this.pitch);
    cam.position.set(
      target.x + Math.sin(this.yaw) * cp * this.distance,
      target.y + Math.sin(this.pitch) * this.distance,
      target.z + Math.cos(this.yaw) * cp * this.distance,
    );
    const ground =
      this.groundHeight(cam.position.x, cam.position.z) + GROUND_CLEARANCE;
    if (cam.position.y < ground) cam.position.y = ground;
    cam.up.set(0, 1, 0);
    cam.lookAt(target);
    if (s.roll) cam.rotateZ(MathUtils.degToRad(-s.roll));
    if (Math.abs(cam.fov - this.fov) > 1e-3) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
    if (s.autoFocus) {
      // On the car's near side along the view; past the car (orbit point panned away): the orbit point.
      _ray.origin.copy(cam.position);
      _ray.direction.copy(target).sub(cam.position).normalize();
      _ray.applyMatrix4(this.toCar);
      const hit = this.carBox.containsPoint(_ray.origin)
        ? null
        : _ray.intersectBox(this.carBox, _hit);
      s.focus = hit
        ? _ray.origin.distanceTo(hit) + 0.1
        : cam.position.distanceTo(target);
    }
  }

  /** The lens for the post pass. */
  get lens(): PhotoLens {
    const s = this.settings;
    return { focus: s.focus, focal: s.focal, fStop: s.fStop, ev: s.ev };
  }

  /** Put the game's camera back. */
  restore(): void {
    const cam = this.camera;
    cam.position.copy(this.saved.pos);
    cam.quaternion.fromArray(this.saved.quat);
    cam.up.set(0, 1, 0);
    cam.fov = this.saved.fov;
    cam.updateProjectionMatrix();
  }
}
