import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DynamicDrawUsage,
  Mesh,
  MeshBasicMaterial,
  RepeatWrapping,
  Vector3,
} from 'three';
import { pitchesFor, treadRubber } from '../cars/shared/tyre-mesh';
import { tyreSizeFor } from '../physics/car-tyres';
import type { TyreId } from '../physics/tyres';
import type { Vehicle } from '../physics/vehicle';

/** Quads per wheel in the ring buffer (oldest overwritten first). */
const SEGMENTS = 900;
/** Lift above the ground (m), plus a polygon offset over the road ribbons. */
const LIFT = 0.025;
/** Contact patch length (m): a tyre sliding sideways sweeps it across, so the mark widens with the slip angle. */
const PATCH_LENGTH = 0.16;
/** Width of a loose-surface rut over the tread band: the berms of pushed-aside gravel either side. */
const RUT_SPREAD = 1.3;
/**
 * GPU copies of the position / colour buffers, drawn in turn (one a frame). A buffer is never written while the GPU may
 * still read it: a write into the one drawn last frame made ANGLE / D3D11 wait for the GPU (a 150-200 ms freeze where the
 * first marks appear, then ~2.5 ms per write whenever the GPU is the bottleneck).
 */
const COPIES = 3;

/**
 * Mark kinds, one tile each across the texture atlas (u), generated from the fitted compound's tread pattern:
 *   0 rut: rolling on loose ground - the tread blocks pressed into it (darker), the gravel between them and the berms
 *     either side pushed up (lighter);
 *   1 slide rut: sliding / spinning on loose ground - the imprint smeared into streaks along the slide, berms as above;
 *   2 rubber: spinning or locked on a hard surface - a dark band, with light lines where the tread has circumferential grooves;
 *   3 scuff: sliding sideways on a hard surface - fainter, fine striations along the slide, soft edges.
 */
const KINDS = 4;
/** Distance (m) over which a mark builds up to its full darkness / fades out again, and the length (m) of its patchy swells. */
const RAMP_IN = 2;
const RAMP_OUT = 3;
const PATCH_SCALE = 1.7;
const TILE_W = 64;
const TILE_H = 128;
/** Tread pitches per tile along the mark (the imprint repeats at the real pitch length). */
const TILE_PITCHES = 2;

/**
 * Tyre marks: ruts on loose surfaces (always, darker and smeared when sliding) and rubber marks on hard surfaces (only
 * while sliding). One mesh for all four wheels: a ring buffer of quads per wheel, each new segment joins the wheel's last
 * mark point; only the new quad is uploaded, into each GPU copy (COPIES) when its turn comes. Unlit, transparent; the
 * texture (per compound) carries the tread imprint, width = the fitted tyre's tread, wider when sliding sideways.
 */
export class TyreMarks {
  readonly mesh: Mesh;
  private pos: Float32Array;
  private col: Float32Array;
  private uv: Float32Array;
  private next: number[];
  /** Last mark point per wheel (null = the strip is broken). */
  private last: (Vector3 | null)[];
  private lastAlpha: number[];
  private lastWidth: number[];
  /** Built-up darkness per wheel (0..1): rises while the tyre keeps sliding, falls once it stops. */
  private heat: number[];
  /** Distance along each wheel's strip (texture v). */
  private along: number[];
  private colour = new Color();
  private a = new Vector3();
  private b = new Vector3();
  private side = new Vector3();
  /** One geometry per GPU copy (shared CPU arrays and index), the quads each still has to upload, the one drawn. */
  private geos: BufferGeometry[] = [];
  private dirty: number[][] = [];
  /** Copies whose whole position buffer goes up on their next turn (after `clear`). */
  private cleared: boolean[] = new Array(COPIES).fill(false);
  private current = 0;
  private material: MeshBasicMaterial;
  /** Compound the texture and widths are for; tread band width (m) and imprint tile length (m) per wheel. */
  private fitted: TyreId | null | undefined = undefined;
  private tread: number[] = [];
  private tile: number[] = [];

