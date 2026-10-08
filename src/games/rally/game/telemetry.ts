import {
  BufferAttribute,
  BufferGeometry,
  LineBasicMaterial,
  LineSegments,
  Vector3,
} from 'three';
import type { Vehicle } from '../physics/vehicle';

/**
 * F2: per-wheel numbers (the main tool for physics tuning).
 * F4: force vectors drawn in the world (green = suspension load,
 *     red = longitudinal tyre force, blue = lateral tyre force).
 */
export class Telemetry {
  readonly el: HTMLDivElement;
  private acc = 0;
  private lastVel = new Vector3();
  private g = new Vector3();

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'telemetry';
    this.el.style.display = 'none';
    parent.append(this.el);
  }

  get visible(): boolean {
    return this.el.style.display !== 'none';
  }

  toggle(): void {
    this.el.style.display = this.visible ? 'none' : '';
  }

  update(dt: number, v: Vehicle): void {
    // Smoothed G-force (always tracked so it's right when toggled on).
    const a = new Vector3()
      .subVectors(v.velocity, this.lastVel)
      .divideScalar(Math.max(dt, 1e-4));
    this.lastVel.copy(v.velocity);
    this.g.lerp(
      new Vector3(a.dot(v.right), a.y, a.dot(v.forward)).divideScalar(9.81),
      Math.min(1, dt * 6),
    );
    this.acc += dt;
    if (!this.visible || this.acc < 0.1) return;
    this.acc = 0;
    const d = v.drivetrain;
    const deg = (r: number) => ((r * 180) / Math.PI).toFixed(1).padStart(6);
    const lines = [
      `speed ${(v.speed * 3.6).toFixed(1).padStart(6)} km/h   gear ${d.gear}  rpm ${d.rpm.toFixed(0).padStart(5)}  thr ${v.controls.throttle.toFixed(2)} brk ${v.controls.brake.toFixed(2)} hb ${v.controls.handbrake.toFixed(0)}`,
      `tyre ${v.tyre ?? 'raw'}  set-up ${v.def.setup}  mu ${v.wheels.map((w) => (w.contact ? w.surface.mu.toFixed(2) : '-')).join(' ')}`,
      `temp ${v.wheels.map((w) => `${w.temp.toFixed(0)}°C x${w.tempGrip.toFixed(2)}`).join('  ')}${v.climate ? `  air ${v.climate.air.toFixed(0)}°C` : '  (no climate)'}`,
      `steer ${v.controls.steer.toFixed(2).padStart(5)}  tc ${v.tcFactor.toFixed(2)}  clutch ${d.clutchSlipping ? 'slip' : 'lock'}  air ${v.airTime.toFixed(2)}s`,
      `G lat ${this.g.x.toFixed(2).padStart(5)}  lon ${this.g.z.toFixed(2).padStart(5)}  yaw ${deg(v.angularVelocity.y)}°/s`,
      '',
      'whl   load N  comp cm  slipR  slipA°  slip   ω rad/s  Fx N    Fy N   surface',
      ...v.wheels.map(
        (w) =>
          `${w.id}  ${w.load.toFixed(0).padStart(7)}  ${(w.compression * 100).toFixed(1).padStart(6)}  ${w.slipRatio
            .toFixed(2)
            .padStart(
              5,
            )}  ${deg(w.slipAngle)}  ${w.slip.toFixed(2).padStart(4)}  ${w.omega.toFixed(1).padStart(7)}  ${w.fx
            .toFixed(0)
            .padStart(
              6,
            )}  ${w.fy.toFixed(0).padStart(6)}  ${w.contact ? w.surface.id : '(air)'}`,
      ),
    ];
    this.el.textContent = lines.join('\n');
  }
}

export class ForceLines {
  readonly lines: LineSegments;
  private pos = new Float32Array(4 * 3 * 2 * 3);
  private col = new Float32Array(4 * 3 * 2 * 3);

  constructor() {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(this.pos, 3));
    g.setAttribute('color', new BufferAttribute(this.col, 3));
    this.lines = new LineSegments(
      g,
      new LineBasicMaterial({ vertexColors: true, depthTest: false }),
    );
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 10;
    this.lines.visible = false;
  }

  update(v: Vehicle): void {
    if (!this.lines.visible) return;
    const scale = 1 / 4000; // metres per newton
    let k = 0;
    const seg = (p: Vector3, d: Vector3, r: number, g: number, b: number) => {
      this.pos.set([p.x, p.y, p.z, p.x + d.x, p.y + d.y, p.z + d.z], k * 6);
      this.col.set([r, g, b, r, g, b], k * 6);
      k++;
    };
    const fwd = new Vector3();
    const side = new Vector3();
    for (const w of v.wheels) {
      const p = w.contactPoint;
      if (!w.contact) {
        for (let i = 0; i < 3; i++) seg(p, new Vector3(), 0, 0, 0);
        continue;
      }
      fwd
        .set(Math.sin(w.steerAngle), 0, Math.cos(w.steerAngle))
        .applyQuaternion(v.quaternion);
      side.crossVectors(w.contactNormal, fwd).normalize();
      seg(
        p,
        w.contactNormal.clone().multiplyScalar(w.load * scale),
        0.2,
        1,
        0.3,
      );
      seg(p, fwd.clone().multiplyScalar(w.fx * scale), 1, 0.25, 0.2);
      seg(p, side.clone().multiplyScalar(w.fy * scale), 0.3, 0.5, 1);
    }
    this.lines.geometry.getAttribute('position').needsUpdate = true;
    this.lines.geometry.getAttribute('color').needsUpdate = true;
  }
}
