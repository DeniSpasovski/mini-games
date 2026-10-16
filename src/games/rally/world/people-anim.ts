import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { hash3 } from '../../../shared/rng';
import { PEOPLE_ASSETS } from './corner-fans';
import type { ScatterInstance } from './scatter';

/** Fans, visitors and marshals within this distance of the car turn to watch it (m). */
export const WATCH_RANGE = 45;
/** Photographers keep the car centred from further out (m). */
export const PHOTO_RANGE = 75;
/** People closer than this are registered with the streamer (their draw slot is tracked) so a turn shows at once. */
const TRACK_RANGE = 170;
const RELEASE_RANGE = 220;

interface Person {
  inst: ScatterInstance;
  base: number;
  yaw: number;
  /** Turn rate (rad/s). */
  rate: number;
  photographer: boolean;
  tracked: boolean;
}

const _e = new Euler();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _m = new Matrix4();

const wrap = (a: number): number =>
  a - Math.PI * 2 * Math.round(a / (Math.PI * 2));

/**
 * People near the car follow it with their body as it passes (the fans' turn comes after a beat and at their own
 * pace); photographers always keep the car centred, a little ahead of it. Only a turn about the vertical axis, applied
 * through the streamer's `setMatrix`, so it costs one matrix patch per moving person. DOM-free.
 */
export class PeopleAnimator {
  private people: Person[] = [];

  constructor(instances: Iterable<ScatterInstance>) {
    for (const inst of instances) {
      if (!PEOPLE_ASSETS.includes(inst.asset)) continue;
      const photographer = inst.asset === 'photographer';
      const h =
        hash3(Math.floor(inst.x * 3), Math.floor(inst.z * 3), 17) / 4294967296;
      this.people.push({
        inst,
        base: inst.rotY,
        yaw: inst.rotY,
        rate: photographer ? 11 : 3 + h * 3,
        photographer,
        tracked: false,
      });
    }
  }

  get count(): number {
    return this.people.length;
  }

  /** Turned people (stats / tests). */
  get turned(): number {
    let n = 0;
    for (const p of this.people) if (p.yaw !== p.base) n++;
    return n;
  }

  yawOf(inst: ScatterInstance): number | undefined {
    return this.people.find((p) => p.inst === inst)?.yaw;
  }

  update(
    dt: number,
    carX: number,
    carZ: number,
    vx: number,
    vz: number,
    setMatrix: (inst: ScatterInstance, m: Matrix4 | null) => void,
  ): void {
    for (const p of this.people) {
      const i = p.inst;
      const dx = carX - i.x;
      const dz = carZ - i.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > RELEASE_RANGE * RELEASE_RANGE) {
        if (p.tracked) {
          p.tracked = false;
          p.yaw = p.base;
          setMatrix(i, null);
        }
        continue;
      }
      if (!p.tracked) {
        if (d2 > TRACK_RANGE * TRACK_RANGE) continue;
        p.tracked = true;
        setMatrix(i, this.matrix(i, p.yaw));
      }
      const range = p.photographer ? PHOTO_RANGE : WATCH_RANGE;
      // A little hysteresis so nobody flickers between watching and standing at the range edge.
      const lim = p.yaw === p.base ? range : range + 6;
      let target = p.base;
      if (d2 < lim * lim) {
        // Photographers aim a touch ahead of the car (their reaction time).
        const lead = p.photographer ? 0.15 : 0;
        target = Math.atan2(dx + vx * lead, dz + vz * lead);
      }
      const diff = wrap(target - p.yaw);
      if (Math.abs(diff) < 1e-4) continue;
      const step = Math.min(Math.abs(diff), p.rate * dt);
      p.yaw += Math.sign(diff) * step;
      setMatrix(i, this.matrix(i, p.yaw));
    }
  }

  /** Everyone back to where the map put them. */
  reset(setMatrix: (inst: ScatterInstance, m: Matrix4 | null) => void): void {
    for (const p of this.people) {
      p.yaw = p.base;
      if (p.tracked) setMatrix(p.inst, null);
      p.tracked = false;
    }
  }

  private matrix(i: ScatterInstance, yaw: number): Matrix4 {
    _e.set(i.tiltX, yaw, i.tiltZ, 'YXZ');
    _q.setFromEuler(_e);
    return _m.compose(
      _p.set(i.x, i.y, i.z),
      _q,
      _s.set(
        i.scale * (i.sx ?? 1),
        i.scale * (i.sy ?? 1),
        i.scale * (i.sz ?? 1),
      ),
    );
  }
}
