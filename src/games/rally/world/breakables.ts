import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { getAssetMeta } from '../assets/catalog';
import type { ScatterField, ScatterInstance } from './scatter';

/**
 * Breakable props (catalog `breakable`, e.g. marker posts): the car drives through them, they tip over in the
 * direction the car pushed them and slide a little, then lie on the ground until `reset()` (stage restart). Pure
 * (three.js math only, no scene) so tests run in node; the game patches the drawn matrices via `InstanceStreamer`.
 */

/** Car footprint for the hit test (world frame). */
export interface CarFootprint {
  position: Vector3;
  quaternion: Quaternion;
  velocity: Vector3;
  /** Body length / width (m). */
  length: number;
  width: number;
}

interface Fall {
  inst: ScatterInstance;
  t: number;
  /** Unit push direction (XZ). */
  dx: number;
  dz: number;
  /** Tip-over rate at the hit (rad/s) and slide distance (m). */
  spin: number;
  slide: number;
  done: boolean;
}

/** The body clears a post when its centre is this far above the post's top (a jump over it). */
const CLEAR_ABOVE = 0.45;
/** Tip-over acceleration once the post is leaning (rad/s^2). */
const TIP_ACCEL = 30;
const SLIDE_RATE = 5;

const _inv = new Quaternion();
const _l = new Vector3();
const _e = new Euler();
const _q = new Quaternion();
const _r = new Quaternion();
const _axis = new Vector3();
const _p = new Vector3();
const _s = new Vector3();
const _m = new Matrix4();

export class Breakables {
  private falls = new Map<ScatterInstance, Fall>();

  constructor(
    private scatter: ScatterField,
    /** Ground height (World.heightAt) the posts slide over. */
    private ground: (x: number, z: number) => number,
  ) {}

  /** Posts knocked over since the last reset. */
  get count(): number {
    return this.falls.size;
  }

  isDown(inst: ScatterInstance): boolean {
    return this.falls.has(inst);
  }

  /** Knock over every standing breakable under the car's footprint; returns the newly hit ones. */
  hit(car: CarFootprint): ScatterInstance[] {
    const out: ScatterInstance[] = [];
    const cs = this.scatter.chunkSize;
    const reach = Math.hypot(car.length, car.width) / 2 + 0.5;
    const { x, z } = car.position;
    _inv.copy(car.quaternion).invert();
    for (
      let cz = Math.floor((z - reach) / cs);
      cz <= Math.floor((z + reach) / cs);
      cz++
    )
      for (
        let cx = Math.floor((x - reach) / cs);
        cx <= Math.floor((x + reach) / cs);
        cx++
      )
        for (const inst of this.scatter.chunk(cx, cz).breakables) {
          if (this.falls.has(inst)) continue;
          if (Math.abs(inst.x - x) > reach || Math.abs(inst.z - z) > reach)
            continue;
          const b = getAssetMeta(inst.asset).breakable!;
          const r = b.r * inst.scale;
          const h = b.h * inst.scale * (inst.sy ?? 1);
          if (car.position.y > inst.y + h + CLEAR_ABOVE) continue;
          _l.set(inst.x - x, 0, inst.z - z).applyQuaternion(_inv);
          if (
            Math.abs(_l.x) > car.width / 2 + r ||
            Math.abs(_l.z) > car.length / 2 + r
          )
            continue;
          this.knock(inst, car.velocity);
          out.push(inst);
        }
    return out;
  }

  private knock(inst: ScatterInstance, v: Vector3): void {
    const speed = Math.hypot(v.x, v.z);
    // Pushed along the car's travel; a near-standstill nudge tips it away from the road side it faces.
    const dx = speed > 0.5 ? v.x / speed : Math.sin(inst.rotY);
    const dz = speed > 0.5 ? v.z / speed : Math.cos(inst.rotY);
    this.falls.set(inst, {
      inst,
      t: 0,
      dx,
      dz,
      spin: Math.min(14, 1 + speed * 0.5),
      slide: Math.min(4, speed * 0.1),
      done: false,
    });
  }

  /** Advance the fall animations; `draw` gets the new world matrix of every post that moved (reused: copy it). */
  update(dt: number, draw: (inst: ScatterInstance, m: Matrix4) => void): void {
    for (const f of this.falls.values()) {
      if (f.done) continue;
      f.t += dt;
      f.done = fallMatrix(f, this.ground, _m);
      draw(f.inst, _m);
    }
  }

  /** Stand every post back up (stage restart); `restore` gets each one that was down. */
  reset(restore: (inst: ScatterInstance) => void): void {
    for (const inst of this.falls.keys()) restore(inst);
    this.falls.clear();
  }
}

/** World matrix of a falling post at `f.t`; true once it lies still. */
function fallMatrix(
  f: Fall,
  ground: (x: number, z: number) => number,
  out: Matrix4,
): boolean {
  const { inst, t } = f;
  const angle = Math.min(Math.PI / 2, f.spin * t + 0.5 * TIP_ACCEL * t * t);
  const s = f.slide * (1 - Math.exp(-SLIDE_RATE * t));
  const x = inst.x + f.dx * s;
  const z = inst.z + f.dz * s;
  // Rotating about up x push turns the post's top towards the push direction; lift by its half thickness as it lies.
  _axis.set(f.dz, 0, -f.dx);
  _r.setFromAxisAngle(_axis, angle);
  _e.set(inst.tiltX, inst.rotY, inst.tiltZ, 'YXZ');
  _q.setFromEuler(_e).premultiply(_r);
  // Follow the ground it slides over (relative to the base, so the start matches the placed instance).
  const y =
    inst.y +
    (s > 0.01 ? ground(x, z) - ground(inst.x, inst.z) : 0) +
    0.05 * Math.sin(angle);
  out.compose(
    _p.set(x, y, z),
    _q,
    _s.set(
      inst.scale * (inst.sx ?? 1),
      inst.scale * (inst.sy ?? 1),
      inst.scale * (inst.sz ?? 1),
    ),
  );
  return angle >= Math.PI / 2 && t > 1 / SLIDE_RATE + 0.6;
}
