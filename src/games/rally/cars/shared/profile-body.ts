import { ExtrudeGeometry, Shape, type BufferGeometry } from 'three';
import type { CarProfile } from './types';

/**
 * Fallback body of an imported car (`model.profile`): the side outline extruded straight across to the body width -
 * a boxy stand-in shown only when the GLB can't load (or in the car viewer with `fallback=1`). The outline is baked
 * from the GLB by scripts/car-model/side-profile.mjs. DOM-free.
 */
export function buildProfileBody(profile: CarProfile): BufferGeometry {
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
  return g;
}
