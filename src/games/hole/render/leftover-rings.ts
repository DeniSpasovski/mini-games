import {
  Color,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  RingGeometry,
  Vector3,
  type BufferGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FallState } from '../sim/fall';
import type { World } from '../sim/world';
import { applyHoleCut } from './materials';

/** Rings show once fewer than this many points are left on the map. */
export const LEFTOVER_POINTS = 100;
const MAX = 256;
/** Ring radius (m) never drops below `camera distance x` this, so leftovers stay visible from a giant hole. */
const MIN_SCREEN_K = 0.05;
const PULSE_HZ = 1.4;

const FLAT = new Quaternion().setFromAxisAngle(
  new Vector3(1, 0, 0),
  -Math.PI / 2,
);

/**
 * Pulsing white ground rings under the last items of a run (fewer than `LEFTOVER_POINTS` left), so the
 * stragglers are easy to spot from a big hole's high camera. Stencil-cut like the ground; one InstancedMesh.
 */
export class LeftoverRings {
  readonly mesh: InstancedMesh;
  private items: number[] = [];
  private on = false;
  private m = new Matrix4();
  private p = new Vector3();
  private s = new Vector3();

  constructor(private world: World) {
    this.mesh = new InstancedMesh(
      ringGeometry(),
      applyHoleCut(
        new MeshBasicMaterial({
          vertexColors: true,
          transparent: true,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -4,
          polygonOffsetUnits: -4,
          toneMapped: false,
          fog: false,
        }),
      ),
      MAX,
    );
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
  }

  get active(): boolean {
    return this.on;
  }

  /** Call every frame of a run: `left` = points not eaten yet, `distance` = game camera distance (m). */
  update(left: number, distance: number, seconds: number): void {
    const w = this.world;
    if (!this.on) {
      if (left >= LEFTOVER_POINTS || left <= 0) return;
      this.on = true;
      for (let i = 0; i < w.n && this.items.length < MAX; i++)
        if (w.state[i] === FallState.Idle) this.items.push(i);
    }
    const minR = distance * MIN_SCREEN_K;
    let n = 0;
    for (let k = 0; k < this.items.length; k++) {
      const i = this.items[k];
      if (w.state[i] !== FallState.Idle) continue;
      // each ring breathes on its own phase so a cluster does not blink as one
      const t = seconds * PULSE_HZ + (w.seed[i] % 997) / 997;
      const pulse = 0.5 + 0.5 * Math.sin(t * Math.PI * 2);
      const r = Math.max(w.size[i] * 0.75 + 0.3, minR) * (0.85 + 0.3 * pulse);
      this.p.set(w.x[i], 0.04, w.z[i]);
      this.s.set(r, r, 1);
      this.mesh.setMatrixAt(n++, this.m.compose(this.p, FLAT, this.s));
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    const mat = this.mesh.material as MeshBasicMaterial;
    mat.opacity = 0.75 + 0.25 * Math.sin(seconds * PULSE_HZ * Math.PI * 2);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicMaterial).dispose();
  }
}

/** Unit ring: a white band with a thin dark rim outside it (reads on light floors too). */
function ringGeometry(): BufferGeometry {
  const band = paint(new RingGeometry(0.72, 1, 40), 0xffffff);
  const rim = paint(new RingGeometry(1, 1.1, 40), 0x2a2a2a);
  const g = mergeGeometries([band, rim])!;
  band.dispose();
  rim.dispose();
  return g;
}

function paint(g: BufferGeometry, hex: number): BufferGeometry {
  const c = new Color(hex);
  const n = g.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  return g;
}
