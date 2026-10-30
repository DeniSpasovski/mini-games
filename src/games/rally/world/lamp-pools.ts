import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  Mesh,
  MeshBasicMaterial,
  SRGBColorSpace,
} from 'three';
import type { ScatterInstance } from './scatter';

/** Diameter of a pool (m) and how far the lens hangs over the road from the pole (assets/builders/props.ts). */
const POOL_DIAMETER = 12;
const ARM_REACH = 1.4;
/** Grid cells across a pool: ~1 m, so it follows the road camber and the verge. */
const CELLS = 12;
/** Lift over the ground (m): above the road surface, under everything else. */
const LIFT = 0.1;

/**
 * The light of the village street lamps on the ground at night / dusk: one soft warm disc per lamp, draped over the
 * ground (a flat disc sinks into a sloped verge and shows as flickering slivers), all merged into one additive mesh
 * (no real lights: they are compiled into every shader). Built only when the lamps are needed (`Environment.lightNeed`),
 * strength follows it.
 */
export class LampPools {
  readonly mesh: Mesh;

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
    // Fades into fog instead of taking its colour (engine/world-shading.ts).
    mat.defines = { RALLY_ADDITIVE: 1 };
    const side = CELLS + 1;
    const per = side * side;
    const pos = new Float32Array(list.length * per * 3);
    const uv = new Float32Array(list.length * per * 2);
    const index = new Uint32Array(list.length * CELLS * CELLS * 6);
    let v = 0;
    let t = 0;
    list.forEach((l, n) => {
      const cx = l.x + Math.sin(l.rotY) * ARM_REACH;
      const cz = l.z + Math.cos(l.rotY) * ARM_REACH;
      for (let j = 0; j < side; j++)
        for (let i = 0; i < side; i++) {
          const x = cx + (i / CELLS - 0.5) * POOL_DIAMETER;
          const z = cz + (j / CELLS - 0.5) * POOL_DIAMETER;
          pos.set([x, heightAt(x, z) + LIFT, z], v * 3);
          uv.set([i / CELLS, j / CELLS], v * 2);
          v++;
        }
      const base = n * per;
      for (let j = 0; j < CELLS; j++)
        for (let i = 0; i < CELLS; i++) {
          const a = base + j * side + i;
          index.set([a, a + side, a + 1, a + 1, a + side, a + side + 1], t);
          t += 6;
        }
    });
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('uv', new BufferAttribute(uv, 2));
    geo.setIndex(new BufferAttribute(index, 1));
    geo.computeBoundingSphere();
    this.mesh = new Mesh(geo, mat);
    this.mesh.renderOrder = 3;
    this.mesh.frustumCulled = false;
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
