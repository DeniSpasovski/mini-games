import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  Quaternion,
  Vector3,
} from 'three';
import type { CarModel } from '../cars/shared/car-model';
import { rimRadius } from '../cars/shared/tyre-mesh';
import type { TyreSize } from '../physics/types';

/**
 * Wheel debugger overlay for the car viewer (`wheels=1`): per wheel, drawn on top of everything at the tyre's outer face -
 *  - fixed (steers, does not spin) at the physics hub: crosshair, tyre radius (cyan), rim bead radius (yellow), 2 cm hub
 *    ring - a rim that is off its axle wobbles against these while the wheels spin / the angle slider turns;
 *  - a red pointer that turns with the wheel (spin angle);
 *  - the body's arch opening (magenta), fitted once the imported body has loaded: the body vertices on the car's flank
 *    (outermost 8 cm) round the static hub, the closest one per 5 deg sector over the upper half, circle fit. Its centre
 *    offset from the hub is in `report()` (dz + = towards the nose, dy + = up) with the gap above the tyre.
 */
export interface WheelReport {
  wheel: string;
  hub: [number, number, number];
  arch?: { dz: number; dy: number; radius: number; rms: number; gap: number };
}

const NAMES = ['FL', 'FR', 'RL', 'RR'];
const LINE = (color: number) =>
  new LineBasicMaterial({ color, depthTest: false, transparent: true });

export class WheelDebug {
  readonly group = new Group();
  private wheels: { fixed: Group; spin: Group }[] = [];
  private arches = new Group();
  private reports: WheelReport[] = [];
  private mats = {
    tyre: LINE(0x40e0ff),
    bead: LINE(0xffd040),
    cross: LINE(0xffffff),
    spin: LINE(0xff3030),
    arch: LINE(0xff40ff),
  };
  private q = new Quaternion();
  private flip = new Quaternion().setFromAxisAngle(
    new Vector3(0, 1, 0),
    Math.PI,
  );
  private spinQ = new Quaternion();
  private disposed = false;

  constructor(
    private model: CarModel,
    size: TyreSize,
    onArch?: () => void,
  ) {
    this.group.name = 'wheel debug';
    this.group.renderOrder = 999;
    model.root.add(this.group);
    this.group.add(this.arches);
    for (let i = 0; i < 4; i++) {
      const fixed = new Group();
      const spin = new Group();
      fixed.add(spin);
      this.group.add(fixed);
      this.wheels.push({ fixed, spin });
    }
    this.setTyre(size);
    this.reports = NAMES.map((wheel, i) => ({
      wheel,
      hub: this.restHub(i).toArray() as [number, number, number],
    }));
    void model.imported.then((ok) => {
      if (!ok || this.disposed) return;
      this.fitArches();
      onArch?.();
    });
  }

  /** Physics hub of wheel i at rest, in root space (root = centre of mass). */
  private restHub(i: number): Vector3 {
    const p = this.model.def.physics;
    const axle = i < 2 ? p.front : p.rear;
    return new Vector3(
      (i % 2 === 0 ? 1 : -1) * (axle.track / 2),
      p.wheelRadius - p.comHeight,
      axle.z,
    );
  }

  /** Rebuild the fixed circles for a tyre size (radius = physics wheel radius, bead = the size's rim). */
  setTyre(size: TyreSize): void {
    const R = this.model.def.physics.wheelRadius;
    const x = size.width / 2 + 0.012;
    for (const w of this.wheels) {
      for (const c of [...w.fixed.children, ...w.spin.children])
        if (c instanceof LineSegments) {
          c.geometry.dispose();
          c.removeFromParent();
        }
      const add = (parent: Group, pts: number[], mat: LineBasicMaterial) => {
        const g = new BufferGeometry();
        g.setAttribute('position', new Float32BufferAttribute(pts, 3));
        const l = new LineSegments(g, mat);
        l.renderOrder = 999;
        parent.add(l);
      };
      add(w.fixed, circle(x, R), this.mats.tyre);
      add(w.fixed, circle(x, rimRadius(size)), this.mats.bead);
      add(
        w.fixed,
        [...circle(x, 0.02), x, -R, 0, x, R, 0, x, 0, -R, x, 0, R],
        this.mats.cross,
      );
      add(w.spin, [x, 0, 0, x, R * 0.9, 0], this.mats.spin);
    }
  }

  /** Follow the model's wheel pose (call after model.syncWheels()). */
  update(): void {
    const m = this.model;
    for (let i = 0; i < 4; i++) {
      const right = i % 2 === 1;
      const w = this.wheels[i];
      this.q.setFromAxisAngle(new Vector3(0, 1, 0), m.wheelSteer[i]);
      if (right) this.q.multiply(this.flip);
      w.fixed.position.copy(m.wheelPos[i]);
      w.fixed.quaternion.copy(this.q);
      this.spinQ.setFromAxisAngle(
        new Vector3(1, 0, 0),
        right ? -m.wheelSpin[i] : m.wheelSpin[i],
      );
      w.spin.quaternion.copy(this.spinQ);
    }
  }

