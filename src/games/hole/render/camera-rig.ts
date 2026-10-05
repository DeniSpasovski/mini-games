import { MathUtils, PerspectiveCamera, Vector3 } from 'three';
import {
  cameraDistance,
  cameraPitchDeg,
  holeDiameter,
} from '../sim/progression';

export const CAMERA_FOV = 50;

/** Extra distance in portrait so the world width on screen doesn't collapse on narrow phones. */
export function portraitFactor(aspect: number): number {
  return Math.max(1, Math.pow(1.4 / Math.max(aspect, 0.2), 0.6));
}

export interface CameraTuning {
  /** Multiplies the default camera distance. */
  distanceScale: number;
  /** Added to the default pitch (degrees). */
  pitchOffset: number;
}

/**
 * Follow camera: looks north-up at the hole from the south, pulls back and
 * tilts steeper as the hole grows. Critically-damped follow (no overshoot).
 */
export class CameraRig {
  readonly camera = new PerspectiveCamera(CAMERA_FOV, 1, 0.5, 2500);
  readonly tuning: CameraTuning = { distanceScale: 1, pitchOffset: 0 };
  readonly target = new Vector3();
  /** Current (smoothed) camera distance from the target. */
  distance = 12;
  pitchDeg = 52;
  private goal = new Vector3();
  private initialised = false;

  /** Aim at (x, z) with the hole at `diameter` / `level`. */
  update(
    dt: number,
    x: number,
    z: number,
    diameter: number,
    level: number,
  ): void {
    this.goal.set(x, 0, z);
    const aspect = this.camera.aspect;
    const wantDist =
      cameraDistance(diameter) *
      this.tuning.distanceScale *
      portraitFactor(aspect);
    const wantPitch = cameraPitchDeg(level) + this.tuning.pitchOffset;
    if (!this.initialised) {
      this.target.copy(this.goal);
      this.distance = wantDist;
      this.pitchDeg = wantPitch;
      this.initialised = true;
    } else {
      const kf = 1 - Math.exp(-dt / 0.09);
      const kd = 1 - Math.exp(-dt / 0.35);
      this.target.lerp(this.goal, kf);
      this.distance += (wantDist - this.distance) * kd;
      this.pitchDeg += (wantPitch - this.pitchDeg) * kd;
    }
    const pitch = MathUtils.degToRad(this.pitchDeg);
    this.camera.position.set(
      this.target.x,
      Math.sin(pitch) * this.distance,
      this.target.z + Math.cos(pitch) * this.distance,
    );
    this.camera.near = Math.max(0.3, this.distance * 0.08);
    this.camera.far = this.distance * 14 + 600;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.target);
  }

  /** Jump (no smoothing) on the next update. */
  snap(): void {
    this.initialised = false;
  }

  /** Reference distance for a level (used by viewers). */
  static distanceForLevel(level: number): number {
    return cameraDistance(holeDiameter(level));
  }
}
