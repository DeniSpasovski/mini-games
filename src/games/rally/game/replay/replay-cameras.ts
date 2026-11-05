/**
 * Replay cameras (DOM-free): the driving cameras (CameraRig: chase, far chase, bonnet, bumper) plus TV trackside
 * cameras (tv-cameras.ts), a helicopter chase and a free orbit, and an auto director that cuts between them.
 *
 * Director rules (sources/rally/REPLAY.md "Cameras"): a big corner is always filmed from its TV camera; between
 * corners it cycles chase / helicopter / bumper / trackside shots of 5-8 s; no cut shorter than MIN_SHOT, none while
 * the car is in the air (hold on jumps); the TV cameras stand on the outside of a corner (the camera never jumps
 * across the car's line inside one corner).
 */
import { MathUtils, PerspectiveCamera, Vector3 } from 'three';
import type { Vehicle } from '../../physics/vehicle';
import { newRoadQuery, type Road } from '../../world/road';
import { CameraRig, type CameraMode } from '../camera-rig';
import { cameraFor, type TvCamera } from './tv-cameras';

export type ReplayCamId =
  'auto' | 'tv' | 'chase' | 'chase_far' | 'hood' | 'bumper' | 'heli' | 'orbit';

/** Camera picker order (number keys 1-8). */
export const REPLAY_CAMS: { id: ReplayCamId; label: string }[] = [
  { id: 'auto', label: 'Director' },
  { id: 'tv', label: 'TV' },
  { id: 'chase', label: 'Chase' },
  { id: 'chase_far', label: 'Far' },
  { id: 'hood', label: 'Bonnet' },
  { id: 'bumper', label: 'Bumper' },
  { id: 'heli', label: 'Heli' },
  { id: 'orbit', label: 'Orbit' },
];

/** A shot the director (or a fixed pick) is showing. */
type ShotKind = Exclude<ReplayCamId, 'auto'>;

/** Shortest shot before the director cuts (s). */
const MIN_SHOT = 2.5;
/** Air time (s) from which the director holds its shot (a jump plays out in one view). */
const HOLD_AIR = 0.12;
/** Shots between corners, in turn. */
const FILLER_SHOTS: ShotKind[] = [
  'chase',
  'heli',
  'tv',
  'bumper',
  'chase_far',
  'tv',
];
/** TV framing: metres of picture height around the car (FOV follows the distance). */
const TV_FRAME = 9;

const _t = new Vector3();
const _d = new Vector3();

export class ReplayDirector {
  mode: ReplayCamId = 'auto';
  /** What is on screen now. */
  shot: ShotKind = 'chase_far';
  /** The trackside camera filming (TV shots). */
  tv: TvCamera | null = null;
  private age = 0;
  private fillerIndex = 0;
  private fillerLength = 6;
  private look = new Vector3();
  private heliPos = new Vector3();
  private heliYaw = 0;
  private orbitYaw = 0;
  private orbitPitch = 0.35;
  private orbitDist = 9;
  private orbitIdle = 0;
  private fresh = true;
  private q = newRoadQuery();
  /** Car's distance along the stage road (m), kept when the car is off it. */
  along = 0;
  readonly rig: CameraRig;
  private corners: TvCamera[];

  constructor(
    readonly camera: PerspectiveCamera,
    private groundHeight: (x: number, z: number) => number,
    private road: Road,
    readonly cams: TvCamera[],
  ) {
    this.rig = new CameraRig(camera, groundHeight);
    this.corners = cams.filter((c) => c.kind === 'corner');
  }

  setMode(m: ReplayCamId): void {
    if (m === this.mode) return;
    this.mode = m;
    this.cut(m === 'auto' ? this.shot : m);
  }

  /** Jump cut (a seek, a reset in the recording): every camera starts from the car again. */
  snap(): void {
    this.fresh = true;
    this.rig.snap();
    this.age = MIN_SHOT;
  }

