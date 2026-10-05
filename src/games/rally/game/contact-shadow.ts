import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  Vector3,
} from 'three';
import type { Vehicle } from '../physics/vehicle';

/** Grid of the shadow quad (vertices per side): draped over the ground so it follows slopes / road crown. */
const N = 3;
/** Darkness under the car when it sits on its wheels. */
const OPACITY = 0.72;

/**
 * Soft dark patch under the car (ambient-occlusion stand-in): grounds the car on every quality tier and at any
 * shadow-map resolution, where the sun shadow alone leaves a bright gap under the sills. One small draw call.
 * Sized from the wheel mounts, draped over `groundAt` every frame, faded out when the car leaves the ground.
 */
export class ContactShadow {
  readonly mesh: Mesh;
  private local: [number, number][] = [];
  private pos: Float32Array;
  private rest = Infinity;
  private p = new Vector3();

  constructor(
    vehicle: Vehicle,
    private groundAt: (x: number, z: number) => number,
  ) {
    let hx = 0;
    let zf = -Infinity;
    let zr = Infinity;
    for (const w of vehicle.wheels) {
      hx = Math.max(hx, Math.abs(w.mount.x) + w.radius * 0.9);
      zf = Math.max(zf, w.mount.z);
      zr = Math.min(zr, w.mount.z);
    }
    // Body overhang past the axles.
    zf += 0.95;
    zr -= 0.95;
    hx += 0.12;
    const uv: number[] = [];
    const idx: number[] = [];
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const u = i / (N - 1);
        const v = j / (N - 1);
        this.local.push([-hx + 2 * hx * u, zr + (zf - zr) * v]);
        uv.push(u, v);
        if (i < N - 1 && j < N - 1) {
          const a = j * N + i;
          idx.push(a, a + N, a + N + 1, a, a + N + 1, a + 1);
        }
      }
    this.pos = new Float32Array(N * N * 3);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
    g.setIndex(idx);
    this.mesh = new Mesh(
      g,
      new MeshBasicMaterial({
        color: 0x000000,
        map: shadowTexture(),
        transparent: true,
        opacity: OPACITY,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      }),
    );
    this.mesh.name = 'car contact shadow';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  /** Follow the drawn car body (`root` = interpolated model root). */
  update(root: Object3D): void {
    root.updateMatrixWorld();
    const e = root.matrixWorld.elements;
    for (let k = 0; k < this.local.length; k++) {
      const [lx, lz] = this.local[k];
      // Body frame -> world (x, z only; the patch lies on the ground).
      const x = e[0] * lx + e[8] * lz + e[12];
      const z = e[2] * lx + e[10] * lz + e[14];
      this.pos[k * 3] = x;
      this.pos[k * 3 + 1] = this.groundAt(x, z) + 0.03;
      this.pos[k * 3 + 2] = z;
    }
    const g = this.mesh.geometry;
    g.attributes.position.needsUpdate = true;
    g.computeBoundingSphere();
    // Height of the body above the ground: the lowest seen is "on its wheels"; fade as it rises (jumps, rolls).
    const p = this.p.set(e[12], e[13], e[14]);
    const h = p.y - this.groundAt(p.x, p.z);
    this.rest = Math.min(this.rest + 0.002, h);
    const mat = this.mesh.material as MeshBasicMaterial;
    mat.opacity =
      OPACITY * (1 - MathUtils.smoothstep(h - this.rest, 0.25, 1.6));
    this.mesh.visible = mat.opacity > 0.01;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    const m = this.mesh.material as MeshBasicMaterial;
    m.map?.dispose();
    m.dispose();
  }
}

/** Rounded-rectangle falloff: dark in the middle, soft edges (alpha only). */
function shadowTexture(): CanvasTexture {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const u = Math.abs((x + 0.5) / S - 0.5) * 2;
      const v = Math.abs((y + 0.5) / S - 0.5) * 2;
      // Superellipse distance: a car-shaped rounded box.
      const d = Math.pow(Math.pow(u, 4) + Math.pow(v, 4), 0.25);
      const a = 1 - MathUtils.smoothstep(d, 0.45, 1);
      const k = (y * S + x) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = 255;
      img.data[k + 3] = Math.round(a * a * 255);
    }
  ctx.putImageData(img, 0, 0);
  const t = new CanvasTexture(c);
  return t;
}
