import {
  BufferAttribute,
  ExtrudeGeometry,
  Shape,
  type BufferGeometry,
} from 'three';
import { atlasUv, type AtlasChart, type AtlasLayout } from './atlas-painter';
import type { CarProfile } from './types';

/**
 * Fallback body of an imported car (`model.profile`): the side outline extruded straight across to the body width -
 * a boxy stand-in shown only when the GLB can't load (or in the car viewer with `fallback=1`). The outline is baked
 * from the GLB by scripts/car-model/side-profile.mjs. With the car's atlas `layout` every face gets the GLB's
 * box-projection UVs (chart by facing, as stl-to-glb.mjs), so the livery paints it. DOM-free.
 */
export function buildProfileBody(
  profile: CarProfile,
  layout?: AtlasLayout,
): BufferGeometry {
  const o = profile.outline;
  const shape = new Shape();
  shape.moveTo(o[0], o[1]);
  for (let i = 2; i < o.length; i += 2) shape.lineTo(o[i], o[i + 1]);
  shape.closePath();
  // Shape (x, y) = model (z, y); the extrusion runs along the shape's +z, turned to model -x and centred.
  const g = new ExtrudeGeometry(shape, {
    depth: profile.width,
    bevelEnabled: false,
  });
  g.rotateY(-Math.PI / 2);
  g.translate(profile.width / 2, 0, 0);
  if (layout) g.setAttribute('uv', atlasUvs(g, layout));
  return g;
}

/** Per triangle (ExtrudeGeometry is non-indexed): the chart its face normal points at, then that chart's UV. */
function atlasUvs(g: BufferGeometry, layout: AtlasLayout): BufferAttribute {
  const p = g.getAttribute('position');
  const uv = new Float32Array(p.count * 2);
  for (let t = 0; t < p.count; t += 3) {
    const a = [0, 1, 2].map((k) => [
      p.getX(t + k),
      p.getY(t + k),
      p.getZ(t + k),
    ]);
    const e1 = [0, 1, 2].map((k) => a[1][k] - a[0][k]);
    const e2 = [0, 1, 2].map((k) => a[2][k] - a[0][k]);
    const [nx, ny, nz] = [
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    ];
    const [ax, ay, az] = [Math.abs(nx), Math.abs(ny), Math.abs(nz)];
    const chart: AtlasChart =
      ax >= ay && ax >= az
        ? nx > 0
          ? 'left'
          : 'right'
        : ay >= az
          ? ny > 0
            ? 'top'
            : 'bottom'
          : nz > 0
            ? 'front'
            : 'rear';
    for (let k = 0; k < 3; k++)
      uv.set(atlasUv(layout, chart, a[k][0], a[k][1], a[k][2]), (t + k) * 2);
  }
  return new BufferAttribute(uv, 2);
}