  /** Orbit camera: drag / keys (radians, metres). */
  orbitBy(dYaw: number, dPitch: number, dDist: number): void {
    this.orbitYaw += dYaw;
    this.orbitPitch = MathUtils.clamp(this.orbitPitch + dPitch, -0.05, 1.3);
    this.orbitDist = MathUtils.clamp(this.orbitDist * (1 + dDist), 3.5, 40);
    this.orbitIdle = 0;
  }

  /** Label of what is on screen (UI). */
  get label(): string {
    if (this.shot === 'tv')
      return !this.tv
        ? 'TV · chase' // no camera sees this stretch
        : this.tv.kind === 'corner'
          ? 'TV · corner'
          : 'TV · trackside';
    return REPLAY_CAMS.find((c) => c.id === this.shot)?.label ?? '';
  }

  private cut(to: ShotKind): void {
    if (to !== this.shot || to === 'tv') this.fresh = true;
    this.shot = to;
    this.age = 0;
    if (
      to === 'chase' ||
      to === 'chase_far' ||
      to === 'hood' ||
      to === 'bumper'
    ) {
      this.rig.mode = to as CameraMode;
      this.rig.snap();
    }
  }

  /**
   * `dt` = replay seconds this frame (0 while paused), `realDt` = wall-clock seconds (the orbit camera moves while
   * paused); `pos` / `fwd` / `up`: the car model's render transform.
   */
  update(
    dt: number,
    realDt: number,
    v: Vehicle,
    pos: Vector3,
    fwd: Vector3,
    up: Vector3,
  ): void {
    const q = this.road.query(pos.x, pos.z, this.q);
    if (q.found) this.along = q.along;
    this.age += Math.abs(dt);
    const airborne = v.airTime > HOLD_AIR;
    if (this.mode === 'auto') this.direct(airborne);
    else if (this.mode !== this.shot) this.cut(this.mode);
    if (this.shot === 'tv') this.pickTv(this.mode !== 'auto');

    switch (this.shot) {
      case 'tv':
        // No camera sees this stretch: the chase camera (the heli can sit in a forest canopy).
        if (this.tv) this.tvShot(dt, v, pos);
        else this.rig.update(dt, v, pos, fwd, up);
        break;
      case 'heli':
        this.heliShot(dt, v, pos, fwd);
        break;
      case 'orbit':
        this.orbitShot(realDt, pos);
        break;
      default:
        this.rig.update(dt, v, pos, fwd, up);
    }
    this.fresh = false;
  }

  /** Auto: corners from their TV camera, the rest a cycle of shots. */
  private direct(airborne: boolean): void {
    if (airborne && !this.fresh) return;
    const corner = cameraFor(this.corners, this.along);
    if (corner) {
      if (this.shot === 'tv' && this.tv === corner) return;
      if (this.age < MIN_SHOT && !this.fresh) return;
      this.tv = corner;
      this.cut('tv');
      return;
    }
    const long = this.age >= this.fillerLength;
    const leftCorner = this.shot === 'tv' && this.tv?.kind === 'corner';
    if (!long && !leftCorner && !this.fresh) return;
    if (this.age < MIN_SHOT && !this.fresh && !leftCorner) return;
    this.fillerIndex = (this.fillerIndex + 1) % FILLER_SHOTS.length;
    // 5-8 s, varied but repeatable.
    this.fillerLength = 5 + ((this.fillerIndex * 7) % 4);
    const next = FILLER_SHOTS[this.fillerIndex];
    if (next === 'tv') {
      const t = cameraFor(this.cams, this.along);
      if (!t) {
        this.cut('chase');
        return;
      }
      this.tv = t;
    }
    this.cut(next);
  }

  /** TV picked by hand: the camera for where the car is; held while the car stays in its stretch. */
  private pickTv(manual: boolean): void {
    const cur = this.tv;
    const inRange = cur && this.along >= cur.from && this.along <= cur.to;
    if (manual) {
      const best = cameraFor(this.cams, this.along);
      if (
        inRange &&
        !(
          cur.kind === 'straight' &&
          best?.kind === 'corner' &&
          this.age > MIN_SHOT
        )
      )
        return;
      if (best && best !== cur) {
        this.tv = best;
        this.fresh = true;
        this.age = 0;
      } else if (!best && !inRange) this.tv = null;
      return;
    }
    if (inRange) return;
    const best = cameraFor(this.cams, this.along);
    if (best && best !== cur) {
      this.tv = best;
      this.fresh = true;
      this.age = 0;
    } else if (!best) this.tv = null; // no camera sees this stretch: the chase shot (update) until one does
  }

