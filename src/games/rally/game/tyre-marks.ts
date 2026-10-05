import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DynamicDrawUsage,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from 'three';
import type { Vehicle } from '../physics/vehicle';

/** Quads per wheel in the ring buffer (oldest overwritten first). */
const SEGMENTS = 900;
/** Tyre mark width (m). */
const WIDTH = 0.21;
/** Lift above the ground (m), plus a polygon offset over the road ribbons. */
const LIFT = 0.025;

/**
 * Tyre marks: ruts on loose surfaces (always, darker when sliding) and dark rubber skid marks on hard surfaces
 * (only while sliding). One mesh for all four wheels: a ring buffer of quads per wheel, each new segment joins the
 * wheel's last mark point; only the new quad is uploaded. Unlit, transparent dark (it darkens whatever is under it),
 * soft edges across the width, fogged.
 */
export class TyreMarks {
  readonly mesh: Mesh;
  private pos: Float32Array;
  private col: Float32Array;
  private next: number[];
  /** Last mark point per wheel (null = the strip is broken). */
  private last: (Vector3 | null)[];
  private lastAlpha: number[];
  private colour = new Color();
  private a = new Vector3();
  private b = new Vector3();
  private side = new Vector3();

  constructor(private vehicle: Vehicle) {
    const wheels = vehicle.wheels.length;
    const quads = SEGMENTS * wheels;
    this.pos = new Float32Array(quads * 4 * 3);
    this.col = new Float32Array(quads * 4 * 4);
    const uv = new Float32Array(quads * 4 * 2);
    const idx = new Uint32Array(quads * 6);
    for (let q = 0; q < quads; q++) {
      uv.set([0, 0, 1, 0, 0, 1, 1, 1], q * 8);
      const v = q * 4;
      idx.set([v, v + 2, v + 1, v + 1, v + 2, v + 3], q * 6);
    }
    const g = new BufferGeometry();
    const posAttr = new BufferAttribute(this.pos, 3).setUsage(DynamicDrawUsage);
    const colAttr = new BufferAttribute(this.col, 4).setUsage(DynamicDrawUsage);
    g.setAttribute('position', posAttr);
    g.setAttribute('color', colAttr);
    g.setAttribute('uv', new BufferAttribute(uv, 2));
    g.setIndex(new BufferAttribute(idx, 1));
    this.mesh = new Mesh(
      g,
      new MeshBasicMaterial({
        vertexColors: true,
        map: edgeTexture(),
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -8,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.name = 'tyre-marks';
    this.next = new Array(wheels).fill(0);
    this.last = new Array(wheels).fill(null);
    this.lastAlpha = new Array(wheels).fill(0);
  }

  /** Call after each physics step (or once per frame). */
  update(): void {
    const v = this.vehicle;
    const speed = Math.abs(v.speed);
    for (let i = 0; i < v.wheels.length; i++) {
      const w = v.wheels[i];
      const s = w.surface;
      // Loose: ruts whenever rolling, darker with slide. Hard: rubber only while sliding.
      const slide = Math.min(1, Math.max(0, (w.slideSpeed - 1.2) / 6));
      const alpha = !w.contact
        ? 0
        : s.loose > 0.3
          ? Math.min(0.55, s.loose * (0.16 + 0.4 * slide))
          : slide * 0.6;
      if (alpha < 0.02 || speed < 0.5) {
        this.last[i] = null;
        continue;
      }
      const p = this.a
        .copy(w.contactPoint)
        .addScaledVector(w.contactNormal, LIFT);
      const prev = this.last[i];
      if (!prev) {
        this.last[i] = p.clone();
        this.lastAlpha[i] = alpha;
        continue;
      }
      const d = p.distanceTo(prev);
      if (d > 6) {
        // Reset / teleport: start a new strip.
        prev.copy(p);
        continue;
      }
      // Longer segments at speed (more track per buffer), short ones when slow / sliding.
      if (d < Math.max(0.3, speed * 0.045)) continue;
      // Rubber is near black, ruts a darker shade of the surface's dust.
      if (s.loose > 0.3) this.colour.setHex(s.dustColor).multiplyScalar(0.28);
      else this.colour.setRGB(0.02, 0.02, 0.02);
      this.writeQuad(i, prev, p, this.lastAlpha[i], alpha);
      prev.copy(p);
      this.lastAlpha[i] = alpha;
    }
  }

  /** Break every strip (after a reset / respawn). */
  breakStrips(): void {
    this.last.fill(null);
  }

  private writeQuad(
    wheel: number,
    from: Vector3,
    to: Vector3,
    a0: number,
    a1: number,
  ): void {
    const q = wheel * SEGMENTS + this.next[wheel];
    this.next[wheel] = (this.next[wheel] + 1) % SEGMENTS;
    const dir = this.b.subVectors(to, from);
    // Across the track, in the ground plane.
    this.side
      .set(-dir.z, 0, dir.x)
      .normalize()
      .multiplyScalar(WIDTH / 2);
    const P = this.pos;
    const o = q * 12;
    P[o] = from.x - this.side.x;
    P[o + 1] = from.y;
    P[o + 2] = from.z - this.side.z;
    P[o + 3] = from.x + this.side.x;
    P[o + 4] = from.y;
    P[o + 5] = from.z + this.side.z;
    P[o + 6] = to.x - this.side.x;
    P[o + 7] = to.y;
    P[o + 8] = to.z - this.side.z;
    P[o + 9] = to.x + this.side.x;
    P[o + 10] = to.y;
    P[o + 11] = to.z + this.side.z;
    const C = this.col;
    const c = this.colour;
    const k = q * 16;
    for (let j = 0; j < 4; j++) {
      C[k + j * 4] = c.r;
      C[k + j * 4 + 1] = c.g;
      C[k + j * 4 + 2] = c.b;
      C[k + j * 4 + 3] = j < 2 ? a0 : a1;
    }
    const g = this.mesh.geometry;
    const pa = g.getAttribute('position') as BufferAttribute;
    const ca = g.getAttribute('color') as BufferAttribute;
    pa.addUpdateRange(o, 12);
    ca.addUpdateRange(k, 16);
    pa.needsUpdate = true;
    ca.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    const m = this.mesh.material as MeshBasicMaterial;
    m.map?.dispose();
    m.dispose();
  }
}

/** Soft-edged stripe across the mark (u), with a faint tread / grain pattern along it (v). */
function edgeTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 32;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(32, 32);
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      const u = (x + 0.5) / 32;
      const edge = Math.min(1, Math.min(u, 1 - u) / 0.22);
      const grain = 0.8 + 0.2 * Math.sin(y * 1.9 + x * 0.7) * Math.sin(x * 2.3);
      const i = (y * 32 + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(255 * edge * grain);
    }
  ctx.putImageData(img, 0, 0);
  const t = new CanvasTexture(c);
  t.name = 'tyre-marks';
  return t;
}