  constructor(private vehicle: Vehicle) {
    const wheels = vehicle.wheels.length;
    const quads = SEGMENTS * wheels;
    this.pos = new Float32Array(quads * 4 * 3);
    this.col = new Float32Array(quads * 4 * 4);
    this.uv = new Float32Array(quads * 4 * 2);
    const idx = new Uint32Array(quads * 6);
    for (let q = 0; q < quads; q++) {
      const v = q * 4;
      // Facing up (counter-clockwise seen from above).
      idx.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], q * 6);
    }
    const idxAttr = new BufferAttribute(idx, 1);
    for (let k = 0; k < COPIES; k++) {
      const g = new BufferGeometry();
      g.setAttribute(
        'position',
        new BufferAttribute(this.pos, 3).setUsage(DynamicDrawUsage),
      );
      g.setAttribute(
        'color',
        new BufferAttribute(this.col, 4).setUsage(DynamicDrawUsage),
      );
      g.setAttribute(
        'uv',
        new BufferAttribute(this.uv, 2).setUsage(DynamicDrawUsage),
      );
      g.setIndex(idxAttr);
      this.geos.push(g);
      this.dirty.push([]);
    }
    this.material = new MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -8,
    });
    this.mesh = new Mesh(this.geos[0], this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.name = 'tyre-marks';
    this.next = new Array(wheels).fill(0);
    this.last = new Array(wheels).fill(null);
    this.lastAlpha = new Array(wheels).fill(0);
    this.lastWidth = new Array(wheels).fill(0);
    this.heat = new Array(wheels).fill(0);
    this.along = new Array(wheels).fill(0);
    this.fit();
  }

  /** (Re)build the imprint texture and the widths for the fitted compound. */
  private fit(): void {
    const v = this.vehicle;
    if (this.fitted === v.tyre) return;
    this.fitted = v.tyre;
    const tyre = v.tyre;
    this.tread = v.wheels.map(
      (w) =>
        tyreSizeFor(v.def, v.tyre, w.isFront ? 'front' : 'rear').width * 0.9,
    );
    this.tile = v.wheels.map(
      (w) =>
        ((Math.PI * 2 * w.radius) / (tyre ? pitchesFor(tyre, w.radius) : 1)) *
        TILE_PITCHES,
    );
    this.material.map?.dispose();
    this.material.map = marksTexture(v.tyre);
    this.material.needsUpdate = true;
  }

  /** Once per frame, before rendering. */
  update(): void {
    this.fit();
    this.write();
    // The next copy (last drawn COPIES - 1 frames ago) takes the quads written since then and is drawn this frame.
    this.current = (this.current + 1) % COPIES;
    const g = this.geos[this.current];
    const quads = this.dirty[this.current];
    // Nothing new: quad 0 goes up again anyway. ANGLE / D3D11 turns a buffer that is drawn but never written into a
    // static one, and the first marks then waited for the GPU (a 110-200 ms freeze with the GPU saturated).
    if (!quads.length) quads.push(0);
    const pa = g.getAttribute('position') as BufferAttribute;
    const ca = g.getAttribute('color') as BufferAttribute;
    const ua = g.getAttribute('uv') as BufferAttribute;
    // Cleared: all positions go up (no update range = the whole buffer), so none of the old quads draw.
    const full = this.cleared[this.current];
    if (full) {
      this.cleared[this.current] = false;
      pa.clearUpdateRanges();
    }
    for (const q of quads) {
      if (!full) pa.addUpdateRange(q * 12, 12);
      ca.addUpdateRange(q * 16, 16);
      ua.addUpdateRange(q * 8, 8);
    }
    pa.needsUpdate = true;
    ca.needsUpdate = true;
    ua.needsUpdate = true;
    quads.length = 0;
    this.mesh.geometry = g;
  }

  private write(): void {
    const v = this.vehicle;
    const speed = Math.abs(v.speed);
    for (let i = 0; i < v.wheels.length; i++) {
      const w = v.wheels[i];
      const s = w.surface;
      const loose = s.loose > 0.3;
      // Loose: ruts whenever rolling, darker with slide. Hard: rubber only while sliding, darker the harder it slides
      // (slip speed, no cap at the first scrub) and the more load the tyre carries.
      const slide = smooth((w.slideSpeed - 1.2) / 11);
      const loadN = Math.min(
        1,
        Math.max(0, w.load / (w.nominalLoad * 1.6 || 1)),
      );
      const target = !w.contact
        ? 0
        : loose
          ? Math.min(0.62, s.loose * (0.22 + 0.4 * slide)) * (0.6 + 0.4 * loadN)
          : slide * (0.3 + 0.7 * loadN) * 0.9;
      if (speed < 0.5 || (target < 0.02 && this.heat[i] < 0.02)) {
        this.last[i] = null;
        this.heat[i] = 0;
        continue;
      }
      // Sideways the patch sweeps across: the mark widens with the slip angle, and with load (a light tyre scrubs a
      // narrower strip).
      const beta = Math.min(Math.PI / 2, Math.abs(w.slipAngle));
      const width =
        (this.tread[i] * Math.cos(beta) * (loose ? RUT_SPREAD : 1) +
          PATCH_LENGTH * Math.sin(beta)) *
        (0.8 + 0.2 * loadN);
      const p = this.a
        .copy(w.contactPoint)
        .addScaledVector(w.contactNormal, LIFT);
      const prev = this.last[i];
      if (!prev) {
        // A new strip starts invisible and darkens along its first metres.
        this.last[i] = p.clone();
        this.lastAlpha[i] = 0;
        this.lastWidth[i] = width;
        this.heat[i] = 0;
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
      // Build up / fade out over distance, with patchy swells along the mark (grip and surface vary).
      const rate = target > this.heat[i] ? d / RAMP_IN : d / RAMP_OUT;
      this.heat[i] += (target - this.heat[i]) * Math.min(1, rate);
      const patch = 0.7 + 0.3 * noise1(this.along[i] / PATCH_SCALE + i * 31.7);
      const alpha = this.heat[i] * patch;
      // Kind (atlas tile): imprint while rolling, smeared while sliding / spinning; on hard ground rubber along the
      // tyre (spin, lock) or a scuff when it slides sideways.
      const kind = loose ? (slide > 0.3 ? 1 : 0) : beta > 0.3 ? 3 : 2;
      // Ruts: the surface's dust colour (the texture darkens the pressed tread, lightens the berms); rubber near black.
      if (loose) this.colour.setHex(s.dustColor);
      else this.colour.setRGB(0.02, 0.02, 0.02);
      const v0 = this.along[i] / this.tile[i];
      this.along[i] = (this.along[i] + d) % (this.tile[i] * 4096);
      const v1 = v0 + d / this.tile[i];
      this.writeQuad(
        i,
        prev,
        p,
        this.lastAlpha[i],
        alpha,
        this.lastWidth[i],
        width,
        kind,
        v0,
        v1,
      );
      prev.copy(p);
      this.lastAlpha[i] = alpha;
      this.lastWidth[i] = width;
    }
  }

  /** Break every strip (after a reset / respawn). */
  breakStrips(): void {
    this.last.fill(null);
  }

  /**
   * Remove every mark (a replay opening or seeking back redraws them): all quads collapse to a point (positions 0, as
   * at the start), the strips break, and each GPU copy uploads its whole position buffer on its next turn.
   */
  clear(): void {
    this.pos.fill(0);
    this.next.fill(0);
    this.along.fill(0);
    this.last.fill(null);
    for (let k = 0; k < COPIES; k++) {
      this.dirty[k].length = 0;
      this.cleared[k] = true;
    }
  }

  private writeQuad(
    wheel: number,
    from: Vector3,
    to: Vector3,
    a0: number,
    a1: number,
    w0: number,
    w1: number,
    kind: number,
    v0: number,
    v1: number,
  ): void {
    const q = wheel * SEGMENTS + this.next[wheel];
    this.next[wheel] = (this.next[wheel] + 1) % SEGMENTS;
    const dir = this.b.subVectors(to, from);
    // Across the track, in the ground plane.
    this.side.set(-dir.z, 0, dir.x).normalize();
    const sx = this.side.x;
    const sz = this.side.z;
    const h0 = w0 / 2;
    const h1 = w1 / 2;
    const P = this.pos;
    const o = q * 12;
    P[o] = from.x - sx * h0;
    P[o + 1] = from.y;
    P[o + 2] = from.z - sz * h0;
    P[o + 3] = from.x + sx * h0;
    P[o + 4] = from.y;
    P[o + 5] = from.z + sz * h0;
    P[o + 6] = to.x - sx * h1;
    P[o + 7] = to.y;
    P[o + 8] = to.z - sz * h1;
    P[o + 9] = to.x + sx * h1;
    P[o + 10] = to.y;
    P[o + 11] = to.z + sz * h1;
    const C = this.col;
    const c = this.colour;
    const k = q * 16;
    for (let j = 0; j < 4; j++) {
      C[k + j * 4] = c.r;
      C[k + j * 4 + 1] = c.g;
      C[k + j * 4 + 2] = c.b;
      C[k + j * 4 + 3] = j < 2 ? a0 : a1;
    }
    const u0 = kind / KINDS;
    const u1 = (kind + 1) / KINDS;
    const U = this.uv;
    const t = q * 8;
    U[t] = u0;
    U[t + 1] = v0;
    U[t + 2] = u1;
    U[t + 3] = v0;
    U[t + 4] = u0;
    U[t + 5] = v1;
    U[t + 6] = u1;
    U[t + 7] = v1;
    for (const d of this.dirty) d.push(q);
  }

  dispose(): void {
    for (const g of this.geos) g.dispose();
    this.material.map?.dispose();
    this.material.dispose();
  }
}