  private tvShot(dt: number, v: Vehicle, pos: Vector3): void {
    const cam = this.camera;
    const tv = this.tv!;
    cam.position.copy(tv.pos);
    // Aim a little ahead of the car (it moves into the picture), eased so the pan has weight.
    _t.copy(pos).addScaledVector(v.velocity, 0.12);
    _t.y += 0.5;
    if (this.fresh) this.look.copy(_t);
    else this.look.lerp(_t, 1 - Math.exp(-Math.abs(dt) * 9));
    cam.up.set(0, 1, 0);
    cam.lookAt(this.look);
    const dist = Math.max(4, cam.position.distanceTo(this.look));
    const fov = MathUtils.clamp(
      2 * MathUtils.radToDeg(Math.atan(TV_FRAME / 2 / dist)),
      7,
      55,
    );
    cam.fov = this.fresh
      ? fov
      : MathUtils.lerp(cam.fov, fov, 1 - Math.exp(-Math.abs(dt) * 2.5));
    cam.updateProjectionMatrix();
    this.rig.steady.copy(cam.position);
  }

  private heliShot(dt: number, v: Vehicle, pos: Vector3, fwd: Vector3): void {
    const cam = this.camera;
    const yaw = Math.atan2(fwd.x, fwd.z);
    if (this.fresh) this.heliYaw = yaw;
    let dy = yaw - this.heliYaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.heliYaw += dy * (1 - Math.exp(-Math.abs(dt) * 0.9));
    // Behind and to the side, high: a helicopter tracking the car.
    const side = this.heliYaw + 0.55;
    _d.set(pos.x - Math.sin(side) * 26, 0, pos.z - Math.cos(side) * 26);
    _d.y = Math.max(pos.y + 14, this.groundHeight(_d.x, _d.z) + 9);
    if (this.fresh) this.heliPos.copy(_d);
    else this.heliPos.lerp(_d, 1 - Math.exp(-Math.abs(dt) * 1.6));
    cam.position.copy(this.heliPos);
    _t.copy(pos).addScaledVector(v.velocity, 0.25);
    if (this.fresh) this.look.copy(_t);
    else this.look.lerp(_t, 1 - Math.exp(-Math.abs(dt) * 6));
    cam.up.set(0, 1, 0);
    cam.lookAt(this.look);
    cam.fov = this.fresh
      ? 34
      : MathUtils.lerp(cam.fov, 34, 1 - Math.exp(-Math.abs(dt) * 2));
    cam.updateProjectionMatrix();
    this.rig.steady.copy(cam.position);
  }

  private orbitShot(dt: number, pos: Vector3): void {
    const cam = this.camera;
    this.orbitIdle += Math.abs(dt);
    // Left alone, it turns slowly round the car.
    if (this.orbitIdle > 2) this.orbitYaw += Math.abs(dt) * 0.18;
    const r = this.orbitDist;
    const cp = Math.cos(this.orbitPitch);
    cam.position.set(
      pos.x + Math.sin(this.orbitYaw) * r * cp,
      pos.y + 0.8 + Math.sin(this.orbitPitch) * r,
      pos.z + Math.cos(this.orbitYaw) * r * cp,
    );
    const g = this.groundHeight(cam.position.x, cam.position.z) + 0.4;
    if (cam.position.y < g) cam.position.y = g;
    _t.copy(pos);
    _t.y += 0.6;
    cam.up.set(0, 1, 0);
    cam.lookAt(_t);
    cam.fov = this.fresh
      ? 50
      : MathUtils.lerp(cam.fov, 50, 1 - Math.exp(-Math.abs(dt) * 3));
    cam.updateProjectionMatrix();
    this.rig.steady.copy(cam.position);
  }
}
