import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from 'three';
import type { ScatterInstance } from './scatter';

/** Diameter of a pool (m) and how far the lens hangs over the road from the pole (assets/builders/props.ts). */
const POOL_DIAMETER = 12;
const ARM_REACH = 1.4;
/** Lift over the ground (m): above the road surface, under everything else. */
const LIFT = 0.1;

/**
 * The light of the village street lamps on the ground at night / dusk: one soft warm disc per lamp, drawn additively
 * as a single instanced mesh (no real lights: they are compiled into every shader). Built only when the lamps are
 * needed (`Environment.lightNeed`), strength follows it.
 */
export class LampPools {
  readonly mesh: InstancedMesh;

  constructor(
    lamps: Iterable<ScatterInstance>,
    heightAt: (x: number, z: number) => number,
    level: number,
  ) {
    const list = [...lamps];
    const mat = new MeshBasicMaterial({
      map: poolTexture(),
      color: new Color(1.0, 0.72, 0.4).multiplyScalar(1.0 * level),
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const geo = new PlaneGeometry(POOL_DIAMETER, POOL_DIAMETER).rotateX(
      -Math.PI / 2,
    );
    this.mesh = new InstancedMesh(geo, mat, Math.max(1, list.length));
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.count = list.length;
    this.mesh.renderOrder = 3;
    this.mesh.frustumCulled = false;
    const m = new Matrix4();
    const p = new Vector3();
    const s = new Vector3(1, 1, 1);
    const q = new Quaternion();
    list.forEach((l, i) => {
      const x = l.x + Math.sin(l.rotY) * ARM_REACH;
      const z = l.z + Math.cos(l.rotY) * ARM_REACH;
      this.mesh.setMatrixAt(
        i,
        m.compose(p.set(x, heightAt(x, z) + LIFT, z), q, s),
      );
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** Soft round falloff, white centre fading to black at the edge (opaque: the additive blend adds the brightness). */
function poolTexture(): CanvasTexture {
  const n = 128;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d')!;
  const img = g.createImageData(n, n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const r = Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2) / (n / 2);
      const v = Math.round(255 * Math.max(0, 1 - r) ** 2.2);
      img.data.set([v, v, v, 255], (y * n + x) * 4);
    }
  g.putImageData(img, 0, 0);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}