/** Smoothstep of x clamped to 0..1. */
function smooth(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

/** Smooth 1D value noise in 0..1. */
function noise1(x: number): number {
  const i = Math.floor(x);
  const f = smooth(x - i);
  return hash(i, 0.5) * (1 - f) + hash(i + 1, 0.5) * f;
}

/** Cheap hash noise in 0..1. */
function hash(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * The mark atlas for a compound: KINDS tiles across (see KINDS), each TILE_W across the mark x TILE_H along it
 * (TILE_PITCHES tread pitches). rgb multiplies the vertex colour, alpha the vertex alpha.
 */
export function marksTexture(tyre: TyreId | null): CanvasTexture {
  const W = TILE_W * KINDS;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = TILE_H;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(W, TILE_H);
  // Plain carcass (no compound): all rubber.
  const rubberAt = (b: number, phase: number) =>
    tyre ? treadRubber(tyre, b, phase) : true;
  // Share of the pitch that is rubber at each column's b (circumferential grooves = 0): the rubber band's lines.
  const coverage = new Float64Array(TILE_W);
  for (let x = 0; x < TILE_W; x++) {
    const b = ((x + 0.5) / TILE_W) * 2 - 1;
    let n = 0;
    for (let k = 0; k < 32; k++) if (rubberAt(b, k / 32)) n++;
    coverage[x] = n / 32;
  }
  const put = (x: number, y: number, v: number, a: number) => {
    const i = (y * W + x) * 4;
    const g = Math.round(255 * Math.min(1, Math.max(0, v)));
    img.data[i] = img.data[i + 1] = img.data[i + 2] = g;
    img.data[i + 3] = Math.round(255 * Math.min(1, Math.max(0, a)));
  };
  for (let y = 0; y < TILE_H; y++)
    for (let x = 0; x < TILE_W; x++) {
      const u = (x + 0.5) / TILE_W;
      const phase = ((y + 0.5) / TILE_H) * TILE_PITCHES;
      const grain = hash(x, y);
      const streak = hash(x, 0.5);
      // Ruts: across the rut b runs past the tread (|b| > 1 = berm).
      const br = (u * 2 - 1) * RUT_SPREAD;
      const berm =
        Math.abs(br) > 1
          ? Math.max(0, 1 - (Math.abs(br) - 1) / (RUT_SPREAD - 1))
          : 0;
      const edge = Math.min(1, (RUT_SPREAD - Math.abs(br)) / 0.12);
      // 0: rolling rut - blocks pressed dark, the gravel between them lighter, berms light.
      if (Math.abs(br) <= 1) {
        const pressed = rubberAt(br, phase);
        put(
          x,
          y,
          pressed ? 0.2 + 0.08 * grain : 0.42 + 0.1 * grain,
          pressed ? 1 : 0.7,
        );
      } else put(x, y, 0.92 + 0.08 * grain, 0.55 * berm * edge);
      // 1: slide rut - smeared along: streaks, berms.
      if (Math.abs(br) <= 1)
        put(TILE_W + x, y, 0.24 + 0.16 * streak + 0.04 * grain, 0.9);
      else put(TILE_W + x, y, 0.95, 0.6 * berm * edge);
      // 2: rubber - dark band, light lines at the circumferential grooves, soft edges.
      const b = u * 2 - 1;
      const soft = Math.min(1, (1 - Math.abs(b)) / 0.18);
      const cov = coverage[x];
      put(
        TILE_W * 2 + x,
        y,
        1,
        soft *
          (0.15 + 0.85 * cov) *
          (0.82 + 0.18 * grain) *
          (0.85 + 0.15 * streak),
      );
      // 3: scuff - fine striations along, fainter.
      put(
        TILE_W * 3 + x,
        y,
        1,
        soft * 0.6 * (0.45 + 0.55 * streak) * (0.85 + 0.15 * grain),
      );
    }
  ctx.putImageData(img, 0, 0);
  const t = new CanvasTexture(c);
  t.name = 'tyre-marks';
  t.wrapT = RepeatWrapping;
  return t;
}