  report(): WheelReport[] {
    return this.reports;
  }

  private fitArches(): void {
    const m = this.model;
    m.root.updateMatrixWorld(true);
    const toRoot = new Matrix4().copy(m.root.matrixWorld).invert();
    const rel = new Matrix4();
    const v = new Vector3();
    const pts: number[] = [];
    m.body.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      rel.multiplyMatrices(toRoot, o.matrixWorld);
      const pos = (o.geometry as BufferGeometry).getAttribute('position');
      for (let k = 0; k < pos.count; k++) {
        v.fromBufferAttribute(pos, k).applyMatrix4(rel);
        pts.push(v.x, v.y, v.z);
      }
    });
    const R = m.def.physics.wheelRadius;
    for (let i = 0; i < 4; i++) {
      const hub = this.restHub(i);
      const s = i % 2 === 0 ? 1 : -1;
      // Candidates: outer half of the wheel, upper half (+5 cm), between the tyre and 30 cm outside it.
      const cand: number[] = [];
      let xmax = 0;
      for (let k = 0; k < pts.length; k += 3) {
        const sx = s * pts[k];
        if (sx < Math.abs(hub.x)) continue;
        const dz = pts[k + 2] - hub.z;
        const dy = pts[k + 1] - hub.y;
        if (dy < -0.05) continue;
        const r = Math.hypot(dz, dy);
        if (r < R * 0.9 || r > R + 0.3) continue;
        cand.push(sx, dz, dy, r);
        xmax = Math.max(xmax, sx);
      }
      // The flank only (outermost 8 cm): arch liners / wells sit further in.
      const best = new Array<number[] | undefined>(36);
      for (let k = 0; k < cand.length; k += 4) {
        if (cand[k] < xmax - 0.08) continue;
        const a = Math.atan2(cand[k + 2], cand[k + 1]);
        const bin = Math.min(35, Math.max(0, Math.floor((a / Math.PI) * 36)));
        if (a < 0 || a > Math.PI) continue;
        if (!best[bin] || cand[k + 3] < best[bin]![2])
          best[bin] = [cand[k + 1], cand[k + 2], cand[k + 3]];
      }
      const samples = best.filter((b): b is number[] => !!b);
      if (samples.length < 8) continue;
      const fit = fitCircle(samples.map((b) => [b[0], b[1]]));
      const rms = Math.sqrt(
        samples.reduce(
          (acc, b) =>
            acc + (Math.hypot(b[0] - fit.cx, b[1] - fit.cy) - fit.r) ** 2,
          0,
        ) / samples.length,
      );
      this.reports[i].arch = {
        dz: fit.cx,
        dy: fit.cy,
        radius: fit.r,
        rms,
        gap: fit.cy + fit.r - R,
      };
      const g = new BufferGeometry();
      const c = circle(0, fit.r);
      // circle() lies in the wheel plane (x = axle); place it at the flank, centred on the fitted centre.
      for (let k = 0; k < c.length; k += 3) {
        c[k] = s * xmax;
        c[k + 1] += hub.y + fit.cy;
        c[k + 2] += hub.z + fit.cx;
      }
      g.setAttribute('position', new Float32BufferAttribute(c, 3));
      const l = new LineSegments(g, this.mats.arch);
      l.renderOrder = 999;
      this.arches.add(l);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.group.removeFromParent();
    this.group.traverse((o) => {
      if (o instanceof LineSegments) o.geometry.dispose();
    });
    for (const mat of Object.values(this.mats)) mat.dispose();
  }
}

/** Circle of radius r in the plane x = x0 (y / z radial), as line-segment pairs. */
function circle(x0: number, r: number, n = 64): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const b = ((i + 1) / n) * Math.PI * 2;
    out.push(x0, Math.sin(a) * r, Math.cos(a) * r);
    out.push(x0, Math.sin(b) * r, Math.cos(b) * r);
  }
  return out;
}

/** Algebraic (Kasa) least-squares circle through points [z, y]. */
function fitCircle(p: number[][]): { cx: number; cy: number; r: number } {
  // Solve [2z 2y 1] [cx cy c] = z^2 + y^2 via the 3x3 normal equations.
  const A = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const b = [0, 0, 0];
  for (const [z, y] of p) {
    const row = [2 * z, 2 * y, 1];
    const rhs = z * z + y * y;
    for (let i = 0; i < 3; i++) {
      b[i] += row[i] * rhs;
      for (let j = 0; j < 3; j++) A[i][j] += row[i] * row[j];
    }
  }
  const [cx, cy, c] = solve3(A, b);
  return { cx, cy, r: Math.sqrt(Math.max(0, c + cx * cx + cy * cy)) };
}

function solve3(A: number[][], b: number[]): number[] {
  const det = (m: number[][]) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const d = det(A) || 1e-12;
  return [0, 1, 2].map(
    (k) => det(A.map((row, i) => row.map((x, j) => (j === k ? b[i] : x)))) / d,
  );
}
